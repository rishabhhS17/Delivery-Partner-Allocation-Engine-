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
        const avatarUrl = profile.photos?.[0]?.value ?? null;
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          const email = profile.emails?.[0]?.value;
          if (email) user = await User.findOne({ email });

          if (user) {
            user.googleId = profile.id;
          } else {
            // Google itself proves ownership of this email, so the account is verified
            // immediately — no separate OTP step needed, unlike email/password registration.
            // New signups default to 'partner'; elevate to 'admin' explicitly via the database,
            // never automatically at signup time.
            user = new User({
              email:        email ?? `${profile.id}@google.com`,
              googleId:     profile.id,
              role:         'partner',
              passwordHash: '',
              isVerified:   true,
            });
          }
        }

        // Keep the avatar fresh on every login, not just the first.
        user.avatarUrl = avatarUrl;
        await user.save();

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ));
}

export default passport;
