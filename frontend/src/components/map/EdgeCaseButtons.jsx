import { useEffect, useState } from 'react';
import { Button, Tooltip } from '@mui/material';
import { useToast } from '../../context/ToastContext';
import {
  getPresenterState, forceRiderAction, forceKitchenAction, startDatabaseOutage, crashEngine,
} from '../../api/endpoints';
import styles from './PresenterDrawer.module.css';

const POLL_MS = 3000;

const RIDER_BUTTONS = [
  { action: 'reject', label: 'Next offer: rejected' },
  { action: 'ignore', label: 'Next offer: ignored' },
  { action: 'cancel', label: 'Rider cancels a pickup' },
];
const KITCHEN_BUTTONS = [
  { action: 'reject', label: 'Restaurant rejects' },
  { action: 'delay',  label: 'Food delayed' },
  { action: 'early',  label: 'Food early' },
];

// Edge-case buttons for the presenter panel (decision I3). Each one makes the next matching
// event happen at once; the map and toasts then show the engine coping.
export default function EdgeCaseButtons() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [isCrashing, setIsCrashing] = useState(false);

  const handleCrash = async () => {
    setIsCrashing(true);
    try {
      const { data } = await crashEngine();
      toast.success(`Engine recovered in ${data.recoveredInMs} ms — ${data.riders} riders, ${data.pendingOrders} waiting orders`);
    } catch (err) {
      toast.error(err.response?.data?.message ?? 'Crash/recover failed');
    } finally {
      setIsCrashing(false);
    }
  };

  useEffect(() => {
    const load = () => getPresenterState().then((res) => setState(res.data)).catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const run = (request, message) => async () => {
    try {
      await request();
      toast.success(message);
      getPresenterState().then((res) => setState(res.data)).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.message ?? 'Request failed');
    }
  };

  const pending = [...(state?.pendingRiderActions ?? []).map((a) => `rider ${a}`), ...(state?.pendingKitchenActions ?? []).map((a) => `kitchen ${a}`)];
  const outageSecondsLeft = state?.databaseOutageEndsAt ? Math.max(0, Math.round((state.databaseOutageEndsAt - Date.now()) / 1000)) : 0;

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Rider</span>
        {RIDER_BUTTONS.map(({ action, label }) => (
          <Button key={action} size="small" variant="outlined" onClick={run(() => forceRiderAction(action), `Queued: ${label}`)}>
            {label}
          </Button>
        ))}
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Restaurant</span>
        {KITCHEN_BUTTONS.map(({ action, label }) => (
          <Button key={action} size="small" variant="outlined" onClick={run(() => forceKitchenAction(action), `Queued: ${label}`)}>
            {label}
          </Button>
        ))}
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Database</span>
        <Tooltip title={state?.isOutageHookEnabled ? '' : 'Off on this server (SIMULATION_ENABLED is not true)'}>
          <span>
            <Button
              fullWidth size="small" variant="outlined" color="warning"
              disabled={!state?.isOutageHookEnabled || outageSecondsLeft > 0}
              onClick={run(startDatabaseOutage, 'Database outage started (60 s)')}
            >
              {outageSecondsLeft > 0 ? `Outage — ${outageSecondsLeft}s left` : '60 s database outage'}
            </Button>
          </span>
        </Tooltip>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Engine</span>
        <Button size="small" variant="outlined" color="error" disabled={isCrashing} onClick={handleCrash}>
          {isCrashing ? 'Recovering…' : 'Crash engine'}
        </Button>
        <span className={styles.hint}>Wipes the engine's memory and rebuilds it from the database, as after a real crash.</span>
      </div>

      {pending.length > 0 && <span className={styles.hint}>Waiting to happen: {pending.join(', ')}</span>}
    </>
  );
}
