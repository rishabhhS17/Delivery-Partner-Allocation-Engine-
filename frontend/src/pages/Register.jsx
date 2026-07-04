import { useState } from 'react';
import { Box, Card, Typography, TextField, Button } from '@mui/material';
import { Navigate, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/common/Spinner';
import Logo from '../components/common/Logo';
import { register, verifyRegisterOtp } from '../api/endpoints';
import styles from './Login.module.css';

export default function Register() {
  const { user, loading, loginWithToken } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState('details'); // details | otp
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleDetailsSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await register({ email, password });
      setStep('otp');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create account right now');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await verifyRegisterOtp({ email, otp });
      await loginWithToken(res.data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className={styles.hero}>
      <Card elevation={0} className={styles.card}>
        <Box>
          <Logo variant="full" size="lg" className={styles.title} />
          <Typography className={styles.tagline}>
            {step === 'details' ? 'Create your account' : 'Enter the verification code we emailed you'}
          </Typography>
        </Box>

        {step === 'details' && (
          <form className={styles.form} onSubmit={handleDetailsSubmit}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              size="small"
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="At least 8 characters"
              required
              fullWidth
              size="small"
            />
            {error && <Typography className={styles.error}>{error}</Typography>}
            <Button type="submit" variant="contained" disabled={submitting} className={styles.submit}>
              {submitting ? <Spinner size="sm" /> : 'Continue'}
            </Button>
          </form>
        )}

        {step === 'otp' && (
          <form className={styles.form} onSubmit={handleOtpSubmit}>
            <TextField
              label="Verification code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              fullWidth
              size="small"
              autoFocus
            />
            {error && <Typography className={styles.error}>{error}</Typography>}
            <Button type="submit" variant="contained" disabled={submitting} className={styles.submit}>
              {submitting ? <Spinner size="sm" /> : 'Verify & create account'}
            </Button>
          </form>
        )}

        <Box className={styles.links}>
          <RouterLink to="/login" className={styles.link}>Already have an account? Log in</RouterLink>
        </Box>
      </Card>
    </Box>
  );
}
