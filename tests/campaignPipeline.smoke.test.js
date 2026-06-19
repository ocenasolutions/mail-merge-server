const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRetryDecision } = require('../services/campaignPipeline/backoff');
const {
  buildPauseState,
  buildResumeState,
  buildRestartState,
  shouldRecoverExpiredLease,
  shouldSkipDuplicateSend
} = require('../services/campaignPipeline/stateRules');
const {
  buildJobKey,
  buildMessageId
} = require('../services/campaignPipeline/queueRepository');

test('pause, resume, and restart transitions are deterministic', () => {
  const campaign = {
    startedAt: new Date('2026-06-01T00:00:00.000Z'),
    stats: { total: 25 },
    queue: { workerCount: 4, batchSize: 25, pausedAt: null }
  };

  const paused = buildPauseState(campaign);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.queue.throttledUntil, null);
  assert.ok(paused.queue.pausedAt instanceof Date);

  const resumed = buildResumeState(campaign);
  assert.equal(resumed.status, 'sending');
  assert.equal(resumed.completedAt, null);
  assert.ok(resumed.startedAt instanceof Date);

  const restarted = buildRestartState(campaign, 4, 25);
  assert.equal(restarted.status, 'sending');
  assert.equal(restarted.stats.sent, 0);
  assert.equal(restarted.queue.failedJobCount, 0);
});

test('retry logic treats google 429 RESOURCE_EXHAUSTED as retryable', () => {
  const decision = buildRetryDecision({
    success: false,
    error: 'Rate limited',
    statusCode: 429,
    providerError: { error: { status: 'RESOURCE_EXHAUSTED' } }
  }, 2);

  assert.equal(decision.retryable, true);
  assert.ok(decision.retryAfterMs > 0);
  assert.equal(decision.statusCode, 429);
});

test('worker crash recovery can reclaim expired processing jobs', () => {
  const staleJob = {
    status: 'processing',
    leaseExpiresAt: new Date(Date.now() - 10_000)
  };
  const freshJob = {
    status: 'processing',
    leaseExpiresAt: new Date(Date.now() + 60_000)
  };

  assert.equal(shouldRecoverExpiredLease(staleJob), true);
  assert.equal(shouldRecoverExpiredLease(freshJob), false);
});

test('duplicate prevention keys are stable and recipient state blocks resends', () => {
  const first = buildJobKey('campaign-1', 'recipient-1');
  const second = buildJobKey('campaign-1', 'recipient-1');
  const other = buildJobKey('campaign-1', 'recipient-2');

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(buildMessageId('campaign-1', 'recipient-1'), buildMessageId('campaign-1', 'recipient-1'));
  assert.equal(shouldSkipDuplicateSend({ status: 'sent' }), true);
  assert.equal(shouldSkipDuplicateSend({ status: 'pending' }), false);
});
