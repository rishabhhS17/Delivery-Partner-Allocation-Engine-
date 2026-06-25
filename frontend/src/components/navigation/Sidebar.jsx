import { Drawer, List, ListItem, ListItemButton, ListItemText, Toolbar, Box } from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import { NAVIGATION_ITEMS } from '../../config/navigation.js';
import styles from './Sidebar.module.css';

export default function Sidebar({ mobileOpen, handleDrawerToggle }) {
  const location = useLocation();

  const drawerContent = (
    <div>
      <Toolbar>
        <Box className={styles.wordmark}>Allocation Engine</Box>
      </Toolbar>
      <List disablePadding>
        {NAVIGATION_ITEMS.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <ListItem key={item.label} disablePadding>
              <ListItemButton
                component={NavLink}
                to={item.path}
                onClick={handleDrawerToggle ? () => handleDrawerToggle(false) : undefined}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              >
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ className: styles.navLabel }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </div>
  );

  return (
    <Box component="nav" className={styles.nav}>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => handleDrawerToggle(false)}
        ModalProps={{ keepMounted: true }}
        className={styles.mobileDrawer}
        classes={{ paper: styles.drawerPaper }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        className={styles.permanentDrawer}
        classes={{ paper: styles.drawerPaper }}
        open
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
}
