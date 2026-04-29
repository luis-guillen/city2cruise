import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:9000/api',
  withCredentials: true,  // envía cookie HttpOnly del refresh token
});

// ── Request interceptor: inyectar access token ────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: renovar access token automáticamente si expira ──────
let isRefreshing = false;
let pendingQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null) {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  pendingQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || originalRequest._retried) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    originalRequest._retried = true;
    isRefreshing = true;

    try {
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_URL || 'http://localhost:9000/api'}/auth/refresh`,
        {},
        { withCredentials: true }
      );

      const newToken: string = data.token;
      localStorage.setItem('token', newToken);
      if (data.user) {
        localStorage.setItem('userName', data.user.name);
        localStorage.setItem('role', data.user.role);
      }

      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      processQueue(null, newToken);
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      localStorage.removeItem('token');
      localStorage.removeItem('userName');
      localStorage.removeItem('role');
      localStorage.removeItem('homeCoords');
      window.dispatchEvent(new CustomEvent('auth:logout'));
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export interface PickupRequest {
  id: string;
  clientName: string;
  pickupLocation: string;
  latitude?: number | null;
  longitude?: number | null;
  packageSize: "SMALL" | "MEDIUM" | "LARGE";
  status: "REQUESTED" | "ACCEPTED" | "CONFIRMATION_PENDING" | "IN_PROGRESS" | "DEPOSITED" | "PICKED_UP";
  handshakeCode?: string | null;
  handshakeExpiresAt?: string | null;
  clientConfirmed: boolean;
  driverConfirmed: boolean;
  driver?: { id: number; name: string } | null;
  driverLatitude?: number | null;
  driverLongitude?: number | null;
  locker?: { id: number; label: string } | null;
  lockerCode?: string | null;
  lockerNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDTO {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

/** AUTH: Register user */
export async function registerUser(name: string, email: string, password: string, role: string): Promise<{ token: string; user: { id: number, name: string, role: string } }> {
  const res = await api.post('/auth/register', { name, email, password, role });
  return res.data;
}

/** AUTH: Login user */
export async function loginUser(email: string, password: string): Promise<{ token: string; user: { id: number, name: string, role: string, latitude?: number | null, longitude?: number | null } }> {
  const res = await api.post('/auth/login', { email, password });
  return res.data;
}

/** AUTH: Logout (revoca refresh token en servidor) */
export async function logoutUser(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // Ignorar errores de red en logout — limpiar estado local igualmente
  }
}

/** AUTH: Logout from all devices */
export async function logoutAllDevices(): Promise<void> {
  await api.post('/auth/logout-all');
}

/** AUTH: Change password */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.patch('/auth/password', { currentPassword, newPassword });
}

/** CLIENT: Create a new pickup request */
export async function handleCreateRequest(location: string, latitude: number | null, longitude: number | null, packageSize: "SMALL" | "MEDIUM" | "LARGE"): Promise<PickupRequest> {
  const res = await api.post('/requests', { pickupLocation: location, latitude, longitude, packageSize });
  return res.data;
}

/** CLIENT: Get current active request */
export async function getClientMine(): Promise<PickupRequest | null> {
  const res = await api.get('/requests/mine');
  return res.data;
}

/** CLIENT: Get Request History */
export async function getClientHistory(): Promise<PickupRequest[]> {
  const res = await api.get('/requests/history');
  return res.data;
}

/** CLIENT: Search Locations via Nominatim Proxy */
export async function searchLocations(query: string): Promise<Array<{ displayName: string, lat: number, lon: number }>> {
  if (!query || query.length < 3) return [];
  const res = await api.get(`/locations/search?q=${encodeURIComponent(query)}`);
  return res.data;
}

/** CLIENT: Get Notifications */
export async function getNotifications(): Promise<NotificationDTO[]> {
  const res = await api.get('/notifications');
  return res.data;
}

/** CLIENT: Mark Notification as Read */
export async function markNotificationRead(id: number): Promise<{ success: boolean }> {
  const res = await api.post(`/notifications/${id}/read`);
  return res.data;
}

/** CLIENT: Delete all notifications */
export async function deleteAllNotifications(): Promise<{ success: boolean }> {
  const res = await api.delete('/notifications');
  return res.data;
}

/** DRIVER: Get pending requests */
export async function getPendingRequests(lat?: number, lon?: number, radiusKm?: number): Promise<PickupRequest[]> {
  const params = new URLSearchParams();
  if (lat !== undefined) params.append('lat', lat.toString());
  if (lon !== undefined) params.append('lon', lon.toString());
  if (radiusKm !== undefined) params.append('radius', radiusKm.toString());

  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await api.get(`/requests/pending${queryString}`);
  return res.data;
}

/** DRIVER: Get my accepted/deposited pickups */
export async function getDriverPickups(): Promise<PickupRequest[]> {
  const res = await api.get('/requests/my-pickups');
  return res.data;
}

/** DRIVER: Accept a pending request */
export async function handleAcceptRequest(requestId: string, driverLat?: number, driverLon?: number, radiusKm?: number): Promise<PickupRequest> {
  const payload = { driverLat, driverLon, radiusKm };
  const res = await api.post(`/requests/${requestId}/accept`, payload);
  return res.data;
}

/** DRIVER: Mark request as deposited in locker */
export async function handleDeposit(requestId: string): Promise<PickupRequest> {
  const res = await api.post(`/requests/${requestId}/deposit`, {});
  return res.data;
}

/** DRIVER: Renew handshake code */
export async function handleRenewHandshake(requestId: string): Promise<PickupRequest> {
  const res = await api.post(`/requests/${requestId}/renew-handshake`);
  return res.data;
}

/** CLIENT: Confirm driver presence using code */
export async function handleConfirmDriver(requestId: string, handshakeCode: string): Promise<PickupRequest> {
  const res = await api.post(`/requests/${requestId}/confirm-driver`, { handshakeCode });
  return res.data;
}

/** CLIENT: Open locker with code */
export async function handleOpenLocker(code: string): Promise<PickupRequest> {
  const res = await api.post('/lockers/open', { lockerCode: code });
  return res.data;
}

/** ADMIN: Get all users with stats */
export async function getAdminUsers(): Promise<Array<{ id: number, name: string, email: string, role: string, created_at: string, total_requests: number, deposited_count: number, picked_up_count: number }>> {
  const res = await api.get('/admin/users');
  return res.data;
}

/** ADMIN: Delete user by ID */
export async function deleteAdminUser(userId: number): Promise<{ success: boolean; message: string }> {
  const res = await api.delete(`/admin/users/${userId}`);
  return res.data;
}

export interface ThroughputMetrics {
  total_requests: number;
  by_status: Record<string, number>;
  lockers_total: number;
  lockers_occupied: number;
  lockers_available: number;
  occupancy_rate: number;
  avg_rotation_today: number;
}

export interface TimingMetrics {
  avg_assignment_time_seconds: number | null;
  avg_delivery_time_seconds: number | null;
  avg_total_time_seconds: number | null;
  requests_today: number;
  requests_this_week: number;
}

export interface FleetStatus {
  total_drivers: number;
  active_drivers: number;
  on_delivery: number;
  available: number;
}

export interface AuditEvent {
  id: string;
  request_id: number;
  event_type: string;
  actor_id: number;
  metadata: string | null;
  signature: string;
  created_at: string;
}

export async function getMetricsThroughput(): Promise<ThroughputMetrics> {
  const res = await api.get('/admin/metrics/throughput');
  return res.data;
}

export async function getMetricsTiming(): Promise<TimingMetrics> {
  const res = await api.get('/admin/metrics/timing');
  return res.data;
}

export async function getFleetStatus(): Promise<FleetStatus> {
  const res = await api.get('/admin/fleet-status');
  return res.data;
}

export async function getAuditTrailByRequest(requestId: number): Promise<AuditEvent[]> {
  const res = await api.get(`/admin/audit-trail/${requestId}`);
  return res.data;
}

// ── PAYMENTS ─────────────────────────────────────────────────────────────────

export interface PaymentIntent {
  clientSecret: string;
  paymentId: number;
  amountCents: number;
}

export interface PaymentRecord {
  id: number;
  request_id: number;
  amount_cents: number;
  currency: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'FAILED' | 'CANCELLED';
  captured_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  created_at: string;
  pickup_location: string;
  package_size: string;
}

interface AdminPaymentsResponse {
  page: number;
  limit: number;
  total: number;
  payments: PaymentRecord[];
}

/** CLIENT: Create a PaymentIntent for a request (auth-only) */
export async function createPaymentIntent(requestId: number, packageSize: string): Promise<PaymentIntent> {
  const res = await api.post('/payments/create-intent', { requestId, packageSize });
  return res.data;
}

/** CLIENT: Confirm that Stripe Elements has authorized the payment */
export async function confirmPayment(requestId: number, paymentIntentId: string): Promise<{ status: string }> {
  const res = await api.post('/payments/confirm', { requestId, paymentIntentId });
  return res.data;
}

/** CLIENT: Get payment history */
export async function getPaymentHistory(): Promise<PaymentRecord[]> {
  const res = await api.get('/payments/history');
  return res.data;
}

/** ADMIN: Get all payments (uses admin route with pagination) */
export async function getAdminPayments(page = 1, limit = 50): Promise<PaymentRecord[]> {
  const res = await api.get<AdminPaymentsResponse>(`/admin/payments?page=${page}&limit=${limit}`);
  return res.data.payments;
}

/** ADMIN: Refund a payment for a request */
export async function adminRefundPayment(requestId: number): Promise<{ ok: boolean }> {
  const res = await api.post('/payments/admin/refund', { requestId });
  return res.data;
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────

export interface NotificationPrefs {
  push_enabled: boolean;
  sms_enabled: boolean;
  locale: 'es' | 'en' | 'ca';
  phone: string | null;
}

/** Get VAPID public key from backend */
export async function getVapidPublicKey(): Promise<string> {
  const res = await api.get('/push/vapid-public-key');
  return res.data.publicKey;
}

/** Register a push subscription on the backend */
export async function registerPushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await api.post('/push/subscribe', sub);
}

/** Remove a push subscription (on logout or permission revoked) */
export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  await api.delete('/push/subscribe', { data: { endpoint } });
}

/** Get current user notification preferences */
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const res = await api.get('/push/prefs');
  return res.data;
}

/** Update notification preferences */
export async function updateNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<void> {
  await api.patch('/push/prefs', {
    pushEnabled: prefs.push_enabled,
    smsEnabled: prefs.sms_enabled,
    locale: prefs.locale,
    phone: prefs.phone,
  });
}
