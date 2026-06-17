import { Box, Typography, Grid, Card, CardContent, Alert } from '@mui/material';

const ALLOCATION_WEIGHTS = [
  { label: 'Distance Weight', value: '40%' },
  { label: 'Rating Weight', value: '30%' },
  { label: 'Current Load Weight', value: '20%' },
  { label: 'Availability Weight', value: '10%' }
];

export default function Settings() {
  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 300, letterSpacing: '-0.96px' }}>Settings</Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
          System configuration and allocation parameters.
        </Typography>
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          Allocation weights are fixed for the POC. Dynamic configuration of these settings is currently out of scope.
        </Alert>
      </Box>

      <Typography variant="h6" sx={{ fontWeight: 300, mb: 2 }}>Allocation Weights</Typography>
      <Grid container spacing={3}>
        {ALLOCATION_WEIGHTS.map((weight, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card elevation={0} sx={{ 
              backgroundColor: 'background.paper',
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: 'none'
            }}>
              <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {weight.label}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 300 }}>
                  {weight.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
