const crypto = require('crypto');
const mongoose = require('mongoose');
const Campaign = require('../../models/Campaign');
const Recipient = require('../../models/Recipient');
const CampaignDeadLetter = require('../../models/CampaignDeadLetter');
const EmailConfig = require('../../models/EmailConfig');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const {
  DEFAULT_BATCH_SIZE,
  DEFAULT_WORKER_COUNT,
  MIN_WORKERS,
  MAX_WORKERS,
  DEFAULT_LEASE_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS,
  JOB_STATUSES
} = require('./constants');
const metrics = require('./metrics');
const { buildRetryDecision } = require('./backoff');
const {
  syncCampaignJobs,
  resetRecipientsForCampaign,
  resetCampaignJobs,
  pauseCampaignJobs,
  resumeCampaignJobs,
  claimNextJob,
  countQueuedJobs,
  countActiveJobs,
  markJobSent,
  markJobRetrying,
  markJobFailed,
  markJobDeadLetter,
  markJobPaused,
  markCampaignStarted,
  markCampaignPaused,
  markCampaignCompletedIfIdle,
  countQueuedJobsAll,
  countActiveJobsAll,
  listDeadLetters,
  requeueDeadLetter: requeueDeadLetterRepo
} = require('./queueRepository');
const { sendCampaignEmail } = require('./providerGateway');
const providerRegistry = require('../providers');
const realtimeHub = require('../realtime/campaignRealtimeHub');

const clampWorkers = (value) => Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, value));

const cleanUpdate = (value) => Object.entries(value).reduce((acc, [key, entry]) => {
  if (entry !== undefined) {
    acc[key] = entry;
  }
  return acc;
}, {});

const broadcastProgress = async (campaignId, eventType = 'campaign.progress') => {
  const [campaign, queuedJobs] = await Promise.all([
    Campaign.findById(campaignId).select('stats status queue').lean(),
    countQueuedJobs(campaignId).catch(() => 0)
  ]);

  if (!campaign) {
    return;
  }

  const total = campaign.stats?.total || 0;
  const emailsSent = campaign.stats?.sent || 0;
  const emailsFailed = campaign.stats?.failed || 0;
  const emailsRetrying = campaign.queue?.retryJobCount || 0;
  const campaignProgress = total > 0 ? Math.min(100, Math.round(((emailsSent + emailsFailed) / total) * 100)) : 0;

  realtimeHub.broadcast(eventType, {
    campaignId: String(campaignId),
    emailsSent,
    emailsFailed,
    emailsRetrying,
    queueSize: queuedJobs,
    campaignProgress,
    status: campaign.status
  });
};

class CampaignPipelineService {
  constructor() {
    this.workerCount = clampWorkers(Number(process.env.CAMPAIGN_PIPELINE_WORKERS || DEFAULT_WORKER_COUNT));
    this.batchSize = Math.max(1, Number(process.env.CAMPAIGN_PIPELINE_BATCH_SIZE || DEFAULT_BATCH_SIZE));
    this.leaseMs = Math.max(30_000, Number(process.env.CAMPAIGN_PIPELINE_LEASE_MS || DEFAULT_LEASE_MS));
    this.pollIntervalMs = Math.max(1000, Number(process.env.CAMPAIGN_PIPELINE_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS));
    this.maxAttempts = Math.max(1, Number(process.env.CAMPAIGN_PIPELINE_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS));
    this.started = false;
    this.cycleInProgress = false;
    this.loopTimer = null;
    this.instanceId = `campaign-pipeline-${crypto.randomUUID()}`;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    metrics.setGauge('campaign_pipeline.worker_count', this.workerCount);
    metrics.setGauge('campaign_pipeline.batch_size', this.batchSize);
    metrics.setGauge('campaign_pipeline.instance_started', Date.now());
    logger.info({
      instanceId: this.instanceId,
      workerCount: this.workerCount,
      batchSize: this.batchSize,
      leaseMs: this.leaseMs,
      pollIntervalMs: this.pollIntervalMs
    }, 'Campaign pipeline started');

    this.loopTimer = setInterval(() => {
      this.runCycle().catch((error) => {
        logger.error({ err: error }, 'Campaign pipeline cycle failed');
      });
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }

    this.started = false;
  }

  async runCycle() {
    if (this.cycleInProgress) {
      return;
    }

    this.cycleInProgress = true;
    try {
      await this.activateScheduledCampaigns();

      const campaigns = await Campaign.find({
        status: { $in: ['sending', 'scheduled'] }
      })
        .select('_id status userId emailConfigId name queue stats startedAt scheduledAt')
        .sort({ updatedAt: 1 })
        .lean();

      const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'sending');
      metrics.setGauge('campaign_pipeline.active_campaigns', activeCampaigns.length);

      const concurrencyWindow = activeCampaigns.slice(0, this.workerCount);
      if (concurrencyWindow.length === 0) {
        return;
      }

      await Promise.allSettled(concurrencyWindow.map((campaign) => this.processCampaign(campaign)));
    } finally {
      this.cycleInProgress = false;
    }
  }

