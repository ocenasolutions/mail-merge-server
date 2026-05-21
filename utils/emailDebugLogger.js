const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'email-debug.log');

const isLocalDebugEnabled = () => {
  if (process.env.EMAIL_DEBUG_LOGS === 'true') return true;
  if (process.env.EMAIL_DEBUG_LOGS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
};

const redactApiKey = (value = '') => {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 10) return `${text.slice(0, 2)}...redacted`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
};

const safeJson = (value) => {
  if (!value) return value;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
};

const appendEmailDebugLog = (event, data = {}) => {
  if (!isLocalDebugEnabled()) {
    return;
  }

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...safeJson(data)
      })}\n`
    );
  } catch (error) {
    // File logging must not break email sending or API responses.
  }
};

module.exports = {
  LOG_FILE,
  appendEmailDebugLog,
  isLocalDebugEnabled,
  redactApiKey
};
