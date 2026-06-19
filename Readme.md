# Mail Merge Server - Local Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v16 or higher)
- **npm** (comes with Node.js)
- **MongoDB** (local installation or MongoDB Atlas account)
- **Git**

## Setup Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd server
```

### 2. Install Dependencies

```bash
npm install
```
This will install all required packages including:
- Express.js
- Mongoose
- Nodemailer
- Passport (Google OAuth)
- And more...

### 3. Create Environment File

Create a `.env` file in the `server` folder:

```bash
cp .env.example .env
```

Or create it manually with the following content:

```env
# Server Configuration
PORT=5000
NODE_ENV=development
LOG_LEVEL=info

# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/mail-merge
# Or use MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/mail-merge

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d

# Encryption Key (32 characters for AES-256)
ENCRYPTION_KEY=your-32-character-encryption-key-here-change-this

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

# Application URLs
CLIENT_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:5000
APP_URL=http://localhost:5000

# Email Configuration (Optional - for SMTP testing)
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=your-email@gmail.com
```

### 4. Configure Environment Variables

#### Required Variables:

**MongoDB:**
- `MONGODB_URI`: Your MongoDB connection string
  - Local: `mongodb://localhost:27017/mail-merge`
  - Atlas: Get from MongoDB Atlas dashboard

**JWT:**
- `JWT_SECRET`: Generate a random secret key
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

**Encryption:**
- `ENCRYPTION_KEY`: Generate a 32-character key
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

**Google OAuth:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Gmail API and Google Sheets API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`

### 5. Start the Development Server

```bash
npm run dev
```

The server will start on `http://localhost:5000`

You should see:
```
🚀 Server running on port 5000
✅ MongoDB connected
```

### 6. Verify Setup

Test the server is running:

```bash
curl http://localhost:5000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Available Scripts

```bash
# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Run tests (if available)
npm test
```

## Project Structure

```
server/
├── config/           # Configuration files (passport, etc.)
├── controllers/      # Route controllers
├── middleware/       # Custom middleware (auth, etc.)
├── models/          # Mongoose models
├── routes/          # API routes
├── services/        # Business logic (email, sheets, etc.)
├── scripts/         # Utility scripts
├── utils/           # Helper functions
├── .env             # Environment variables (create this)
├── .env.example     # Environment template
├── index.js         # Server entry point
└── package.json     # Dependencies
```

## Common Issues & Solutions

### Issue: MongoDB Connection Failed

**Solution:**
- Ensure MongoDB is running locally: `mongod`
- Or use MongoDB Atlas and update `MONGODB_URI`
- Check firewall settings

### Issue: Port 5000 Already in Use

**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or change PORT in .env
PORT=5001
```

### Issue: Google OAuth Not Working

**Solution:**
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- Check authorized redirect URIs in Google Console
- Ensure `GOOGLE_CALLBACK_URL` matches exactly
- Enable Gmail API and Google Sheets API

### Issue: Module Not Found

**Solution:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

## API Endpoints

Once running, the following endpoints are available:

### Authentication
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `GET /api/auth/me` - Get current user

### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns/:id` - Get campaign details
- `POST /api/campaigns/:id/send` - Send campaign

### Email Configs
- `GET /api/email-configs` - List email configurations
- `POST /api/email-configs` - Create email config
- `POST /api/email-configs/:id/test` - Send test email

### Sheets
- `GET /api/sheets` - List Google Sheets
- `GET /api/sheets/:id/data` - Get sheet data

### Templates
- `GET /api/templates` - List templates
- `POST /api/templates` - Create template

### Tracking
- `GET /track/:trackingId` - Track email opens

## Development Tips

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

### Test Email Sending

Use the test scripts:

```bash
# Test email configuration
node scripts/test-email-config.js

# Test Gmail OAuth
node scripts/test-gmail-send.js

# Test tracking
node scripts/test-tracking.js
```

### Database Management

```bash
# Connect to MongoDB
mongo

# Use database
use mail-merge

# View collections
show collections

# Query campaigns
db.campaigns.find().pretty()
```

## Next Steps

1. ✅ Server is running
2. 🔄 Set up the [frontend client](../nextjs-client/SETUP.md)
3. 🔐 Configure Google OAuth
4. 📧 Add email configurations
5. 🚀 Create your first campaign

## Support

For issues or questions:
- Check the [main README](../README.md)
- Review server logs in the console
- Check MongoDB connection
- Verify environment variables

## Production Deployment

For production deployment to Render, Heroku, or other platforms:
1. Use `.env.render` or platform-specific env vars
2. Set `NODE_ENV=production`
3. Use MongoDB Atlas for database
4. Update `APP_URL` to your production domain
5. Configure Google OAuth with production callback URL

---

**Ready to start?** Run `npm run dev` and the server will be live! 🚀
