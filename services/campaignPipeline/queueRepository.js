const crypto = require('crypto');
const Campaign = require('../../models/Campaign');
const Recipient = require('../../models/Recipient');
const CampaignDispatchJob = require('../../models/CampaignDispatchJob');
const CampaignDeadLetter = require('../../models/CampaignDeadLetter');
const { JOB_STATUSES, DEFAULT_MAX_ATTEMPTS } = require('./constants');
const metrics = require('./metrics');

const activeJobStatuses = [
  JOB_STATUSES.PENDING,
  JOB_STATUSES.PROCESSING,
  JOB_STATUSES.RETRYING
];

const toPlainObject = (value) => {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return { ...value };
};

const buildIdempotencyKey = (campaignId, recipientId) => (
  crypto.createHash('sha256').update(`${campaignId}:${recipientId}`).digest('hex')
);

const buildJobKey = (campaignId, recipientId) => (
  crypto.createHash('sha256').update(`job:${campaignId}:${recipientId}`).digest('hex')
);

const buildMessageId = (campaignId, recipientId) => (
  crypto.createHash('sha256').update(`message:${campaignId}:${recipientId}`).digest('hex')
);

const buildJobUpsert = ({ campaign, recipient, reset = false }) => {
  const now = new Date();
  const currentStatus = reset ? JOB_STATUSES.PENDING : (recipient.status || JOB_STATUSES.PENDING);
  const nextAttemptAt = reset || currentStatus === JOB_STATUSES.PENDING || currentStatus === JOB_STATUSES.RETRYING
    ? (recipient.nextAttemptAt || now)
    : null;
  const setFields = {
    recipientEmail: recipient.email,
    status: currentStatus,
    attemptCount: reset ? 0 : (recipient.attemptCount || 0),
    maxAttempts: campaign.queue?.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    jobKey: buildJobKey(campaign._id, recipient._id),
    messageId: recipient.messageId || buildMessageId(campaign._id, recipient._id),
    nextAttemptAt,
    lastAttemptAt: reset ? null : recipient.lastAttemptAt || null,
    sentAt: reset ? null : recipient.sentAt || null,
    provider: reset ? null : recipient.provider || null,
    providerMessageId: reset ? null : recipient.providerMessageId || null,
    sentSubject: reset ? null : recipient.sentSubject || null,
    lastError: reset ? null : (recipient.error ? {
      message: recipient.error,
      retryable: currentStatus === JOB_STATUSES.RETRYING
    } : recipient.lastError || null)
  };

  return {
    updateOne: {
      filter: {
        campaignId: campaign._id,
        recipientId: recipient._id
      },
      update: {
        $setOnInsert: {
          campaignId: campaign._id,
          userId: campaign.userId,
          recipientId: recipient._id,
          idempotencyKey: buildIdempotencyKey(campaign._id, recipient._id),
          metadata: {
            mergeData: toPlainObject(recipient.mergeData),
            trackingId: recipient.trackingId || null
          }
        },
        $set: reset ? { ...setFields, claimedBy: null, claimedAt: null, leaseExpiresAt: null } : setFields
      },
      upsert: true
    }
  };
};

const syncCampaignJobs = async (campaign, options = {}) => {
  const { reset = false, recipientIds = null, batchSize = 500 } = options;
  const query = { campaignId: campaign._id };

  if (Array.isArray(recipientIds) && recipientIds.length > 0) {
    query._id = { $in: recipientIds };
  }

  const cursor = Recipient.find(query)
    .select('_id email mergeData status trackingId attemptCount nextAttemptAt lastAttemptAt sentAt provider providerMessageId sentSubject error')
    .cursor();

  let bulkOps = [];
  let processed = 0;

  for await (const recipient of cursor) {
    bulkOps.push(buildJobUpsert({ campaign, recipient, reset }));
    processed += 1;

    if (bulkOps.length >= batchSize) {
      await CampaignDispatchJob.bulkWrite(bulkOps, { ordered: false });
      bulkOps = [];
    }
  }

  if (bulkOps.length > 0) {
    await CampaignDispatchJob.bulkWrite(bulkOps, { ordered: false });
  }

  return processed;
};

