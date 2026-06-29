const requestTimes = [];
let totalRequests = 0;
const statusCodes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
const routeStats = {};
const requestHistory = [];
const HISTORY_LIMIT = 30;

const cleanOldRequests = () => {
  const now = Date.now();
  const threshold = now - 60000; // 1 minute window
  while (requestTimes.length > 0 && requestTimes[0] < threshold) {
    requestTimes.shift();
  }
};

const apiTrackerMiddleware = (req, res, next) => {
  const start = process.hrtime();
  
  // Clean up old requests on new request arrival
  cleanOldRequests();
  
  // Track this request timestamp
  requestTimes.push(Date.now());
  totalRequests++;

  res.on('finish', () => {
    // Exclude calls to metrics endpoints from monitoring to prevent noise
    if (req.originalUrl.includes('/api/metrics')) {
      return;
    }

    const diff = process.hrtime(start);
    const durationMs = Math.round((diff[0] * 1e3 + diff[1] * 1e-6) * 100) / 100;
    const status = res.statusCode;

    // Track status code family
    const statusFamily = `${Math.floor(status / 100)}xx`;
    if (statusCodes[statusFamily] !== undefined) {
      statusCodes[statusFamily]++;
    } else {
      statusCodes[statusFamily] = 1;
    }

    // Normalize route path (e.g. remove IDs/query params)
    let pathPattern = req.baseUrl + req.path;
    if (req.params) {
      // Replace parameter values with parameter keys if possible
      Object.keys(req.params).forEach(key => {
        pathPattern = pathPattern.replace(req.params[key], `:${key}`);
      });
    }

    // Keep statistics per method + route path
    const routeKey = `${req.method} ${pathPattern}`;
    if (!routeStats[routeKey]) {
      routeStats[routeKey] = {
        count: 0,
        totalDuration: 0,
        maxDuration: 0,
        avgDuration: 0
      };
    }
    const stats = routeStats[routeKey];
    stats.count++;
    stats.totalDuration += durationMs;
    stats.maxDuration = Math.max(stats.maxDuration, durationMs);
    stats.avgDuration = Math.round((stats.totalDuration / stats.count) * 100) / 100;

    // Add to request history
    requestHistory.unshift({
      timestamp: new Date(),
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs
    });

    if (requestHistory.length > HISTORY_LIMIT) {
      requestHistory.pop();
    }
  });

  next();
};

const getApiMetrics = () => {
  cleanOldRequests();
  return {
    totalRequests,
    requestsLastMinute: requestTimes.length,
    requestsPerSecond: Math.round((requestTimes.length / 60) * 100) / 100,
    statusCodes,
    routeStats,
    requestHistory
  };
};

module.exports = {
  middleware: apiTrackerMiddleware,
  getApiMetrics
};
