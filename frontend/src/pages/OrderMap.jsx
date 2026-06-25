import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import PageHeader from '../components/common/PageHeader';
import MapPanel from '../components/common/MapPanel';
import StatusBadge from '../components/common/StatusBadge';
import { getOrder } from '../api/endpoints';

export default function OrderMap() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);

  useEffect(() => {
    getOrder(id)
      .then((res) => setOrder(res.data))
      .catch(() => setOrder(null));
  }, [id]);

  return (
    <Box>
      <PageHeader
        eyebrow={`Ops — Order ${id}`}
        title="Order Map"
        description="Restaurant, customer, and assigned rider for this delivery."
        action={order && <StatusBadge kind="order" status={order.status} />}
      />

      <MapPanel
        eyebrow="Route — Rider → Restaurant → Customer"
        legend={[
          { label: 'Restaurant', color: 'warning' },
          { label: 'Customer', color: 'violet' },
          { label: 'Rider', color: 'link' },
        ]}
        variant="full"
      >
        Route and live rider position render once the backend simulation is connected.
      </MapPanel>
    </Box>
  );
}