const resetRecipientsForCampaign = async (campaignId, { recipientIds = null } = {}) => {
  const query = { campaignId };

  if (Array.isArray(recipientIds) && recipientIds.length > 0) {
    query._id = { $in: recipientIds };
  }

  return Recipient.updateMany(query, {
    $set: {
      status: JOB_STATUSES.PENDING,
      deliveryJobId: null,
      attemptCount: 0,
      messageId: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      lockedBy: null,
      lockedAt: null,
      leaseExpiresAt: null,
      idempotencyKey: null,
      sentAt: null,
      sentSubject: null,
      providerMessageId: null,
      error: null
    }
  });
};

const resetCampaignJobs = async (campaignId, { recipientIds = null } = {}) => {
  const query = { campaignId };

  if (Array.isArray(recipientIds) && recipientIds.length > 0) {
    query.recipientId = { $in: recipientIds };
  }

  return CampaignDispatchJob.updateMany(query, {
    $set: {
      status: JOB_STATUSES.PENDING,
      attemptCount: 0,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      messageId: null,
      nextAttemptAt: new Date(),
      lastAttemptAt: null,
      sentAt: null,
      provider: null,
      providerMessageId: null,
      sentSubject: null,
      lastError: null
    }
  });
};

const pauseCampaignJobs = async (campaignId) => CampaignDispatchJob.updateMany(
  {
    campaignId,
    status: { $in: [JOB_STATUSES.PENDING, JOB_STATUSES.RETRYING, JOB_STATUSES.PROCESSING] }
  },
  {
    $set: {
      status: JOB_STATUSES.PAUSED,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null
    }
  }
);

const resumeCampaignJobs = async (campaignId) => CampaignDispatchJob.updateMany(
  {
    campaignId,
    status: JOB_STATUSES.PAUSED
  },
  {
    $set: {
      status: JOB_STATUSES.PENDING,
      nextAttemptAt: new Date(),
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null
    }
  }
);

const claimNextJob = async ({ campaignId, workerId, leaseMs }) => {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return CampaignDispatchJob.findOneAndUpdate(
    {
      campaignId,
      status: { $in: [JOB_STATUSES.PENDING, JOB_STATUSES.RETRYING, JOB_STATUSES.PROCESSING] },
      nextAttemptAt: { $lte: now },
      $or: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: {
        status: JOB_STATUSES.PROCESSING,
        claimedBy: workerId,
        claimedAt: now,
        leaseExpiresAt: leaseExpiresAt,
        lastAttemptAt: now
      },
      $inc: {
        attemptCount: 1
      }
    },
    {
      new: true,
      sort: { nextAttemptAt: 1, createdAt: 1 }
    }
  );
};

const countActiveJobs = async (campaignId) => CampaignDispatchJob.countDocuments({
  campaignId,
  status: { $in: activeJobStatuses }
});

const countQueuedJobs = async (campaignId) => CampaignDispatchJob.countDocuments({
  campaignId,
  status: { $in: [JOB_STATUSES.PENDING, JOB_STATUSES.RETRYING] }
});

const countQueuedJobsAll = async () => CampaignDispatchJob.countDocuments({
  status: { $in: [JOB_STATUSES.PENDING, JOB_STATUSES.RETRYING] }
});

const countActiveJobsAll = async () => CampaignDispatchJob.countDocuments({
  status: { $in: activeJobStatuses }
});

const getJobStats = async (campaignId) => {
  const jobs = await CampaignDispatchJob.aggregate([
    { $match: { campaignId } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  return jobs.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
};

const updateRecipientStatus = async (recipientId, updates) => Recipient.updateOne(
  { _id: recipientId },
  { $set: updates }
);

const markJobSent = async ({ job, recipient, provider, providerMessageId, subject, now = new Date(), skipCampaignIncrement = false }) => {
  await CampaignDispatchJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: JOB_STATUSES.SENT,
        sentAt: now,
        provider,
        providerMessageId: providerMessageId || null,
        messageId: job.messageId,
        sentSubject: subject || job.sentSubject || null,
        claimedBy: null,
        leaseExpiresAt: null,
        lastError: null
      }
    }
  );

  await updateRecipientStatus(recipient._id, {
    status: JOB_STATUSES.SENT,
    sentAt: now,
    sentSubject: subject || recipient.sentSubject || null,
    providerMessageId: providerMessageId || null,
    messageId: job.messageId,
    error: null,
    deliveryJobId: null,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null
  });

  if (!skipCampaignIncrement) {
    await Campaign.updateOne(
      { _id: job.campaignId },
      {
        $inc: { 'stats.sent': 1 },
        $set: {
          'queue.lastDispatchedAt': now,
          'queue.lastError': null
        }
      }
    );
  }

  metrics.recordEvent('sent', now);
};

