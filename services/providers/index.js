const logger = require('../../utils/logger');
const { createLimiter } = require('./limiter');
const gmailProvider = require('./gmailProvider');
const sendgridProvider = require('./sendgridProvider');
const sesProvider = require('./sesProvider');
const smtpProvider = require('./smtpProvider');
const legacyProvider = require('./legacyProvider');

const limiter = createLimiter();

const providers = {
  gmail: gmailProvider,
  sendgrid: sendgridProvider,
  brevo: legacyProvider,
  mailgun: legacyProvider,
  smtp: smtpProvider,
  outlook: smtpProvider,
  godaddy: smtpProvider,
  hostinger: smtpProvider,
  titan: smtpProvider,
  ses: sesProvider
};

const resolveProvider = (emailConfig) => {
  const providerName = String(emailConfig?.provider || 'smtp').toLowerCase();
  
  if (providerName === 'gmail' && emailConfig && !emailConfig.gmailRefreshToken && (emailConfig.config?.password || emailConfig.smtpPassword)) {
    return smtpProvider;
  }
  
  return providers[providerName] || smtpProvider;
};

const send = async (payload) => limiter.schedule(async () => {
  const provider = resolveProvider(payload?.emailConfig);
  const startedAt = Date.now();
  try {
    const result = await provider.send(payload);
    return {
      ...result,
      provider: provider.name || payload?.emailConfig?.provider || 'smtp',
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    logger.error({
      provider: provider.name || payload?.emailConfig?.provider || 'smtp',
      errorCode: error.response?.status || error.statusCode || error.code || null,
      message: error.message
    }, 'Provider send failure');
    throw error;
  }
});

const getProviderStatuses = () => Object.keys(providers).reduce((acc, providerName) => {
  acc[providerName] = {
    available: true
  };
  return acc;
}, {});

module.exports = {
  send,
  resolveProvider,
  getProviderStatuses
};
