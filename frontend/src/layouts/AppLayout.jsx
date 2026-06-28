import { useState } from 'react';
import { Box } from '@mui/material';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/navigation/Sidebar';
import Topbar from '../components/navigation/Topbar';
import styles from './AppLayout.module.css';

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <Box className={styles.root}>
      <Topbar handleDrawerToggle={setMobileOpen} />
      <Sidebar mobileOpen={mobileOpen} handleDrawerToggle={setMobileOpen} />

      <Box component="main" className={styles.main}>
        <div className={styles.spacer} />
        <Box className={styles.content} key={location.pathname}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
