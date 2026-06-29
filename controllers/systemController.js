const campaignPipeline = require('../services/campaignPipeline/campaignPipelineService');

exports.getPipelineMetrics = async (req, res) => {
  try {
    const metrics = await campaignPipeline.getMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getHealth = async (req, res) => {
  try {
    const health = await campaignPipeline.getHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const os = require('os');
const { getActiveConnectionsCount } = require('../services/mailboxService');
const { getApiMetrics } = require('../middleware/apiTracker');

exports.getSystemMetrics = async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const memory = {
      rss: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
      external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100,
      freeSystem: Math.round(os.freemem() / 1024 / 1024 * 100) / 100,
      totalSystem: Math.round(os.totalmem() / 1024 / 1024 * 100) / 100
    };

    const cpuLoad = os.loadavg();
    const system = {
      uptime: process.uptime(),
      loadAvg1: Math.round(cpuLoad[0] * 100) / 100,
      loadAvg5: Math.round(cpuLoad[1] * 100) / 100,
      loadAvg15: Math.round(cpuLoad[2] * 100) / 100,
      activeImapConnections: getActiveConnectionsCount()
    };

    const api = getApiMetrics();

    res.json({
      success: true,
      data: {
        timestamp: new Date(),
        memory,
        system,
        api
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const User = require('../models/User');
const Campaign = require('../models/Campaign');

exports.getAdminStats = async (req, res) => {
  try {
    const users = await User.find({}, 'name email createdAt reuploadNotificationPending')
      .sort({ createdAt: -1 })
      .lean();

    const api = getApiMetrics();

    const activeCampaigns = await Campaign.find(
      { status: 'sending' },
      'name stats status userId startedAt'
    ).lean();

    const progressStats = activeCampaigns.map(c => {
      const total = c.stats?.total || 0;
      const sent = c.stats?.sent || 0;
      const failed = c.stats?.failed || 0;
      const progress = total > 0 ? Math.min(100, Math.round(((sent + failed) / total) * 100)) : 0;
      return {
        id: c._id,
        name: c.name,
        total,
        sent,
        failed,
        progress,
        startedAt: c.startedAt
      };
    });

    res.json({
      success: true,
      data: {
        users,
        api,
        progressStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const { exec } = require('child_process');

exports.runStressTest = async (req, res) => {
  const { connections, duration, url, authHeader } = req.body;

  const conn = Math.min(100, Math.max(1, parseInt(connections) || 10));
  const dur = Math.min(30, Math.max(1, parseInt(duration) || 5));

  let targetUrl = url || 'https://mail-merge-server-982k.onrender.com/api/emails?folder=inbox';

  if (!targetUrl.startsWith('https://mail-merge-server-982k.onrender.com') && !targetUrl.startsWith('https://mail-merge-server-982k.onrender.com') && !targetUrl.startsWith('/api')) {
    return res.status(400).json({ success: false, message: 'Invalid target URL. Benchmarks are restricted to internal APIs only.' });
  }

  // If relative path, prefix with localhost
  if (targetUrl.startsWith('/api')) {
    targetUrl = `https://mail-merge-server-982k.onrender.com${targetUrl}`;
  }

  const cleanUrl = targetUrl.replace(/"/g, '').replace(/`/g, '');
  const cleanAuth = authHeader ? `-H "Authorization=${authHeader.replace(/"/g, '').replace(/`/g, '')}"` : '';

  const cmd = `npx --yes autocannon -c ${conn} -d ${dur} ${cleanAuth} "${cleanUrl}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ success: false, message: error.message, stderr });
    }
    res.json({
      success: true,
      data: {
        command: `autocannon -c ${conn} -d ${dur} ${cleanUrl}`,
        output: stdout,
        errors: stderr
      }
    });
  });
};
