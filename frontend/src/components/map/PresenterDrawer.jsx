import { useMemo } from 'react';
import { Drawer, IconButton } from '@mui/material';
import { X } from 'lucide-react';
import { useSimulation } from '../../context/SimulationContext';
import styles from './PresenterDrawer.module.css';

const TOP_BAR_HEIGHT_PX = 64;

// The presenter panel (decision I2): one drawer on the Rider Map with what a presenter needs to
// narrate the live system. It does not block the map, so riders can be watched while it is open.
export default function PresenterDrawer({ isOpen, onClose, children }) {
  const { riders, queueDepth, dispatchPaused, connected } = useSimulation();

  const readouts = useMemo(() => {
    const count = (predicate) => riders.filter(predicate).length;
    return [
      { label: 'Riders live',       value: riders.length },
      { label: 'Idle',              value: count((r) => r.status === 'IDLE') },
      { label: 'On a delivery',     value: count((r) => r.carrying > 0) },
      { label: 'Carrying 2 orders', value: count((r) => r.carrying > 1) },
      { label: 'Offers open',       value: count((r) => r.hasOffer) },
      { label: 'Waiting orders',    value: queueDepth },
    ];
  }, [riders, queueDepth]);

  let engineState = 'Dispatching';
  if (!connected) engineState = 'Live feed disconnected';
  else if (dispatchPaused) engineState = 'Dispatch paused — database unavailable';

  return (
    // Sits below the 64 px top bar so logout and the live dot stay reachable.
    <Drawer
      anchor="right"
      variant="persistent"
      open={isOpen}
      classes={{ paper: styles.paper }}
      PaperProps={{ sx: { top: TOP_BAR_HEIGHT_PX, height: `calc(100% - ${TOP_BAR_HEIGHT_PX}px)` } }}
    >
      <div className={styles.header}>
        <span className={styles.title}>Presenter panel</span>
        <IconButton size="small" onClick={onClose} aria-label="close presenter panel">
          <X size={16} />
        </IconButton>
      </div>

      <div className={styles.engineState} data-ok={engineState === 'Dispatching'}>{engineState}</div>

      <div className={styles.readouts}>
        {readouts.map((r) => (
          <div key={r.label} className={styles.readout}>
            <span className={styles.readoutValue}>{r.value}</span>
            <span className={styles.readoutLabel}>{r.label}</span>
          </div>
        ))}
      </div>

      {children}
    </Drawer>
  );
}
