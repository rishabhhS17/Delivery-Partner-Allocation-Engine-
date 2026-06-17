import { useState } from 'react';
import { Box, Toolbar } from '@mui/material';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/navigation/Sidebar';
import Topbar from '../components/navigation/Topbar';

const drawerWidth = 240;

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      <Topbar handleDrawerToggle={setMobileOpen} />
      <Sidebar mobileOpen={mobileOpen} handleDrawerToggle={setMobileOpen} />
      
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3, // Standardized 24px section padding for the canvas
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <Toolbar sx={{ height: 64, minHeight: '64px !important', p: 0, m: 0 }} />
        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
