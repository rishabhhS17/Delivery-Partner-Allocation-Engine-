import { useSimulation } from '../../context/SimulationContext';
import styles from './ConnectionBanner.module.css';

export default function ConnectionBanner() {
  const { connected } = useSimulation();
  if (connected) return null;
  return (
    <div className={styles.banner} role="alert">
      Live feed disconnected — rider positions may be stale. Reconnecting…
    </div>
  );
}
