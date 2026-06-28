import { useEffect, useState } from 'react';
import Logo from './Logo';
import styles from './SplashScreen.module.css';

const PHASES = [
  'Initializing AI Engine…',
  'Loading Delivery Network…',
  'Synchronizing Riders…',
  'Preparing Dashboard…',
];

// Shown by ProtectedRoute while the auth check resolves — replaces what used to be a blank
// screen. Same loading boolean, same redirect logic; this is the "boot" moment only.
export default function SplashScreen() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.splash}>
      <Logo variant="full" size="lg" />
      <p className={styles.tagline}>AI-Powered Delivery Intelligence</p>
      <p className={styles.phase}>{PHASES[phase]}</p>
    </div>
  );
}