  async activateScheduledCampaigns() {
    const now = new Date();
    const dueCampaigns = await Campaign.find({
      status: 'scheduled',
      scheduledAt: { $lte: now }
    })
      .select('_id userId name scheduledAt')
      .lean();

    for (const campaign of dueCampaigns) {
      await this.startCampaign(campaign._id, { scheduledAt: campaign.scheduledAt, initiatedByScheduler: true });
    }
  }

  async resolveEmailConfig(campaign) {
    if (campaign.emailConfigId) {
      return EmailConfig.findById(campaign.emailConfigId);
    }

    const user = await User.findById(campaign.userId);
    if (!user?.googleAccessToken || !user?.email) {
      return null;
    }

    return EmailConfig.findOneAndUpdate(
      {
        userId: campaign.userId,
        provider: 'gmail',
        $or: [
          { 'config.email': user.email },
          { email: user.email }
        ]
      },
      {
        $set: {
          name: 'Primary Gmail',
          provider: 'gmail',
          verified: true,
          isDefault: true,
          email: user.email,
          'config.email': user.email
        }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );
  }

  async ensureCampaignReady(campaignId) {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const emailConfig = await this.resolveEmailConfig(campaign);
    if (!emailConfig) {
      throw new Error('Email configuration not found for this campaign');
    }

    if (!campaign.emailConfigId) {
      campaign.emailConfigId = emailConfig._id;
      await campaign.save();
    }

    return campaign.populate('emailConfigId');
  }

  async startCampaign(campaignId, options = {}) {
    const campaign = await this.ensureCampaignReady(campaignId);
    const scheduledAt = options.scheduledAt || campaign.scheduledAt || null;
    const reset = Boolean(options.reset);
    const recipientCount = await Recipient.countDocuments({ campaignId: campaign._id });

    await syncCampaignJobs(campaign, { reset });
    await markCampaignStarted(campaign._id, { scheduledAt: scheduledAt && !options.initiatedByScheduler ? scheduledAt : null });

    if (reset) {
      await Campaign.updateOne(
        { _id: campaign._id },
        {
          $set: {
            stats: {
              total: recipientCount,
              sent: 0,
              failed: 0,
              opened: 0,
              bounced: 0,
              clicked: 0,
              replied: 0
            },
            completedAt: null,
            startedAt: new Date(),
            status: 'sending',
            queue: {
              workerCount: campaign.queue?.workerCount || this.workerCount,
              batchSize: campaign.queue?.batchSize || this.batchSize,
              throttledUntil: null,
              lastError: null,
              lastDispatchedAt: null,
              pausedAt: null,
              completedJobCount: 0,
              failedJobCount: 0,
              retryJobCount: 0
            }
          }
        }
      );
    } else if (options.initiatedByScheduler) {
      await Campaign.updateOne(
        { _id: campaign._id },
        {
          $set: {
            status: 'sending',
            startedAt: new Date(),
            completedAt: null,
            stats: {
              total: recipientCount,
              sent: campaign.stats?.sent || 0,
              failed: campaign.stats?.failed || 0,
              opened: campaign.stats?.opened || 0,
              bounced: campaign.stats?.bounced || 0,
              clicked: campaign.stats?.clicked || 0,
              replied: campaign.stats?.replied || 0
            },
            queue: {
              workerCount: campaign.queue?.workerCount || this.workerCount,
              batchSize: campaign.queue?.batchSize || this.batchSize,
              throttledUntil: null,
              lastError: null,
              lastDispatchedAt: null,
              pausedAt: null,
              completedJobCount: 0,
              failedJobCount: 0,
              retryJobCount: 0
            }
          }
        }
      );
    }

    metrics.incrementCounter('campaign_pipeline.started');
    logger.info({ campaignId: campaign._id, reset, scheduledAt }, 'Campaign queued for delivery');
    broadcastProgress(campaign._id).catch(() => null);
    return Campaign.findById(campaign._id).populate('emailConfigId');
  }

  async pauseCampaign(campaignId) {
    await pauseCampaignJobs(campaignId);
    await markCampaignPaused(campaignId);
    metrics.incrementCounter('campaign_pipeline.paused');
    logger.info({ campaignId }, 'Campaign paused');
    broadcastProgress(campaignId, 'campaign.paused').catch(() => null);
    return Campaign.findById(campaignId).populate('emailConfigId');
  }

  async resumeCampaign(campaignId) {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    await resumeCampaignJobs(campaignId);
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: 'sending',
          startedAt: campaign.startedAt || new Date(),
          completedAt: null,
          'queue.pausedAt': null
        }
      }
    );

    metrics.incrementCounter('campaign_pipeline.resumed');
    logger.info({ campaignId }, 'Campaign resumed');
    broadcastProgress(campaignId, 'campaign.resumed').catch(() => null);
    return Campaign.findById(campaignId).populate('emailConfigId');
  }

  async restartCampaign(campaignId) {
    const campaign = await this.ensureCampaignReady(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    await resetRecipientsForCampaign(campaignId);
    await resetCampaignJobs(campaignId);
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: cleanUpdate({
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
            workerCount: campaign.queue?.workerCount || this.workerCount,
            batchSize: campaign.queue?.batchSize || this.batchSize,
            throttledUntil: null,
            lastError: null,
            lastDispatchedAt: null,
            pausedAt: null,
            completedJobCount: 0,
            failedJobCount: 0,
            retryJobCount: 0
          }
        })
      }
    );

    const refreshedCampaign = await Campaign.findById(campaignId).populate('emailConfigId');
    await syncCampaignJobs(refreshedCampaign, { reset: true });
    metrics.incrementCounter('campaign_pipeline.restarted');
    logger.info({ campaignId }, 'Campaign restarted');
    broadcastProgress(campaignId, 'campaign.restarted').catch(() => null);
    return Campaign.findById(campaignId).populate('emailConfigId');
  }

  async retryRecipients(campaignId, recipientIds = []) {
    const campaign = await this.ensureCampaignReady(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const targetRecipientIds = Array.isArray(recipientIds) && recipientIds.length > 0 ? recipientIds : null;
    await resetRecipientsForCampaign(campaignId, { recipientIds: targetRecipientIds });
    await resetCampaignJobs(campaignId, { recipientIds: targetRecipientIds });
    await syncCampaignJobs(campaign, { reset: true, recipientIds });
    await Campaign.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: 'sending',
          completedAt: null,
          startedAt: campaign.startedAt || new Date()
        }
      }
    );

    metrics.incrementCounter('campaign_pipeline.requeued');
    logger.info({ campaignId, recipientCount: recipientIds.length }, 'Recipients requeued');
    broadcastProgress(campaignId, 'campaign.requeued').catch(() => null);
    return Campaign.findById(campaignId).populate('emailConfigId');
  }

  async processCampaign(campaign) {
    const campaignId = String(campaign._id);
    const latestCampaign = await Campaign.findById(campaignId).populate('emailConfigId');
    if (!latestCampaign) {
      logger.warn({ campaignId }, 'Campaign missing during processing');
      return;
    }

    if (latestCampaign.status !== 'sending') {
      return;
    }

    const throttleUntil = latestCampaign.queue?.throttledUntil ? new Date(latestCampaign.queue.throttledUntil) : null;
    if (throttleUntil && throttleUntil > new Date()) {
      metrics.setGauge(`campaign_pipeline.throttled.${campaignId}`, throttleUntil.getTime());
      return;
    }

    const workerBatches = [];
    const jobsToClaim = this.workerCount * this.batchSize;

    for (let i = 0; i < jobsToClaim; i += 1) {
      const job = await claimNextJob({
        campaignId: latestCampaign._id,
        workerId: this.instanceId,
        leaseMs: this.leaseMs
      });

      if (!job) {
        break;
      }

      workerBatches.push(job);
    }

    if (workerBatches.length === 0) {
      await markCampaignCompletedIfIdle(latestCampaign._id);
      return;
    }

    metrics.setGauge('campaign_pipeline.claimed_jobs', workerBatches.length);

    const batches = [];
    for (let i = 0; i < workerBatches.length; i += this.batchSize) {
      batches.push(workerBatches.slice(i, i + this.batchSize));
    }

    await Promise.allSettled(batches.map((batch) => this.processBatch(latestCampaign, batch)));

    await markCampaignCompletedIfIdle(latestCampaign._id);
  }

  async processBatch(campaign, jobs) {
    for (const job of jobs) {
      await this.processJob(campaign, job);
    }
  }

  async processJob(campaign, job) {
    const refreshCampaign = await Campaign.findById(campaign._id).populate('emailConfigId');
    if (!refreshCampaign || refreshCampaign.status === 'paused') {
      const recipient = await Recipient.findById(job.recipientId);
      if (recipient) {
        await markJobPaused({ job, recipient });
      }
      return;
    }

    const recipient = await Recipient.findById(job.recipientId);
    if (!recipient) {
      await markJobFailed({
        job,
        recipient: { _id: job.recipientId },
        provider: refreshCampaign.emailConfigId?.provider || 'unknown',
        error: {
          message: 'Recipient missing from campaign queue',
          statusCode: 404,
          retryable: false
        }
      });
      return;
    }

    if (refreshCampaign.queue?.throttledUntil) {
      const throttleUntil = new Date(refreshCampaign.queue.throttledUntil);
      if (throttleUntil > new Date()) {
        await markJobRetrying({
          job,
          recipient,
          error: {
            message: 'Campaign throttled after provider rate limit',
            statusCode: 429,
            providerStatus: 'RESOURCE_EXHAUSTED',
            retryable: true,
            retryAfterMs: Math.max(0, throttleUntil.getTime() - Date.now())
          },
          retryAfterMs: Math.max(0, throttleUntil.getTime() - Date.now()),
          provider: refreshCampaign.emailConfigId?.provider || 'unknown'
        });
        return;
      }
    }

    if (recipient.status === JOB_STATUSES.SENT) {
      metrics.incrementCounter('campaign_pipeline.duplicate_skipped');
      await markJobSent({
        job,
        recipient,
        provider: refreshCampaign.emailConfigId?.provider || 'unknown',
        providerMessageId: recipient.providerMessageId || null,
        subject: recipient.sentSubject || refreshCampaign.subject || '',
        skipCampaignIncrement: true
      });
      return;
    }

    const user = await User.findById(refreshCampaign.userId);
    const emailConfig = refreshCampaign.emailConfigId || await this.resolveEmailConfig(refreshCampaign);
    if (!user || !emailConfig) {
      await markJobFailed({
        job,
        recipient,
        provider: emailConfig?.provider || 'unknown',
        error: {
          message: 'User or email configuration missing',
          statusCode: 400,
          retryable: false
        }
      });
      return;
    }

    try {
      await Recipient.updateOne(
        { _id: recipient._id },
        {
          $set: {
            status: 'processing',
            deliveryJobId: job._id,
            lockedBy: this.instanceId,
            lockedAt: new Date(),
            leaseExpiresAt: job.leaseExpiresAt || new Date(Date.now() + this.leaseMs),
            attemptCount: job.attemptCount,
            nextAttemptAt: job.nextAttemptAt || new Date()
          }
        }
      );

      const sendStartedAt = Date.now();

      const result = await sendCampaignEmail({
        campaign: refreshCampaign,
        recipient,
        user,
        emailConfig
      });
      const latencyMs = Date.now() - sendStartedAt;

      const latestState = await Campaign.findById(refreshCampaign._id).select('status queue.throttledUntil').lean();
      const campaignPausedAfterClaim = latestState?.status === 'paused';

      if (result.success) {
        logger.info({
          campaignId: String(refreshCampaign._id),
          recipientId: String(recipient._id),
          provider: emailConfig.provider,
          attempt: job.attemptCount,
          latencyMs,
          status: 'sent',
          errorCode: null
        }, 'Campaign email sent');
        metrics.incrementCounter('campaign_pipeline.sent');
        await markJobSent({
          job,
          recipient,
          provider: emailConfig.provider,
          providerMessageId: result.providerMessageId,
          subject: result.subject
        });
        broadcastProgress(refreshCampaign._id, 'campaign.sent').catch(() => null);
        return;
      }

      const retryDecision = buildRetryDecision(result, job.attemptCount);
      const isGoogle429 = retryDecision.statusCode === 429 && String(result.providerError?.error?.status || result.providerError?.status || '').toUpperCase() === 'RESOURCE_EXHAUSTED';
      if (campaignPausedAfterClaim) {
        await markJobPaused({ job, recipient });
        return;
      }

      if (retryDecision.retryable && job.attemptCount < (job.maxAttempts || this.maxAttempts)) {
        logger.warn({
          campaignId: String(refreshCampaign._id),
          recipientId: String(recipient._id),
          provider: emailConfig.provider,
          attempt: job.attemptCount,
          latencyMs,
          status: 'retrying',
          errorCode: retryDecision.statusCode || result.statusCode || null
        }, 'Campaign email retry scheduled');
        metrics.incrementCounter(isGoogle429 ? 'campaign_pipeline.google_429' : 'campaign_pipeline.retrying');
        await markJobRetrying({
          job,
          recipient,
          error: {
            message: result.error || 'Temporary delivery failure',
            statusCode: retryDecision.statusCode || result.statusCode || null,
            providerStatus: result.providerError?.error?.status || result.providerError?.status || null,
            retryable: true,
            retryAfterMs: retryDecision.retryAfterMs,
            details: result.providerError || null
          },
          retryAfterMs: retryDecision.retryAfterMs,
          provider: emailConfig.provider,
          providerMessageId: result.providerMessageId || null
        });
        broadcastProgress(refreshCampaign._id, 'campaign.retrying').catch(() => null);
        return;
      }

      metrics.incrementCounter('campaign_pipeline.failed');
      logger.error({
        campaignId: String(refreshCampaign._id),
        recipientId: String(recipient._id),
        provider: emailConfig.provider,
        attempt: job.attemptCount,
        latencyMs,
        status: 'failed',
        errorCode: retryDecision.statusCode || result.statusCode || null
      }, 'Campaign email dead-lettered');
      await markJobDeadLetter({
        job,
        recipient,
        provider: emailConfig.provider,
        error: {
          message: result.error || 'Permanent delivery failure',
          statusCode: retryDecision.statusCode || result.statusCode || null,
          providerStatus: result.providerError?.error?.status || result.providerError?.status || null,
          retryable: false,
          details: result.providerError || null
        },
        providerMessageId: result.providerMessageId || null
      });
      broadcastProgress(refreshCampaign._id, 'campaign.failed').catch(() => null);
    } catch (error) {
      const retryDecision = buildRetryDecision({
        success: false,
        error: error.message,
        statusCode: error.statusCode || error.response?.status,
        providerError: error.providerError || error.response?.data || null,
        response: error.response
      }, job.attemptCount);

      const latestState = await Campaign.findById(refreshCampaign._id).select('status queue.throttledUntil').lean();
      if (latestState?.status === 'paused') {
        await markJobPaused({ job, recipient });
        return;
      }

      if (retryDecision.retryable && job.attemptCount < (job.maxAttempts || this.maxAttempts)) {
        logger.warn({
          campaignId: String(refreshCampaign._id),
          recipientId: String(recipient._id),
          provider: emailConfig.provider,
          attempt: job.attemptCount,
          status: 'retrying',
          errorCode: retryDecision.statusCode || error.statusCode || error.response?.status || null
        }, 'Campaign email retry scheduled after exception');
        metrics.incrementCounter('campaign_pipeline.retrying');
        await markJobRetrying({
          job,
          recipient,
          error: {
            message: error.message,
            statusCode: retryDecision.statusCode || error.statusCode || error.response?.status || null,
            providerStatus: error.providerError?.error?.status || error.response?.data?.error?.status || null,
            retryable: true,
            retryAfterMs: retryDecision.retryAfterMs,
            details: error.response?.data || error.providerError || null
          },
          retryAfterMs: retryDecision.retryAfterMs,
          provider: emailConfig.provider
        });
        broadcastProgress(refreshCampaign._id, 'campaign.retrying').catch(() => null);
        return;
      }

      metrics.incrementCounter('campaign_pipeline.failed');
      logger.error({
        campaignId: String(refreshCampaign._id),
        recipientId: String(recipient._id),
        provider: emailConfig.provider,
        attempt: job.attemptCount,
        status: 'failed',
        errorCode: retryDecision.statusCode || error.statusCode || error.response?.status || null
      }, 'Campaign email dead-lettered after exception');
      await markJobDeadLetter({
        job,
        recipient,
        provider: emailConfig.provider,
        error: {
          message: error.message,
          statusCode: retryDecision.statusCode || error.statusCode || error.response?.status || null,
          providerStatus: error.providerError?.error?.status || error.response?.data?.error?.status || null,
          retryable: false,
          details: error.response?.data || error.providerError || null
        }
      });
      broadcastProgress(refreshCampaign._id, 'campaign.failed').catch(() => null);
    }
  }

  async getMetrics() {
    const counts = await Campaign.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    return {
      counters: metrics.snapshot().counters,
      gauges: metrics.snapshot().gauges,
      throughputPerMinute: metrics.getThroughputPerMinute(),
      campaignsByStatus: counts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };
  }

  async getHealth() {
    const snapshot = metrics.snapshot();
    const counters = snapshot.counters || {};
    const sent = counters['campaign_pipeline.sent'] || 0;
    const failed = counters['campaign_pipeline.failed'] || 0;
    const retrying = counters['campaign_pipeline.retrying'] || 0;
    const totalEvents = sent + failed + retrying;
    const successRate = totalEvents > 0 ? Math.round((sent / totalEvents) * 10000) / 100 : 100;
    const failureRate = totalEvents > 0 ? Math.round((failed / totalEvents) * 10000) / 100 : 0;
    const [queuedJobs, activeJobs, deadLetterCount] = await Promise.all([
      countQueuedJobsAll(),
      countActiveJobsAll(),
      CampaignDeadLetter.countDocuments({})
    ]);

    return {
      database: {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'degraded',
        readyState: mongoose.connection.readyState
      },
      queue: {
        health: activeJobs > 0 || queuedJobs > 0 ? 'healthy' : 'idle',
        queuedJobs,
        activeJobs,
        deadLetters: deadLetterCount
      },
      providers: providerRegistry.getProviderStatuses(),
      successRate,
      failureRate,
      throughputPerMinute: metrics.getThroughputPerMinute(),
      queuePipeline: {
        workerCount: this.workerCount,
        batchSize: this.batchSize,
        started: this.started,
        throttled: Boolean(snapshot.gauges?.['campaign_pipeline.active_campaigns'])
      }
    };
  }

  async listDeadLettersForCampaign(campaignId) {
    return listDeadLetters(campaignId);
  }

  async requeueDeadLetter(deadLetterId, requeueMeta = {}) {
    const deadLetter = await requeueDeadLetterRepo({ deadLetterId, requeueMeta });
    if (!deadLetter) {
      throw new Error('Dead letter entry not found');
    }

    metrics.incrementCounter('campaign_pipeline.dlq_requeued');
    broadcastProgress(deadLetter.campaignId, 'campaign.dlq.requeued').catch(() => null);
    return deadLetter;
  }
}

module.exports = new CampaignPipelineService();
