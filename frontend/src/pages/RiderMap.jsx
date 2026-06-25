import { Box } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import MapPanel from '../components/common/MapPanel';

export default function RiderMap() {
  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Fleet"
        title="Rider Map"
        description="Live positions of every rider, color-coded by movement state."
      />

      <MapPanel
        eyebrow="Fleet — Live"
        legend={[
          { label: 'Idle', color: 'link' },
          { label: 'Accepted', color: 'warning' },
          { label: 'Picked up', color: 'violet' },
          { label: 'Offline', color: 'faint' },
        ]}
        variant="full"
      >
        Live rider positions stream in once the backend simulation (B8+B9) is connected.
      </MapPanel>
    </Box>
  );
}