const markJobRetrying = async ({ job, recipient, error, retryAfterMs, provider, providerMessageId = null, now = new Date() }) => {
  const nextAttemptAt = new Date(now.getTime() + retryAfterMs);

  await CampaignDispatchJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: JOB_STATUSES.RETRYING,
        nextAttemptAt,
        claimedBy: null,
        leaseExpiresAt: null,
        provider,
        providerMessageId: providerMessageId || null,
        messageId: job.messageId,
        lastError: error
      }
    }
  );

  await updateRecipientStatus(recipient._id, {
    status: JOB_STATUSES.RETRYING,
    nextAttemptAt,
    error: error?.message || 'Retrying',
    deliveryJobId: null,
    messageId: job.messageId,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null,
    attemptCount: job.attemptCount
  });

  await Campaign.updateOne(
    { _id: job.campaignId },
    {
      $inc: { 'queue.retryJobCount': 1 },
      $set: {
        'queue.throttledUntil': (error?.statusCode === 429 || String(error?.providerStatus || '').toUpperCase() === 'RESOURCE_EXHAUSTED')
          ? nextAttemptAt
          : null,
        'queue.lastError': {
          message: error?.message || 'Retry scheduled',
          statusCode: error?.statusCode || null,
          providerStatus: error?.providerStatus || null,
          retryAfterMs
        }
      }
    }
  );

  metrics.recordEvent('retrying', now);

  return nextAttemptAt;
};

const markJobFailed = async ({ job, recipient, error, provider, providerMessageId = null, now = new Date() }) => {
  await CampaignDispatchJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: JOB_STATUSES.FAILED,
        claimedBy: null,
        leaseExpiresAt: null,
        provider,
        providerMessageId: providerMessageId || null,
        messageId: job.messageId,
        lastError: error
      }
    }
  );

  await updateRecipientStatus(recipient._id, {
    status: JOB_STATUSES.FAILED,
    error: error?.message || 'Delivery failed',
    deliveryJobId: null,
    messageId: job.messageId,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null
  });

  await Campaign.updateOne(
    { _id: job.campaignId },
    {
      $inc: { 'stats.failed': 1, 'queue.failedJobCount': 1 },
      $set: {
        'queue.lastError': {
          message: error?.message || 'Delivery failed',
          statusCode: error?.statusCode || null,
          providerStatus: error?.providerStatus || null,
          retryAfterMs: error?.retryAfterMs || null
        }
      }
    }
  );

  metrics.recordEvent('failed', now);
};

const markJobDeadLetter = async ({ job, recipient, error, provider, providerMessageId = null, now = new Date() }) => {
  const deadLetter = await CampaignDeadLetter.findOneAndUpdate(
    {
      campaignId: job.campaignId,
      recipientId: recipient._id
    },
    {
      $set: {
        campaignId: job.campaignId,
        recipientId: recipient._id,
        email: recipient.email,
        provider,
        retryCount: job.attemptCount,
        errorCode: String(error?.statusCode || error?.providerStatus || 'UNKNOWN'),
        lastError: error,
        jobKey: job.jobKey,
        messageId: job.messageId,
        providerMessageId: providerMessageId || null,
        timestamp: now
      }
    },
    {
      upsert: true,
      new: true
    }
  );

  await CampaignDispatchJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: JOB_STATUSES.FAILED,
        claimedBy: null,
        leaseExpiresAt: null,
        provider,
        providerMessageId: providerMessageId || null,
        messageId: job.messageId,
        lastError: error
      }
    }
  );

  await updateRecipientStatus(recipient._id, {
    status: JOB_STATUSES.FAILED,
    error: error?.message || 'Delivery failed',
    providerMessageId: providerMessageId || null,
    messageId: job.messageId,
    deliveryJobId: null,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null
  });

  await Campaign.updateOne(
    { _id: job.campaignId },
    {
      $inc: { 'queue.failedJobCount': 1, 'stats.failed': 1 },
      $set: {
        'queue.lastError': {
          message: error?.message || 'Dead lettered',
          statusCode: error?.statusCode || null,
          providerStatus: error?.providerStatus || null,
          retryAfterMs: error?.retryAfterMs || null
        }
      }
    }
  );

  metrics.recordEvent('dead_letter', now);
  return deadLetter;
};

