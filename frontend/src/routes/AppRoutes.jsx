import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import Dashboard from '../pages/Dashboard';
import Riders from '../pages/Riders';
import Orders from '../pages/Orders';
import LiveMap from '../pages/LiveMap';
import AllocationHistory from '../pages/AllocationHistory';
import Settings from '../pages/Settings';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="riders" element={<Riders />} />
        <Route path="orders" element={<Orders />} />
        <Route path="live-map" element={<LiveMap />} />
        <Route path="allocation-history" element={<AllocationHistory />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
