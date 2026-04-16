require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const cron = require('node-cron');
const pinoHttp = require('pino-http');
const logger = require('./utils/logger');

const app = express();

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
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info({ 
    port: PORT, 
    env: process.env.NODE_ENV,
    appUrl: process.env.APP_URL 
  }, 'Server started');
});
