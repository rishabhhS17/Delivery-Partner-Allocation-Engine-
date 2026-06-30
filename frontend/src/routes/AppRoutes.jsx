import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import Login from '../pages/Login';
import AuthCallback from '../pages/AuthCallback';
import Dashboard from '../pages/Dashboard';
import Riders from '../pages/Riders';
import Restaurants from '../pages/Restaurants';
import Customers from '../pages/Customers';
import Orders from '../pages/Orders';
import RiderMap from '../pages/RiderMap';
import OrdersMap from '../pages/OrdersMap';
import OrderMap from '../pages/OrderMap';
import AllocationHistory from '../pages/AllocationHistory';
import Settings from '../pages/Settings';
import NotFound from '../pages/NotFound';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="riders" element={<Riders />} />
          <Route path="restaurants" element={<Restaurants />} />
          <Route path="customers" element={<Customers />} />
          <Route path="orders" element={<Orders />} />
          <Route path="map/riders" element={<RiderMap />} />
          <Route path="map/orders" element={<OrdersMap />} />
          <Route path="map/orders/:id" element={<OrderMap />} />
          <Route path="allocation-history" element={<AllocationHistory />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
