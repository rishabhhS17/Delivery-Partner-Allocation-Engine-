import { Box, Typography, Paper, Grid, Card, CardContent } from '@mui/material';

export default function Dashboard() {
  const kpiPlaceholders = [
    { label: 'Active Orders' },
    { label: 'Available Riders' },
    { label: 'Avg Allocation Time' },
    { label: 'Delayed Orders' }
  ];

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 300, letterSpacing: '-0.96px' }}>Dashboard</Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          Real-time overview of active deliveries, rider utilization, and system warnings.
        </Typography>
      </Box>

      {/* KPI Metrics Grid */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {kpiPlaceholders.map((kpi, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card elevation={0} sx={{ 
              backgroundColor: 'background.paper',
              borderRadius: 3,
              boxShadow: 'rgba(45, 42, 38, 0.08) 0 1px 3px'
            }}>
              <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {kpi.label}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 300, fontFeatureSettings: '"tnum"' }}>
                  —
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Map and Activity Feed Split Layout */}
      <Grid container spacing={3}>
        {/* Map Panel Placeholder */}
        <Grid item xs={12} md={7}>
          <Paper elevation={0} sx={{ 
            height: '100%', 
            minHeight: 320, 
            backgroundColor: 'background.paper',
            borderRadius: 3,
            boxShadow: 'rgba(45, 42, 38, 0.08) 0 1px 3px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
          }}>
            <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 300 }}>
              Live Map Placeholder
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1, textAlign: 'center', px: 2 }}>
              Mapbox injection point
            </Typography>
          </Paper>
        </Grid>

        {/* Activity Summary Placeholder */}
        <Grid item xs={12} md={5}>
          <Paper elevation={0} sx={{ 
            height: '100%', 
            minHeight: 320, 
            backgroundColor: 'background.paper',
            borderRadius: 3,
            boxShadow: 'rgba(45, 42, 38, 0.08) 0 1px 3px',
            p: 3
          }}>
            <Typography variant="h6" sx={{ fontWeight: 300, mb: 3 }}>
              Recent Allocations
            </Typography>
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              height: 'calc(100% - 48px)',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center'
            }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, mb: 1 }}>
                No recent allocations available.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Allocation events will appear after backend integration.
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
