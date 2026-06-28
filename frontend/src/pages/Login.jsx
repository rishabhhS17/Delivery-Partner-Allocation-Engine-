import { useState } from 'react';
import { Box, Card, Typography, TextField, Button } from '@mui/material';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/common/Spinner';
import Logo from '../components/common/Logo';
import styles from './Login.module.css';

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.status === 401 ? 'Invalid credentials' : 'Unable to log in right now');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className={styles.hero}>
      <Card elevation={0} className={styles.card}>
        <Box>
          <Logo variant="full" size="lg" className={styles.title} />
          <Typography className={styles.tagline}>AI-Powered Delivery Intelligence</Typography>
        </Box>

        <form className={styles.form} onSubmit={handleSubmit}>
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
            required
            fullWidth
            size="small"
          />
          {error && <Typography className={styles.error}>{error}</Typography>}
          <Button
            type="submit"
            variant="contained"
            disabled={submitting}
            className={styles.submit}
          >
            {submitting ? <Spinner size="sm" /> : 'Log in'}
          </Button>
        </form>
      </Card>
    </Box>
  );
}
