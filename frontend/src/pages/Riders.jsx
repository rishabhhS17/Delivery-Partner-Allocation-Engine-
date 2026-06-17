import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, ButtonGroup } from '@mui/material';

export default function Riders() {
  return (
    <Box>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h4" sx={{ mb: 1, fontWeight: 300, letterSpacing: '-0.96px' }}>Riders</Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            Manage delivery partners, view statuses, and track active assignments.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, mt: 1 }}>
          <ButtonGroup variant="outlined" size="small" disabled>
            <Button>Available</Button>
            <Button>Busy</Button>
            <Button>Offline</Button>
          </ButtonGroup>
          <Typography variant="caption" color="text.disabled">
            Filters unavailable in POC
          </Typography>
        </Box>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: 'background.default' }}>
              <TableCell>Rider ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Rating</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Active Orders</TableCell>
              <TableCell>Latitude</TableCell>
              <TableCell>Longitude</TableCell>
              <TableCell>Last Updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell colSpan={9} align="center" sx={{ py: 6, border: 0 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, mb: 1 }}>
                  No riders available.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Rider data will appear after backend integration.
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
