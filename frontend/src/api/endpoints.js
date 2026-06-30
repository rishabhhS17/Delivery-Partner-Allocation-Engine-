import api from './axios';

// Auth
export const login  = (body) => api.post('/auth/login', body);
export const getMe  = ()     => api.get('/auth/me');

// Riders
export const getRiders  = () => api.get('/riders').then(r => ({ data: r.data?.data ?? r.data }));
export const getRider   = (id) => api.get(`/riders/${id}`);
export const updateLocation = (id, body) => api.put(`/riders/${id}/location`, body);
export const updateStatus   = (id, body) => api.put(`/riders/${id}/status`, body);

// Restaurants
export const getRestaurants   = () => api.get('/restaurants').then(r => ({ data: r.data?.data ?? r.data }));
export const createRestaurant = (body) => api.post('/restaurants', body);
export const deleteRestaurant = (id)   => api.delete(`/restaurants/${id}`);

// Customers
export const getCustomers   = () => api.get('/customers').then(r => ({ data: r.data?.data ?? r.data }));
export const createCustomer = (body) => api.post('/customers', body);
export const deleteCustomer = (id)   => api.delete(`/customers/${id}`);

// Orders
export const getOrders  = (params) => api.get('/orders', { params }).then(r => ({ data: r.data?.data ?? r.data }));
export const getOrder   = (id)     => api.get(`/orders/${id}`);
export const createOrder  = ()       => api.post('/orders');
export const bulkOrders   = (count)  => api.post('/orders/bulk', { count });
export const acceptOrder  = (id)     => api.put(`/orders/${id}/accept`);

// Allocation
export const allocateOrder       = (orderId) => api.post('/allocation/allocate', { orderId });
export const getAllocationHistory = (params) => api.get('/allocation/history', { params });

// Config
export const getWeights = ()     => api.get('/config/weights');
export const setWeights = (body) => api.put('/config/weights', body);

// Simulation control
export const startSimulation     = () => api.post('/simulation/start');
export const stopSimulation      = () => api.post('/simulation/stop');
export const getSimulationStatus = () => api.get('/simulation/status');

// Analytics
export const getAnalytics = () => api.get('/analytics');
