import { Drawer, List, ListItem, ListItemButton, ListItemText, Toolbar, Box } from '@mui/material';
import { NavLink, useLocation } from 'react-router-dom';
import { NAVIGATION_ITEMS } from '../../config/navigation.js';
import Logo from '../common/Logo';
import styles from './Sidebar.module.css';

export default function Sidebar({ mobileOpen, handleDrawerToggle }) {
  const location = useLocation();

  const drawerContent = (
    <div>
      <Toolbar>
        <Logo variant="full" size="sm" className={styles.wordmark} />
      </Toolbar>
      <List disablePadding className={styles.list}>
        {NAVIGATION_ITEMS.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          const Icon = item.icon;
          return (
            <ListItem key={item.label} disablePadding className={styles.listItem}>
              <ListItemButton
                component={NavLink}
                to={item.path}
                disableRipple
                onClick={handleDrawerToggle ? () => handleDrawerToggle(false) : undefined}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              >
                {Icon && <Icon size={18} className={styles.navIcon} />}
                <ListItemText
                  primary={item.label}
                  className={styles.navText}
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
