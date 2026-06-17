import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Alert } from '@mui/material';

const TABLE_COLUMNS = [
  'Order ID',
  'Rider Name',
  'Allocation Score',
  'Allocation Reason',
  'Timestamp'
];

export default function AllocationHistory() {
  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 300, letterSpacing: '-0.96px' }}>Allocation History</Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
          Audit log of all rider assignments and scoring decisions.
        </Typography>
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          Rider allocation is performed by the deterministic weighted scoring engine. AI is used exclusively to generate human-readable explanations after an allocation decision is finalized.
        </Alert>
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
                  No allocations available.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Allocation data will appear after backend integration.
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
