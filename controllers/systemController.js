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
