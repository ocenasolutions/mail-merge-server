const Sheet = require('../models/Sheet');
const User = require('../models/User');
const { getSheetData: fetchSheetData, extractSheetId } = require('../services/googleSheetsService');

exports.getSheets = async (req, res) => {
  try {
    const sheets = await Sheet.find({ userId: req.user._id });
    res.json({ success: true, data: sheets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSheet = async (req, res) => {
  try {
    const sheet = await Sheet.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    res.json({ success: true, data: sheet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.connectSheet = async (req, res) => {
  try {
    const { url, name } = req.body;
    const sheetId = extractSheetId(url);

    if (!sheetId) {
      return res.status(400).json({ success: false, message: 'Invalid Google Sheets URL' });
    }

    const user = await User.findById(req.user._id);
    const sheetData = await fetchSheetData(sheetId, user.googleAccessToken, user.googleRefreshToken);

    const sheet = await Sheet.create({
      userId: req.user._id,
      sheetId,
      name: name || sheetData.name,
      url,
      columns: sheetData.columns,
      lastSynced: new Date()
    });

    res.status(201).json({ success: true, data: sheet });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteSheet = async (req, res) => {
  try {
    const sheet = await Sheet.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    res.json({ success: true, message: 'Sheet deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSheetData = async (req, res) => {
  try {
    const sheet = await Sheet.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    const user = await User.findById(req.user._id);
    const data = await fetchSheetData(sheet.sheetId, user.googleAccessToken, user.googleRefreshToken);

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.syncSheet = async (req, res) => {
  try {
    const sheet = await Sheet.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    const user = await User.findById(req.user._id);
    const sheetData = await fetchSheetData(sheet.sheetId, user.googleAccessToken, user.googleRefreshToken);

    sheet.columns = sheetData.columns;
    sheet.lastSynced = new Date();
    await sheet.save();

    res.json({ success: true, data: sheet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
