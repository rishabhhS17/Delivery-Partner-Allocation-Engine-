import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Typography } from '@mui/material';
import Map, { Source, Layer } from 'react-map-gl';
import PageHeader from '../components/common/PageHeader';
import StatCard from '../components/common/StatCard';
import MapPanel from '../components/common/MapPanel';
import EmptyState from '../components/common/EmptyState';
import { getAnalytics } from '../api/endpoints';
import { useSimulation } from '../context/SimulationContext';
import styles from './Dashboard.module.css';

const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const RANCHI_CENTER = { longitude: 85.33, latitude: 23.35, zoom: 12 };
const MAP_STYLE     = 'mapbox://styles/mapbox/dark-v11';

const circleLayer = {
  id:   'riders-mini',
  type: 'circle',
  paint: {
    'circle-radius': 5,
    'circle-color': [
      'match', ['get', 'status'],
      'IDLE',      '#0070f3',
      'ACCEPTED',  '#f5a623',
      'PICKED_UP', '#7928ca',
      '#a1a1a1',
    ],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1,
    'circle-opacity': [
      'match', ['get', 'availabilityStatus'],
      'OFFLINE', 0.3,
      1,
    ],
  },
};

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const { riders, connected, queueDepth, allocations } = useSimulation();

  useEffect(() => {
    getAnalytics()
      .then((res) => setAnalytics(res.data))
      .catch(() => setAnalytics(null));
  }, []);

  const geojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: riders.map((r) => ({
      type:       'Feature',
      geometry:   { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { status: r.status, availabilityStatus: r.availabilityStatus },
    })),
  }), [riders]);

  const stats = [
    { label: 'Total riders',     value: analytics?.totalRiders },
    { label: 'Available riders', value: analytics?.availableRiders },
    { label: 'Active orders',    value: analytics?.activeOrders },
    { label: 'Completed orders', value: analytics?.completedOrders },
  ];

  return (
    <Box>
      <PageHeader
        eyebrow="Ops — Overview"
        title="Dashboard"
        description="Real-time overview of fleet utilization and order throughput."
      />

      <Box className={styles.statGrid}>
        {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
      </Box>

      <Box className={styles.lowerGrid}>
        <MapPanel
          eyebrow={connected ? `Fleet — Live · Queue: ${queueDepth}` : 'Fleet — Waiting for simulation…'}
          legend={[
            { label: 'Idle',      color: 'link' },
            { label: 'Accepted',  color: 'warning' },
            { label: 'Picked up', color: 'violet' },
            { label: 'Offline',   color: 'faint' },
          ]}
          variant="compact"
        >
          <div className={styles.miniMapWrap}>
            <Map
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={RANCHI_CENTER}
              mapStyle={MAP_STYLE}
            >
              <Source id="riders-mini" type="geojson" data={geojson}>
                <Layer {...circleLayer} />
              </Source>
            </Map>
          </div>
        </MapPanel>

        <Card elevation={0} className={styles.activityCard}>
          <div className={styles.activityTitle}>Recent allocations</div>

          {allocations.length === 0 ? (
            <EmptyState
              title="No recent allocations"
              description="Allocation events will appear here once the simulation is running."
            />
          ) : (
            <div className={styles.allocationFeed}>
              {allocations.slice(0, 8).map((a) => (
                <div key={a.orderId + a.ts} className={styles.allocationItem}>
                  <div>
                    <div className={styles.allocationRider}>
                      Rider {String(a.riderId).slice(-6)}
                    </div>
                    <div className={styles.allocationMeta}>
                      Order {String(a.orderId).slice(-6)}
                    </div>
                  </div>
                  <div className={styles.allocationRight}>
                    <div className={styles.allocationScore}>
                      {(a.score * 100).toFixed(0)}%
                    </div>
                    <div className={styles.allocationMeta}>{timeAgo(a.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Box>
    </Box>
  );
}
