const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const logger = require('../utils/logger');

module.exports = (passport) => {
  const hasGoogleOAuthConfig = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
  );

  if (hasGoogleOAuthConfig) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_CALLBACK_URL,
          accessType: 'offline',
          prompt: 'consent'
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            logger.info({
              hasAccessToken: Boolean(accessToken),
              hasRefreshToken: Boolean(refreshToken),
              googleId: profile?.id
            }, 'OAuth callback received');

            let user = await User.findOne({ googleId: profile.id });

            if (user) {
              // Update tokens
              user.googleAccessToken = accessToken;
              if (refreshToken) {
                user.googleRefreshToken = refreshToken;
              } else {
                logger.info({ googleId: profile?.id }, 'No refresh token provided, keeping existing one');
              }
              await user.save();
              return done(null, user);
            }

            // Create new user
            user = await User.create({
              googleId: profile.id,
              email: profile.emails[0].value,
              name: profile.displayName,
              avatar: profile.photos[0]?.value,
              googleAccessToken: accessToken,
              googleRefreshToken: refreshToken
            });

            logger.info({
              googleId: profile?.id,
              hasRefreshToken: Boolean(refreshToken)
            }, 'Created new OAuth user');
            done(null, user);
          } catch (error) {
            logger.error({ err: error, googleId: profile?.id }, 'OAuth error');
            done(error, null);
          }
        }
      )
    );
  } else {
    logger.warn('Google OAuth is disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL not fully configured.');
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
};
