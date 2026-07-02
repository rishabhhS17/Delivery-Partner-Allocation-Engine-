import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SimulationContext = createContext(null);

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000';

// Grace period before showing the alarming "disconnected" banner. Suppresses brief transport
// blips and React StrictMode's dev-mode mount/cleanup/remount flicker, which would otherwise
// flash a scary message for a connection that was never actually unhealthy.
const DISCONNECT_GRACE_MS = 4000;

export function SimulationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();

  const [connected, setConnected]     = useState(false);
  const [showDisconnectedBanner, setShowDisconnectedBanner] = useState(false);
  const [riders, setRiders]           = useState([]);
  const [queueDepth, setQueueDepth]   = useState(0);
  const [allocations, setAllocations] = useState([]);
  const [routes, setRoutes]           = useState(new Map());

  const hasEverConnectedRef = useRef(false);
  const disconnectTimerRef  = useRef(null);

  useEffect(() => {
    // The server rejects unauthenticated socket handshakes. Don't attempt a connection until
    // auth has finished rehydrating and a user is actually logged in — otherwise a connection
    // created before login (or left over after logout) would be permanently rejected with no
    // way to recover, since this effect would never re-run to retry with a fresh token.
    if (authLoading || !user) {
      setConnected(false);
      setShowDisconnectedBanner(false);
      hasEverConnectedRef.current = false;
      return;
    }

    const token  = localStorage.getItem('token');
    const socket = io(WS_URL, { transports: ['websocket', 'polling'], auth: { token } });

    const clearDisconnectTimer = () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
    };

    socket.on('connect', () => {
      hasEverConnectedRef.current = true;
      clearDisconnectTimer();
      setConnected(true);
      setShowDisconnectedBanner(false);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      // Only arm the alarming banner if this socket was genuinely connected before — this is
      // what prevents a StrictMode double-mount or a brief reconnect blip from ever showing it.
      if (hasEverConnectedRef.current) {
        clearDisconnectTimer();
        disconnectTimerRef.current = setTimeout(() => setShowDisconnectedBanner(true), DISCONNECT_GRACE_MS);
      }
    });

    socket.on('simulation:tick', (data) => {
      setRiders(data.riders ?? []);
      setQueueDepth(data.queueDepth ?? 0);
    });

    socket.on('recent:assignments', (list) => {
      setAllocations([...list].reverse().map((a) => ({ ...a, ts: a.ts ?? Date.now() })));
    });

    socket.on('order:assigned', (event) => {
      setAllocations((prev) => [{ ...event, ts: event.ts ?? Date.now() }, ...prev].slice(0, 100));
    });

    socket.on('order:route', ({ orderId, riderId, leg1Coords, leg2Coords }) => {
      setRoutes((prev) => new Map(prev).set(orderId, { riderId, leg1Coords, leg2Coords }));
    });

    socket.on('order:delivered', ({ orderId }) => {
      setAllocations((prev) =>
        prev.map((a) => (a.orderId === orderId ? { ...a, delivered: true } : a))
      );
      setRoutes((prev) => {
        const next = new Map(prev);
        next.delete(orderId);
        return next;
      });
    });

    return () => {
      clearDisconnectTimer();
      socket.disconnect();
    };
  }, [authLoading, user?._id]);

  return (
    <SimulationContext.Provider
      value={{ connected, showDisconnectedBanner, riders, queueDepth, allocations, routes }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  return useContext(SimulationContext);
}
