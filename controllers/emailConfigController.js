const EmailConfig = require('../models/EmailConfig');
const { testEmailConnection } = require('../services/emailService');
const { listMailboxes, listMessages, getMessageDetail, supportsMailbox } = require('../services/mailboxService');
const { appendEmailDebugLog } = require('../utils/emailDebugLogger');
const logger = require('../utils/logger');

exports.getConfigs = async (req, res) => {
  try {
    const configs = await EmailConfig.find({ userId: req.user._id })
      .select('-config.password -config.apiKey -config.imapPassword');
    
    res.json({ success: true, data: configs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getConfig = async (req, res) => {
  try {
    const config = await EmailConfig.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).select('-config.password -config.apiKey -config.imapPassword');

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createConfig = async (req, res) => {
  try {
    const config = await EmailConfig.create({
      ...req.body,
      userId: req.user._id
    });

    // Remove sensitive data from response
    config.config.password = undefined;
    config.config.apiKey = undefined;
    config.config.imapPassword = undefined;

    res.status(201).json({ success: true, data: config });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const config = await EmailConfig.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true, runValidators: true }
    ).select('-config.password -config.apiKey -config.imapPassword');

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    res.json({ success: true, data: config });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getMailboxes = async (req, res) => {
  try {
    const config = await EmailConfig.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    if (!supportsMailbox(config)) {
      return res.status(400).json({ success: false, message: 'Mailbox sync is not supported for this provider' });
    }

    const User = require('../models/User');
    const userWithTokens = await User.findById(req.user._id);
    const mailboxes = await listMailboxes(config, userWithTokens);

    res.json({ success: true, data: mailboxes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const config = await EmailConfig.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    if (!supportsMailbox(config)) {
      return res.status(400).json({ success: false, message: 'Mailbox sync is not supported for this provider' });
    }

    const User = require('../models/User');
    const userWithTokens = await User.findById(req.user._id);
    const folder = req.query.folder === 'sent' ? 'sent' : 'inbox';
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const data = await listMessages(config, userWithTokens, { folder, limit, offset });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMessageDetail = async (req, res) => {
  try {
    const config = await EmailConfig.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    if (!supportsMailbox(config)) {
      return res.status(400).json({ success: false, message: 'Mailbox sync is not supported for this provider' });
    }

    const User = require('../models/User');
    const userWithTokens = await User.findById(req.user._id);
    const folder = req.query.folder === 'sent' ? 'sent' : 'inbox';
    const uid = parseInt(req.params.uid, 10);

    if (!uid) {
      return res.status(400).json({ success: false, message: 'Valid message uid is required' });
    }

    const data = await getMessageDetail(config, userWithTokens, { folder, uid });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteConfig = async (req, res) => {
  try {
    const config = await EmailConfig.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    res.json({ success: true, message: 'Config deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.testConnection = async (req, res) => {
  try {
    const config = await EmailConfig.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    // For Gmail, we need the full user object with OAuth tokens
    const User = require('../models/User');
    const userWithTokens = await User.findById(req.user._id);
    const submittedAccount = req.body?.account || {};
    const mergedConfig = config.toObject ? config.toObject() : { ...config };

    if (submittedAccount && typeof submittedAccount === 'object') {
      mergedConfig.config = {
        ...(mergedConfig.config || {}),
        ...submittedAccount,
      };

      if (submittedAccount.email) {
        mergedConfig.email = submittedAccount.email;
      }
    }

    const result = await testEmailConnection(mergedConfig, userWithTokens);

    config.verified = !!result.success;
    await config.save();

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.testConfig = async (req, res) => {
  try {
    const { testEmail } = req.body;
    
    if (!testEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'testEmail is required' 
      });
    }

    const config = await EmailConfig.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    // For Gmail, we need the full user object with OAuth tokens
    const User = require('../models/User');
    const userWithTokens = await User.findById(req.user._id);
    const { sendEmail } = require('../services/emailService');
    const crypto = require('crypto');

    const trackingId = crypto.randomUUID();
    const subject = 'Test Email from Mail Merge';
    const body = `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center;">
            <h1 style="color: white; margin: 0;">✅ Test Email Successful!</h1>
          </div>
          
          <div style="background: #f7fafc; padding: 30px; border-radius: 10px; margin-top: 20px;">
            <h2 style="color: #2d3748; margin-top: 0;">Your email configuration is working correctly!</h2>
            
            <p style="color: #4a5568; line-height: 1.6;">
              This is a test email from your Mail Merge application. If you received this email, 
              your email configuration has been set up successfully and is ready to send campaigns.
            </p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
              <h3 style="color: #2d3748; margin-top: 0;">Configuration Details:</h3>
              <table style="width: 100%; color: #4a5568;">
                <tr>
                  <td style="padding: 8px 0;"><strong>Provider:</strong></td>
                  <td style="padding: 8px 0;">${config.provider}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Config Name:</strong></td>
                  <td style="padding: 8px 0;">${config.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>From:</strong></td>
                  <td style="padding: 8px 0;">${config.config.email || userWithTokens.email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Sent at:</strong></td>
                  <td style="padding: 8px 0;">${new Date().toLocaleString()}</td>
                </tr>
              </table>
            </div>
            
            <div style="background: #edf2f7; padding: 15px; border-radius: 8px; margin-top: 20px;">
              <p style="color: #4a5568; margin: 0; font-size: 14px;">
                <strong>💡 Next Steps:</strong><br/>
                You can now create campaigns and send personalized bulk emails using this configuration.
              </p>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
            <p style="color: #a0aec0; font-size: 12px; margin: 0;">
              Sent by Mail Merge Application<br/>
              This is an automated test email
            </p>
          </div>
        </body>
      </html>
    `;

    logger.info({
      provider: config.provider,
      from: config.config.email || userWithTokens.email,
      to: testEmail,
      trackingId
    }, 'Sending test email for email config');
    appendEmailDebugLog('email_config_test_requested', {
      configId: String(config._id),
      provider: config.provider,
      from: config.config.email || userWithTokens.email,
      to: testEmail,
      trackingId
    });

    const result = await sendEmail(
      config,
      userWithTokens,
      testEmail,
      subject,
      body,
      trackingId
    );

    if (result.success) {
      logger.info({ provider: config.provider, trackingId }, 'Test email sent successfully');
      config.verified = true;
      await config.save();
      
      res.json({ 
        success: true, 
        message: `Test email sent successfully to ${testEmail}`,
        trackingId
      });
    } else {
      logger.warn({ provider: config.provider, trackingId, error: result.error }, 'Test email failed');
      appendEmailDebugLog('email_config_test_failed', {
        configId: String(config._id),
        provider: config.provider,
        from: config.config.email || userWithTokens.email,
        to: testEmail,
        trackingId,
        error: result.error,
        providerStatus: result.statusCode,
        providerError: result.providerError
      });
      res.status(500).json({ 
        success: false, 
        message: `Failed to send test email: ${result.error}`,
        provider: config.provider,
        providerStatus: result.statusCode,
        providerError: result.providerError
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'Test email error');
    res.status(500).json({ success: false, message: error.message });
  }
};
