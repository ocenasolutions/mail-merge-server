const {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS
} = require('./constants');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const computeExponentialBackoffMs = (attemptCount, options = {}) => {
  const baseMs = options.baseMs || DEFAULT_BACKOFF_BASE_MS;
  const maxMs = options.maxMs || DEFAULT_BACKOFF_MAX_MS;
  const attempt = Math.max(1, Number(attemptCount) || 1);
  const ceiling = Math.min(maxMs, baseMs * (2 ** (attempt - 1)));
  const jittered = Math.floor(Math.random() * ceiling);
  return clamp(jittered, baseMs, maxMs);
};

const getRetryAfterMsFromHeaders = (headers = {}) => {
  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (!retryAfter) return null;

  const parsedSeconds = Number(retryAfter);
  if (Number.isFinite(parsedSeconds)) {
    return Math.max(0, parsedSeconds * 1000);
  }

  const parsedDate = Date.parse(retryAfter);
  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.max(0, parsedDate - Date.now());
};

const isGoogleResourceExhausted = (error = {}) => {
  const statusCode = error?.statusCode || error?.response?.status;
  const providerStatus = error?.providerError?.error?.status
    || error?.providerError?.error?.errors?.[0]?.reason
    || error?.response?.data?.error?.status
    || error?.response?.data?.error?.errors?.[0]?.reason
    || error?.code
    || error?.status;

  const message = String(error?.error || error?.message || error?.providerError?.message || '').toUpperCase();

  return statusCode === 429
    && (providerStatus === 'RESOURCE_EXHAUSTED'
      || message.includes('RESOURCE_EXHAUSTED')
      || message.includes('RATE LIMIT')
      || message.includes('TOO MANY REQUESTS'));
};

const isRetryableDeliveryFailure = (result = {}) => {
  if (result.success) return false;

  const statusCode = result.statusCode || result.response?.status;
  const providerStatus = result.providerError?.error?.status
    || result.providerError?.error?.errors?.[0]?.reason
    || result.providerError?.status
    || result.providerStatus
    || result.errorCode;
  const message = String(result.error || result.message || '').toLowerCase();

  if (isGoogleResourceExhausted(result)) {
    return true;
  }

  if (statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    return true;
  }

  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED', 'EPIPE'].includes(providerStatus)) {
    return true;
  }

  return message.includes('timeout')
    || message.includes('temporarily')
    || message.includes('try again')
    || message.includes('resource_exhausted')
    || message.includes('rate limit')
    || message.includes('too many requests');
};

const buildRetryDecision = (result = {}, attemptCount = 1) => {
  if (result.success) {
    return {
      retryable: false,
      retryAfterMs: null,
      reason: null
    };
  }

  const statusCode = result.statusCode || result.response?.status || null;
  const retryAfterFromHeaders = getRetryAfterMsFromHeaders(result.headers || result.response?.headers || {});
  const retryable = isRetryableDeliveryFailure(result);
  const retryAfterMs = retryAfterFromHeaders || (retryable
    ? computeExponentialBackoffMs(attemptCount)
    : null);

  return {
    retryable,
    retryAfterMs,
    reason: result.error || result.message || 'Delivery failed',
    statusCode
  };
};

module.exports = {
  buildRetryDecision,
  computeExponentialBackoffMs,
  isGoogleResourceExhausted,
  isRetryableDeliveryFailure,
  getRetryAfterMsFromHeaders
};
