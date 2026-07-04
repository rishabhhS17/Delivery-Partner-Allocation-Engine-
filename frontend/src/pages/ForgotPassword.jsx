import { useState } from 'react';
import { Box, Card, Typography, TextField, Button } from '@mui/material';
import { Navigate, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/common/Spinner';
import Logo from '../components/common/Logo';
import { forgotPassword, verifyResetOtp, resetPassword } from '../api/endpoints';
import styles from './Login.module.css';

const STEP_COPY = {
  email:       'Enter the email on your account',
  otp:         'Enter the verification code we emailed you',
  newPassword: 'Choose a new password',
  done:        'Your password has been updated',
};

export default function ForgotPassword() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState('email'); // email | otp | newPassword | done
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await forgotPassword({ email });
      setStep('otp');
    } catch {
      setError('Could not send a code right now');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await verifyResetOtp({ email, otp });
      setResetToken(res.data.resetToken);
      setStep('newPassword');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired code');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await resetPassword({ resetToken, newPassword });
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update your password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className={styles.hero}>
      <Card elevation={0} className={styles.card}>
        <Box>
          <Logo variant="full" size="lg" className={styles.title} />
          <Typography className={styles.tagline}>{STEP_COPY[step]}</Typography>
        </Box>

        {step === 'email' && (
          <form className={styles.form} onSubmit={handleEmailSubmit}>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth size="small" />
            {error && <Typography className={styles.error}>{error}</Typography>}
            <Button type="submit" variant="contained" disabled={submitting} className={styles.submit}>
              {submitting ? <Spinner size="sm" /> : 'Send code'}
            </Button>
          </form>
        )}

        {step === 'otp' && (
          <form className={styles.form} onSubmit={handleOtpSubmit}>
            <TextField label="Verification code" value={otp} onChange={(e) => setOtp(e.target.value)} required fullWidth size="small" autoFocus />
            {error && <Typography className={styles.error}>{error}</Typography>}
            <Button type="submit" variant="contained" disabled={submitting} className={styles.submit}>
              {submitting ? <Spinner size="sm" /> : 'Verify code'}
            </Button>
          </form>
        )}

        {step === 'newPassword' && (
          <form className={styles.form} onSubmit={handlePasswordSubmit}>
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              helperText="At least 8 characters"
              required
              fullWidth
              size="small"
              autoFocus
            />
            {error && <Typography className={styles.error}>{error}</Typography>}
            <Button type="submit" variant="contained" disabled={submitting} className={styles.submit}>
              {submitting ? <Spinner size="sm" /> : 'Update password'}
            </Button>
          </form>
        )}

        {step === 'done' && (
          <Button variant="contained" className={styles.submit} onClick={() => navigate('/login')}>
            Go to login
          </Button>
        )}

        <Box className={styles.links}>
          <RouterLink to="/login" className={styles.link}>Back to login</RouterLink>
        </Box>
      </Card>
    </Box>
  );
}
