import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Alert } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import styles from './AllocationHistory.module.css';

const TABLE_COLUMNS = [
  'Order ID',
  'Rider Name',
  'Allocation Score',
  'Allocation Reason',
  'Timestamp',
];

export default function AllocationHistory() {
  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Allocations"
        title="Allocation History"
        description="Audit log of all rider assignments and scoring decisions."
      />

      <Alert severity="info" className={styles.alert}>
        Rider allocation is performed by the deterministic weighted scoring engine. AI is used exclusively to generate human-readable explanations after an allocation decision is finalized.
      </Alert>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              {TABLE_COLUMNS.map((col) => (
                <TableCell key={col}>{col}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell colSpan={TABLE_COLUMNS.length} className={styles.emptyCell}>
                <Typography variant="body2" className={styles.emptyCellPrimary}>
                  No allocations available.
                </Typography>
                <Typography variant="body2" className={styles.emptyCellSecondary}>
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
