import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button } from '@mui/material';

const TABLE_COLUMNS = [
  'Order ID',
  'Restaurant',
  'Customer',
  'Status',
  'Assigned Rider',
  'Created At'
];

export default function Orders() {
  return (
    <Box>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ mb: 1, fontWeight: 300, letterSpacing: '-0.96px' }}>Orders</Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            Track pending, active, and completed delivery assignments.
          </Typography>
        </Box>
        <Button variant="contained" disabled sx={{ borderRadius: '9999px', px: 3 }}>
          Create Order
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: 'background.default' }}>
              {TABLE_COLUMNS.map((col) => (
                <TableCell key={col}>{col}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell colSpan={TABLE_COLUMNS.length} align="center" sx={{ py: 6, border: 0 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, mb: 1 }}>
                  No orders available.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Order data will appear after backend integration.
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
