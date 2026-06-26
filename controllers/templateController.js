const Template = require('../models/Template');

const hasHtml = (value = '') => /<\/?[a-z][\s\S]*>/i.test(String(value));
const hasBlockHtml = (value = '') => /<(p|div|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|blockquote|br)\b/i.test(String(value));

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const decodeHtmlEntities = (value = '') => String(value)
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, '\'')
  .replace(/&amp;/gi, '&');

const normalizeTemplateHtml = (value = '') => {
  const input = String(value || '').trim();
  if (!input) return '';

  const decoded = decodeHtmlEntities(input);

  if (hasHtml(decoded) && hasBlockHtml(decoded)) {
    return decoded;
  }

  if (hasHtml(decoded)) {
    return decoded
      .split(/\r?\n\r?\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
      .join('');
  }

  return escapeHtml(decoded)
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
};

const normalizeTemplatePayload = (payload = {}) => {
  const body = String(payload.body || '').trim();
  const htmlSource = String(payload.html || body || '').trim();
  const normalizedHtml = normalizeTemplateHtml(htmlSource);

  return {
    ...payload,
    body: body || htmlSource,
    html: normalizedHtml || htmlSource || body
  };
};

exports.getTemplates = async (req, res) => {
  try {
    const templates = await Template.find({ userId: req.user._id }).select('-attachments.contentBase64');
    res.json({
      success: true,
      data: templates.map((template) => ({
        ...template.toObject(),
        html: normalizeTemplateHtml(template.html || template.body || ''),
        body: template.body || ''
      }))
    });
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
    let attachments = [];
    if (req.body.attachments) {
      try {
        const raw = Array.isArray(req.body.attachments)
          ? req.body.attachments
          : JSON.parse(req.body.attachments);
        
        attachments = (raw || []).map((att) => ({
          name: att.name,
          mimeType: att.mimeType || 'application/octet-stream',
          size: typeof att.size === 'number' ? att.size : (att.bytes || parseInt(String(att.size)) || 0),
          contentBase64: att.contentBase64,
          url: att.url
        }));
      } catch (err) {
        // ignore
      }
    }

    const s3Service = require('../services/s3Service');
    const logger = require('../utils/logger');
    const uploadedAttachments = req.files || [];
    const newAttachments = await Promise.all(
      uploadedAttachments.map(async (file) => {
        if (s3Service.isConfigured()) {
          try {
            const url = await s3Service.uploadToS3(file.buffer, file.originalname, file.mimetype || 'application/octet-stream');
            return {
              name: file.originalname,
              mimeType: file.mimetype || 'application/octet-stream',
              size: file.size || 0,
              contentBase64: '',
              url
            };
          } catch (s3Error) {
            logger.error({ err: s3Error }, 'Failed to upload template attachment to S3, falling back to Base64');
            return {
              name: file.originalname,
              mimeType: file.mimetype || 'application/octet-stream',
              size: file.size || 0,
              contentBase64: file.buffer.toString('base64')
            };
          }
        } else {
          return {
            name: file.originalname,
            mimeType: file.mimetype || 'application/octet-stream',
            size: file.size || 0,
            contentBase64: file.buffer.toString('base64')
          };
        }
      })
    );

    const finalAttachments = [...attachments, ...newAttachments];

    const template = await Template.create({
      ...normalizeTemplatePayload(req.body),
      attachments: finalAttachments,
      userId: req.user._id
    });

    res.status(201).json({ success: true, data: template });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    let attachments = [];
    if (req.body.attachments) {
      try {
        const raw = Array.isArray(req.body.attachments)
          ? req.body.attachments
          : JSON.parse(req.body.attachments);
        
        attachments = (raw || []).map((att) => ({
          name: att.name,
          mimeType: att.mimeType || 'application/octet-stream',
          size: typeof att.size === 'number' ? att.size : (att.bytes || parseInt(String(att.size)) || 0),
          contentBase64: att.contentBase64,
          url: att.url
        }));
      } catch (err) {
        // ignore
      }
    }

    const s3Service = require('../services/s3Service');
    const logger = require('../utils/logger');
    const uploadedAttachments = req.files || [];
    const newAttachments = await Promise.all(
      uploadedAttachments.map(async (file) => {
        if (s3Service.isConfigured()) {
          try {
            const url = await s3Service.uploadToS3(file.buffer, file.originalname, file.mimetype || 'application/octet-stream');
            return {
              name: file.originalname,
              mimeType: file.mimetype || 'application/octet-stream',
              size: file.size || 0,
              contentBase64: '',
              url
            };
          } catch (s3Error) {
            logger.error({ err: s3Error }, 'Failed to upload template attachment to S3, falling back to Base64');
            return {
              name: file.originalname,
              mimeType: file.mimetype || 'application/octet-stream',
              size: file.size || 0,
              contentBase64: file.buffer.toString('base64')
            };
          }
        } else {
          return {
            name: file.originalname,
            mimeType: file.mimetype || 'application/octet-stream',
            size: file.size || 0,
            contentBase64: file.buffer.toString('base64')
          };
        }
      })
    );

    const finalAttachments = [...attachments, ...newAttachments];

    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        ...normalizeTemplatePayload(req.body),
        attachments: finalAttachments
      },
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({
      success: true,
      data: {
        ...template.toObject(),
        html: normalizeTemplateHtml(template.html || template.body || ''),
        body: template.body || ''
      }
    });
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
