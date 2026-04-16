const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

module.exports = (passport) => {
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
          console.log('OAuth callback - Access token:', accessToken ? 'Present' : 'Missing');
          console.log('OAuth callback - Refresh token:', refreshToken ? 'Present' : 'Missing');

          let user = await User.findOne({ googleId: profile.id });

          if (user) {
            // Update tokens
            user.googleAccessToken = accessToken;
            if (refreshToken) {
              user.googleRefreshToken = refreshToken;
              console.log('Updated refresh token for existing user');
            } else {
              console.log('No refresh token provided, keeping existing one');
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

          console.log('Created new user with refresh token:', refreshToken ? 'Yes' : 'No');
          done(null, user);
        } catch (error) {
          console.error('OAuth error:', error);
          done(error, null);
        }
      }
    )
  );

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
