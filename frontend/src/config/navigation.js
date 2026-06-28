import {
  LayoutDashboard, Bike, UtensilsCrossed, Users, Package,
  MapPin, Map, History, Settings as SettingsIcon,
} from 'lucide-react';

export const NAVIGATION_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Riders', path: '/riders', icon: Bike },
  { label: 'Restaurants', path: '/restaurants', icon: UtensilsCrossed },
  { label: 'Customers', path: '/customers', icon: Users },
  { label: 'Orders', path: '/orders', icon: Package },
  { label: 'Rider Map',  path: '/map/riders', icon: MapPin },
  { label: 'Order Map', path: '/map/orders', icon: Map },
  { label: 'Allocation History', path: '/allocation-history', icon: History },
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
];
