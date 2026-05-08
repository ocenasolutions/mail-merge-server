const EmailConfig = require('../models/EmailConfig');
const { testEmailConnection } = require('../services/emailService');

exports.getConfigs = async (req, res) => {
  try {
    const configs = await EmailConfig.find({ userId: req.user._id })
      .select('-config.password -config.apiKey');
    
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
    }).select('-config.password -config.apiKey');

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
    ).select('-config.password -config.apiKey');

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    res.json({ success: true, data: config });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
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

exports.testConfig = async (req, res) => {
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

    const result = await testEmailConnection(config, userWithTokens);

    if (result.success) {
      config.verified = true;
      await config.save();
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
