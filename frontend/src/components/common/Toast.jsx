import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export default function Toast({ message, variant = 'info', leaving, onDismiss }) {
  const Icon = ICONS[variant] ?? Info;

  return (
    <div className={styles.toast} data-variant={variant} data-leaving={leaving} role="status">
      <Icon size={18} className={styles.icon} />
      <span className={styles.message}>{message}</span>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </div>
  );
}
