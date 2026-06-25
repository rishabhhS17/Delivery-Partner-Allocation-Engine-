import { useState } from 'react';
import { Box, Card, Typography, TextField, Button } from '@mui/material';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
          <Typography className={styles.eyebrow}>Ops — Sign in</Typography>
          <Typography variant="h2" className={styles.title}>Allocation Engine</Typography>
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
            {submitting ? 'Signing in…' : 'Log in'}
          </Button>
        </form>
      </Card>
    </Box>
  );
}
