const buildPauseState = (campaign) => ({
  status: 'paused',
  queue: {
    ...(campaign.queue || {}),
    pausedAt: new Date(),
    throttledUntil: null
  }
});

const buildResumeState = (campaign) => ({
  status: 'sending',
  startedAt: campaign.startedAt || new Date(),
  completedAt: null,
  queue: {
    ...(campaign.queue || {}),
    pausedAt: null
  }
});

const buildRestartState = (campaign, workerCount, batchSize) => ({
  status: 'sending',
  startedAt: new Date(),
  completedAt: null,
  scheduledAt: null,
  stats: {
    total: campaign.stats?.total || 0,
    sent: 0,
    failed: 0,
    opened: 0,
    bounced: 0,
    clicked: 0,
    replied: 0
  },
  queue: {
    workerCount: campaign.queue?.workerCount || workerCount,
    batchSize: campaign.queue?.batchSize || batchSize,
    throttledUntil: null,
    lastError: null,
    lastDispatchedAt: null,
    pausedAt: null,
    completedJobCount: 0,
    failedJobCount: 0,
    retryJobCount: 0
  }
});

const shouldRecoverExpiredLease = (job, now = new Date()) => {
  if (!job?.leaseExpiresAt) return false;
  return job.status === 'processing' && new Date(job.leaseExpiresAt).getTime() <= new Date(now).getTime();
};

const shouldSkipDuplicateSend = (recipient) => (
  recipient?.status === 'sent' || Boolean(recipient?.providerMessageId && recipient?.messageId)
);

module.exports = {
  buildPauseState,
  buildResumeState,
  buildRestartState,
  shouldRecoverExpiredLease,
  shouldSkipDuplicateSend
};