const markJobPaused = async ({ job, recipient }) => {
  await CampaignDispatchJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: JOB_STATUSES.PAUSED,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null
      }
    }
  );

  await updateRecipientStatus(recipient._id, {
    status: JOB_STATUSES.PAUSED,
    deliveryJobId: null,
    messageId: job.messageId,
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null
  });
};

const markCampaignStarted = async (campaignId, { scheduledAt = null } = {}) => {
  const update = {
    status: 'sending',
    startedAt: scheduledAt ? null : new Date(),
    completedAt: null,
    'queue.throttledUntil': null
  };

  if (scheduledAt) {
    update.scheduledAt = scheduledAt;
  }

  return Campaign.updateOne(
    { _id: campaignId },
    { $set: update }
  );
};

const markCampaignPaused = async (campaignId) => Campaign.updateOne(
  { _id: campaignId },
  {
    $set: {
      status: 'paused',
      'queue.pausedAt': new Date()
    }
  }
);

const markCampaignCompletedIfIdle = async (campaignId) => {
  const activeCount = await countActiveJobs(campaignId);
  if (activeCount > 0) {
    return false;
  }

  await Campaign.updateOne(
    { _id: campaignId, status: 'sending' },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        'queue.completedJobCount': await CampaignDispatchJob.countDocuments({ campaignId, status: JOB_STATUSES.SENT }),
        'queue.throttledUntil': null
      }
    }
  );

  return true;
};

const getCampaignJobsByStatus = async (campaignId) => CampaignDispatchJob.aggregate([
  { $match: { campaignId } },
  {
    $group: {
      _id: '$status',
      count: { $sum: 1 }
    }
  }
]);

const listDeadLetters = async (campaignId) => CampaignDeadLetter.find({ campaignId }).sort({ timestamp: -1 }).lean();

const requeueDeadLetter = async ({ deadLetterId, requeueMeta = {} }) => {
  const deadLetter = await CampaignDeadLetter.findById(deadLetterId);
  if (!deadLetter) {
    return null;
  }

  const campaign = await Campaign.findById(deadLetter.campaignId).select('userId').lean();
  if (!campaign) {
    return null;
  }

  await CampaignDispatchJob.updateOne(
    {
      campaignId: deadLetter.campaignId,
      recipientId: deadLetter.recipientId
    },
    {
      $set: {
        status: JOB_STATUSES.PENDING,
        attemptCount: 0,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
        lastAttemptAt: null,
        provider: null,
        providerMessageId: null,
        sentSubject: null,
        lastError: null
      },
      $setOnInsert: {
        campaignId: deadLetter.campaignId,
        userId: campaign.userId,
        recipientId: deadLetter.recipientId,
        recipientEmail: deadLetter.email,
        jobKey: deadLetter.jobKey || buildJobKey(deadLetter.campaignId, deadLetter.recipientId),
        idempotencyKey: buildIdempotencyKey(deadLetter.campaignId, deadLetter.recipientId),
        messageId: deadLetter.messageId || buildMessageId(deadLetter.campaignId, deadLetter.recipientId),
        metadata: {
          requeuedFromDlq: true
        }
      }
    },
    {
      upsert: true
    }
  );

  await Recipient.updateOne(
    { _id: deadLetter.recipientId },
    {
      $set: {
        status: JOB_STATUSES.PENDING,
        error: null,
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: new Date(),
        deliveryJobId: null,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null
      }
    }
  );

  deadLetter.requeuedAt = new Date();
  deadLetter.requeueMeta = requeueMeta;
  await deadLetter.save();
  return deadLetter;
};

module.exports = {
  syncCampaignJobs,
  resetRecipientsForCampaign,
  resetCampaignJobs,
  pauseCampaignJobs,
  resumeCampaignJobs,
  claimNextJob,
  countActiveJobs,
  countQueuedJobs,
  countQueuedJobsAll,
  countActiveJobsAll,
  getJobStats,
  markJobSent,
  markJobRetrying,
  markJobFailed,
  markJobDeadLetter,
  markJobPaused,
  markCampaignStarted,
  markCampaignPaused,
  markCampaignCompletedIfIdle,
  getCampaignJobsByStatus,
  listDeadLetters,
  requeueDeadLetter,
  buildJobKey,
  buildMessageId
};
