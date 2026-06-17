import { AppBar, Toolbar, IconButton, Typography, Box, Avatar, TextField, InputAdornment } from '@mui/material';

const drawerWidth = 240;

export default function Topbar({ handleDrawerToggle }) {
  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        width: { sm: `calc(100% - ${drawerWidth}px)` },
        ml: { sm: `${drawerWidth}px` },
        backgroundColor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        height: 64,
        color: 'text.primary'
      }}
    >
      <Toolbar sx={{ height: 64 }}>
        <IconButton
          color="inherit"
          aria-label="open drawer"
          edge="start"
          onClick={() => handleDrawerToggle(true)}
          sx={{ mr: 2, display: { sm: 'none' } }}
        >
          ☰
        </IconButton>
        
        <Box sx={{ flexGrow: 1 }}>
          <TextField
            disabled
            size="small"
            placeholder="Search platform..."
            aria-label="Global platform search"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Typography sx={{ fontSize: 16 }}>🔍</Typography>
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="body2" sx={{ cursor: 'pointer' }}>
            [🔔]
          </Typography>
          <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32, fontSize: 14 }}>AD</Avatar>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
