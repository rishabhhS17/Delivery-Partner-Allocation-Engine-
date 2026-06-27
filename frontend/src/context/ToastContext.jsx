import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Toast from '../components/common/Toast';
import styles from './ToastContext.module.css';

const ToastContext = createContext(null);
const AUTO_DISMISS_MS = 4000;
const EXIT_ANIMATION_MS = 150;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const show = useCallback((message, variant = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, variant, leaving: false }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  const toast = {
    success: (message) => show(message, 'success'),
    error: (message) => show(message, 'error'),
    info: (message) => show(message, 'info'),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={styles.stack}>
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} variant={t.variant} leaving={t.leaving} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
