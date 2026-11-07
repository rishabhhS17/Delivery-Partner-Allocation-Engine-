import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

const SimulationContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

// Grace period before showing the alarming "disconnected" banner. Suppresses brief network
// blips and React StrictMode's dev-mode mount/cleanup/remount flicker, which would otherwise
// flash a scary message for a connection that was never actually unhealthy.
const DISCONNECT_GRACE_MS = 4000;
// Wait between reconnect attempts: 1 s, 2 s, 4 s, then every 8 s.
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];

// Splits a Server-Sent Events byte stream into { event, data } messages.
function createEventParser(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      }
      if (dataLines.length) onMessage(event, JSON.parse(dataLines.join('\n')));
    }
  };
}

export function SimulationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();

  const [connected, setConnected]     = useState(false);
  const [showDisconnectedBanner, setShowDisconnectedBanner] = useState(false);
  const [riders, setRiders]           = useState([]);
  const [queueDepth, setQueueDepth]   = useState(0);
  const [dispatchPaused, setDispatchPaused] = useState(false);
  const [allocations, setAllocations] = useState([]);
  const [routes, setRoutes]           = useState(new Map());

  const hasEverConnectedRef = useRef(false);
  const disconnectTimerRef  = useRef(null);

  useEffect(() => {
    // The server rejects unauthenticated stream requests. Don't connect until auth has finished
    // rehydrating and a user is actually logged in; this effect re-runs on login/logout.
    if (authLoading || !user) {
      setConnected(false);
      setShowDisconnectedBanner(false);
      hasEverConnectedRef.current = false;
      return;
    }

    const controller = new AbortController();
    let reconnectAttempt = 0;
    let reconnectTimer = null;

    const clearDisconnectTimer = () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
    };

    const handleMessage = (event, data) => {
      switch (event) {
        case 'snapshot':
          // Every (re)connection starts from the server's current state — nothing is replayed.
          hasEverConnectedRef.current = true;
          reconnectAttempt = 0;
          clearDisconnectTimer();
          setConnected(true);
          setShowDisconnectedBanner(false);
          setRiders(data.riders ?? []);
          setQueueDepth(data.queueDepth ?? 0);
          setDispatchPaused(Boolean(data.dispatchPaused));
          setRoutes(new Map((data.routes ?? []).map(({ orderId, ...route }) => [orderId, route])));
          setAllocations([...(data.recentAssignments ?? [])].reverse().map((a) => ({ ...a, ts: a.ts ?? Date.now() })));
          break;
        case 'simulation:tick':
          setRiders(data.riders ?? []);
          setQueueDepth(data.queueDepth ?? 0);
          setDispatchPaused(Boolean(data.dispatchPaused));
          break;
        case 'order:assigned':
          setAllocations((prev) => [{ ...data, ts: data.ts ?? Date.now() }, ...prev].slice(0, 100));
          break;
        case 'order:route':
          setRoutes((prev) => new Map(prev).set(data.orderId, {
            riderId: data.riderId, leg1Coords: data.leg1Coords, leg2Coords: data.leg2Coords,
          }));
          break;
        case 'order:delivered':
          setAllocations((prev) => prev.map((a) => (a.orderId === data.orderId ? { ...a, delivered: true } : a)));
          setRoutes((prev) => {
            const next = new Map(prev);
            next.delete(data.orderId);
            return next;
          });
          break;
        default:
          break;
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      // Only arm the alarming banner if this stream was genuinely connected before — this is
      // what prevents a StrictMode double-mount or a brief reconnect blip from ever showing it.
      if (hasEverConnectedRef.current && !disconnectTimerRef.current) {
        disconnectTimerRef.current = setTimeout(() => setShowDisconnectedBanner(true), DISCONNECT_GRACE_MS);
      }
    };

    const connect = async () => {
      try {
        const response = await fetch(`${API_BASE}/stream`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: controller.signal,
        });
        if (response.status === 401) return; // token rejected — the next login re-runs this effect
        if (!response.ok || !response.body) throw new Error(`stream responded ${response.status}`);

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        const parse = createEventParser(handleMessage);
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parse(value);
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      handleDisconnect();
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      controller.abort();
      clearTimeout(reconnectTimer);
      clearDisconnectTimer();
    };
  }, [authLoading, user?._id]);

  return (
    <SimulationContext.Provider
      value={{ connected, showDisconnectedBanner, riders, queueDepth, dispatchPaused, allocations, routes }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  return useContext(SimulationContext);
}
