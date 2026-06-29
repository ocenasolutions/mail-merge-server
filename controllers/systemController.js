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
