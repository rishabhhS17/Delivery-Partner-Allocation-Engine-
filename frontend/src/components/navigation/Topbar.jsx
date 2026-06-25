import { AppBar, Toolbar, IconButton, Box, Avatar, TextField, InputAdornment, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import styles from './Topbar.module.css';

export default function Topbar({ handleDrawerToggle }) {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <AppBar position="fixed" elevation={0} className={styles.appBar}>
      <Toolbar className={styles.toolbar}>
        <IconButton
          color="inherit"
          aria-label="open drawer"
          edge="start"
          onClick={() => handleDrawerToggle(true)}
          className={styles.menuButton}
        >
          ☰
        </IconButton>

        <TextField
          disabled
          size="small"
          placeholder="Search platform..."
          aria-label="Global platform search"
          className={styles.searchInput}
          InputProps={{
            startAdornment: <InputAdornment position="start">🔍</InputAdornment>,
          }}
        />

        <Box className={styles.spacer} />

        <Box className={styles.actions}>
          <IconButton
            color="inherit"
            aria-label="toggle dark mode"
            onClick={toggleTheme}
            size="small"
          >
            {isDark ? '☀️' : '🌙'}
          </IconButton>
          <Button variant="outlined" size="small" onClick={handleLogout}>
            Log out
          </Button>
          <Avatar className={styles.avatar}>
            {user?.email ? user.email.slice(0, 2).toUpperCase() : 'AD'}
          </Avatar>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
