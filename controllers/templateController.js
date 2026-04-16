const Template = require('../models/Template');

exports.getTemplates = async (req, res) => {
  try {
    const templates = await Template.find({ userId: req.user._id });
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTemplate = async (req, res) => {
  try {
    const template = await Template.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTemplate = async (req, res) => {
  try {
    const template = await Template.create({
      ...req.body,
      userId: req.user._id
    });

    res.status(201).json({ success: true, data: template });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const template = await Template.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
