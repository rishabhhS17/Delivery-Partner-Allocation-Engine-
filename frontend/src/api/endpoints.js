import api from './axios';

// Auth
export const login  = (body) => api.post('/auth/login', body);
export const getMe  = ()     => api.get('/auth/me');
export const register           = (body) => api.post('/auth/register', body);
export const verifyRegisterOtp  = (body) => api.post('/auth/register/verify-otp', body);
export const forgotPassword     = (body) => api.post('/auth/forgot-password', body);
export const verifyResetOtp     = (body) => api.post('/auth/forgot-password/verify-otp', body);
export const resetPassword      = (body) => api.post('/auth/reset-password', body);

// Riders
export const getRiders  = () => api.get('/riders').then(r => ({ data: r.data?.data ?? r.data }));
export const getRider   = (id) => api.get(`/riders/${id}`);
export const createRider = (body) => api.post('/riders', body);

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
export const createOrder  = (body = {}, key) => api.post('/orders', body, key ? { headers: { 'X-Idempotency-Key': key } } : {});
export const bulkOrders   = (count, key) => api.post('/orders/bulk', { count }, key ? { headers: { 'X-Idempotency-Key': key } } : {});

// Allocation
export const allocateOrder       = (orderId) => api.post('/allocation/allocate', { orderId });
export const getAllocationHistory = (params) => api.get('/allocation/history', { params });

// Config
export const getWeights = ()     => api.get('/config/weights');
export const setWeights = (body) => api.put('/config/weights', body);

// Analytics
export const getAnalytics = (opts = {}) => api.get('/analytics', opts);
