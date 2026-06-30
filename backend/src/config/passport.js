import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import { config } from './env.js';

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

if (config.googleClientId && config.googleClientSecret) {
  passport.use(new GoogleStrategy(
    {
      clientID:     config.googleClientId,
      clientSecret: config.googleClientSecret,
      callbackURL:  config.googleCallbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          const email = profile.emails?.[0]?.value;
          if (email) user = await User.findOne({ email });

          if (user) {
            user.googleId = profile.id;
            await user.save();
          } else {
            user = await User.create({
              email:        email ?? `${profile.id}@google.com`,
              googleId:     profile.id,
              role:         'admin',
              passwordHash: '',
            });
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ));
}

export default passport;
