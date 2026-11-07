import { useEffect, useState } from 'react';
import { Card } from '@mui/material';
import { getHealth } from '../../api/endpoints';
import styles from './EngineHealthCard.module.css';

const POLL_MS = 5000;

const show = (value, unit = '') => (value === null || value === undefined ? '—' : `${value}${unit}`);

// Is the single Node thread keeping up? Polls GET /api/health (decision E6).
export default function EngineHealthCard() {
  const [health, setHealth] = useState(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const load = () => getHealth()
      .then((res) => { setHealth(res.data); setHasFailed(false); })
      .catch(() => setHasFailed(true));
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const engine = health?.engine;
  const metrics = [
    { label: 'Event-loop delay p99', value: show(engine?.eventLoopDelayMs?.p99, ' ms') },
    { label: 'Dispatch round',       value: show(engine?.lastDispatchRoundMs, ' ms') },
    { label: 'Rider bot tick',       value: show(health?.lastRiderBotTickMs, ' ms') },
    { label: 'Pending orders',       value: show(engine?.queues?.pendingOrders) },
    { label: 'In delivery',          value: show(engine?.queues?.ordersInDelivery) },
    { label: 'Time to assign (avg)', value: show(engine?.timeToAssign?.average_s, ' s') },
    { label: 'Database ping',        value: engine?.database?.isConnected === false ? 'down' : show(engine?.database?.pingMs, ' ms') },
  ];

  let state = 'Healthy';
  if (hasFailed) state = 'Unreachable';
  else if (!health) state = 'Loading…';
  else if (!engine?.isLeader) state = 'Standby instance';
  else if (engine?.isDispatchPaused) state = 'Dispatch paused — database down';

  return (
    <Card elevation={0} className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>Engine health</span>
        <span className={styles.state} data-ok={state === 'Healthy'}>{state}</span>
      </div>
      <div className={styles.grid}>
        {metrics.map((m) => (
          <div key={m.label} className={styles.metric}>
            <span className={styles.value}>{m.value}</span>
            <span className={styles.label}>{m.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
