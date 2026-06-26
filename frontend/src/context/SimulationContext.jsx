import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SimulationContext = createContext(null);

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000';

export function SimulationProvider({ children }) {
  const [connected, setConnected]     = useState(false);
  const [riders, setRiders]           = useState([]);
  const [queueDepth, setQueueDepth]   = useState(0);
  const [allocations, setAllocations] = useState([]);

  useEffect(() => {
    const socket = io(WS_URL, { transports: ['websocket'] });

    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('simulation:tick', (data) => {
      setRiders(data.riders ?? []);
      setQueueDepth(data.queueDepth ?? 0);
    });

    socket.on('order:assigned', (event) => {
      setAllocations((prev) => [{ ...event, ts: Date.now() }, ...prev].slice(0, 100));
    });

    socket.on('order:delivered', ({ orderId }) => {
      setAllocations((prev) =>
        prev.map((a) => (a.orderId === orderId ? { ...a, delivered: true } : a))
      );
    });

    return () => { socket.disconnect(); };
  }, []);

  return (
    <SimulationContext.Provider value={{ connected, riders, queueDepth, allocations }}>
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  return useContext(SimulationContext);
}
