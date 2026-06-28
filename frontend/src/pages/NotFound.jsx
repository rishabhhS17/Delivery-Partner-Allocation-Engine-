import { Box, Button, Typography } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/common/Logo';
import styles from './NotFound.module.css';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box className={styles.wrap}>
      <Logo variant="mark" size="lg" />
      <Typography variant="h2" className={styles.code}>404</Typography>
      <Typography className={styles.title}>Page not found</Typography>
      <Typography className={styles.description}>
        The page you’re looking for doesn’t exist or may have moved.
      </Typography>
      <Button variant="contained" startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/dashboard')}>
        Back to dashboard
      </Button>
    </Box>
  );
}
