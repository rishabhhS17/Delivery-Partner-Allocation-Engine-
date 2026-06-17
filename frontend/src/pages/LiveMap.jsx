import { Box, Typography, Paper, Grid, Alert } from '@mui/material';

export default function LiveMap() {
  const legendItems = [
    { label: 'Available Rider', color: 'success.main' },
    { label: 'Busy Rider', color: 'warning.main' },
    { label: 'Offline Rider', color: 'text.disabled' },
    { label: 'Restaurant', color: 'warning.main' },
    { label: 'Customer', color: 'error.main' }
  ];

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 300, letterSpacing: '-0.96px' }}>Live Map</Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
          Real-time visualization of fleet operations and delivery routes.
        </Typography>
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          Locations are simulated for the POC. Real-time GPS tracking is not included and no rider mobile application is required.
        </Alert>
      </Box>

      {/* Map Canvas Placeholder */}
      <Paper 
        elevation={0} 
        sx={{ 
          minHeight: '380px', 
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          display: 'flex',
          flexDirection: 'column',
          mb: 2
        }}
      >
        <Box sx={{ 
          p: 2, 
          borderBottom: '1px solid', 
          borderColor: 'divider', 
          backgroundColor: 'background.default', 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: 3, 
          alignItems: 'center' 
        }}>
          {legendItems.map((item, index) => (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: item.color }} />
              <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 500 }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ 
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4
        }}>
          <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 300 }}>
            Live Allocation Map Placeholder
          </Typography>
        </Box>
      </Paper>

      {/* Route Explanation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
        <Typography variant="body2" color="text.secondary">Route:</Typography>
        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>Rider</Box> 
          → 
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>Restaurant</Box> 
          → 
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>Customer</Box>
        </Typography>
      </Box>
    </Box>
  );
}
