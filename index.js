require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const cron = require('node-cron');
const pinoHttp = require('pino-http');
const logger = require('./utils/logger');
const systemController = require('./controllers/systemController');
const realtimeHub = require('./services/realtime/campaignRealtimeHub');

const app = express();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '50mb';

// Pino HTTP logger middleware
app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === '/health' // Don't log health checks
  },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
    if (res.statusCode >= 500 || err) return 'error';
    return 'info';
  }
}));

// Middleware
app.use(helmet());

// CORS configuration to support multiple origins
const normalizeOrigin = (value) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    return String(value).replace(/\/$/, '');
  }
};

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://emaildropp.netlify.app',
  'https://aischcool.com',
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  ...(process.env.ADDITIONAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
]
  .map(normalizeOrigin)
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const normalizedOrigin = normalizeOrigin(origin);
    const isAllowed = allowedOrigins.includes(normalizedOrigin);

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${normalizedOrigin}`));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));
app.use(cookieParser());
app.use(passport.initialize());

// Passport config
require('./config/passport')(passport);

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => logger.info('MongoDB connected'))
  .catch(err => logger.error({ err }, 'MongoDB connection error'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/email-configs', require('./routes/emailConfigs'));
app.use('/api/sheets', require('./routes/sheets'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/emails', require('./routes/emails'));
app.use('/api/metrics', require('./routes/metrics'));
app.get('/health', systemController.getHealth);

// Tracking pixel endpoint
app.get('/track/:trackingId', require('./controllers/trackingController').trackOpen);

// Test tracking endpoint (for debugging)
app.get('/test-tracking/:trackingId', async (req, res) => {
  const Recipient = require('./models/Recipient');
  const recipient = await Recipient.findOne({ trackingId: req.params.trackingId });
  res.json({
    trackingId: req.params.trackingId,
    found: !!recipient,
    recipient: recipient ? {
      email: recipient.email,
      status: recipient.status,
      sentAt: recipient.sentAt
    } : null,
    trackingUrl: `${process.env.APP_URL}/track/${req.params.trackingId}`
  });
});

// Scheduled tasks
require('./services/schedulerService');

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err, req: { method: req.method, url: req.url } }, 'Request error');
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

const server = http.createServer(app);
realtimeHub.attach(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info({ 
    port: PORT, 
    env: process.env.NODE_ENV,
    appUrl: process.env.APP_URL 
  }, 'Server started');
});
