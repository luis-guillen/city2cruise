import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import {
  getAdminUsers, deleteAdminUser,
  getMetricsThroughput, getMetricsTiming, getFleetStatus,
  getAuditTrailByRequest, verifyAuditTrailByRequest, getAdminPayments, adminRefundPayment,
  ThroughputMetrics, TimingMetrics, FleetStatus, AuditEvent, PaymentRecord, CustodyChainVerification
} from '@/services/api';
import GlassNavbar from '@/components/ios/GlassNavbar';
import GlassCard from '@/components/ios/GlassCard';
import GlassSegmented from '@/components/ios/GlassSegmented';
import GlassInput from '@/components/ios/GlassInput';
import { toast } from 'sonner';
import {
  BarChart3, Users, Truck, Shield, LogOut,
  RefreshCw, Search, UserX, Clock, Package,
  Activity, Lock, TrendingUp, CreditCard, RotateCcw, CheckCircle2,
  XCircle, AlertCircle, MinusCircle
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: '#FF9500',
  CONFIRMATION_PENDING: '#AF52DE',
  IN_PROGRESS: '#007AFF',
  DEPOSITED: '#34C759',
  PICKED_UP: '#5856D6',
};

const AUDIT_BADGE: Record<string, string> = {
  REQUESTED: 'ios-badge-orange',
  ASSIGNED: 'ios-badge-blue',
  CONFIRMATION_PENDING: 'ios-badge-purple',
  HANDSHAKE_VALIDATED: 'ios-badge-green',
  IN_PROGRESS: 'ios-badge-blue',
  DEPOSITED: 'ios-badge-green',
  PICKED_UP: 'ios-badge-purple',
  RATE_LIMIT_BLOCK: 'ios-badge-red',
  CANCELLED: 'ios-badge-red',
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { role, logout } = useApp();
  const [activeTab, setActiveTab] = useState('metrics');

  // Data states
  const [users, setUsers] = useState<Array<{ id: number; name: string; email: string; role: string; created_at: string; total_requests: number; deposited_count: number; picked_up_count: number }>>([]);
  const [throughput, setThroughput] = useState<ThroughputMetrics | null>(null);
  const [timing, setTiming] = useState<TimingMetrics | null>(null);
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditVerification, setAuditVerification] = useState<CustodyChainVerification | null>(null);
  const [auditSearchId, setAuditSearchId] = useState('');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [refundingId, setRefundingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role !== 'ADMIN') { navigate('/'); return; }
    loadAll();
  }, [role, navigate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [u, t, tm, f] = await Promise.all([
        getAdminUsers(), getMetricsThroughput(), getMetricsTiming(), getFleetStatus()
      ]);
      setUsers(u); setThroughput(t); setTiming(tm); setFleet(f);
    } catch { toast.error('Error cargando datos'); }
    finally { setLoading(false); }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('¿Eliminar este usuario?')) return;
    try {
      await deleteAdminUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      toast.success('Usuario eliminado');
    } catch { toast.error('Error al eliminar'); }
  };

  const loadPayments = async () => {
    setPaymentsLoading(true);
    try {
      const data = await getAdminPayments();
      setPayments(data);
    } catch { toast.error('Error cargando pagos'); }
    finally { setPaymentsLoading(false); }
  };

  const handleRefund = async (requestId: number) => {
    if (!confirm('¿Emitir reembolso para este pedido?')) return;
    setRefundingId(requestId);
    try {
      await adminRefundPayment(requestId);
      toast.success('Reembolso emitido');
      await loadPayments();
    } catch { toast.error('Error al emitir reembolso'); }
    finally { setRefundingId(null); }
  };

  const handleAuditSearch = async () => {
    const id = parseInt(auditSearchId);
    if (isNaN(id) || id < 1) { toast.error('ID inválido'); return; }
    try {
      const [events, verification] = await Promise.all([
        getAuditTrailByRequest(id),
        verifyAuditTrailByRequest(id),
      ]);
      setAuditEvents(events);
      setAuditVerification(verification);
      if (events.length === 0) toast('Sin eventos para esta solicitud');
    } catch { toast.error('Error buscando auditoría'); }
  };

  const handleLogout = () => { logout(); navigate('/'); };

  const chartData = throughput
    ? Object.entries(throughput.by_status).map(([name, value]) => ({ name, value }))
    : [];

  const tabs = [
    { id: 'metrics', label: 'Métricas' },
    { id: 'fleet', label: 'Flota' },
    { id: 'users', label: 'Usuarios' },
    { id: 'payments', label: 'Pagos' },
    { id: 'audit', label: 'Auditoría' },
  ];

  useEffect(() => {
    if (activeTab === 'payments' && payments.length === 0 && !paymentsLoading) {
      loadPayments();
    }
  }, [activeTab]);

  const Skeleton = ({ rows = 3 }: { rows?: number }) => (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ios-skeleton h-16 w-full" />
      ))}
    </div>
  );

  const formatSeconds = (s: number | null) => s != null ? `${Math.round(s / 60)} min` : '—';

  return (
    <div className="min-h-dvh bg-[var(--ios-bg-primary)]">
      <GlassNavbar
        title="Administración"
        trailing={
          <div className="flex items-center gap-1">
            <a
              href="/admin/control-tower"
              className="p-2 rounded-full hover:bg-black/5 active:scale-95 transition text-[var(--ios-blue)] text-xs font-semibold"
              title="Torre de Control (Hito 5.4.4)"
            >
              Torre
            </a>
            <button onClick={loadAll} className="p-2 rounded-full hover:bg-black/5 active:scale-95 transition">
              <RefreshCw className={`w-5 h-5 text-[var(--ios-blue)] ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={handleLogout} className="p-2 rounded-full hover:bg-black/5 active:scale-95 transition">
              <LogOut className="w-5 h-5 text-[var(--ios-text-secondary)]" />
            </button>
          </div>
        }
      />

      <div className="ios-page-notab max-w-2xl mx-auto px-4">
        <GlassSegmented items={tabs} active={activeTab} onChange={setActiveTab} className="mb-5" />

        {/* ═══ METRICS TAB ═══ */}
        {activeTab === 'metrics' && (
          <div className="space-y-4 animate-fade-in">
            {loading ? <Skeleton rows={4} /> : throughput && timing && (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <KPICard
                    icon={<Package className="w-5 h-5 text-[var(--ios-blue)]" />}
                    iconBg="bg-[var(--ios-blue)]/10"
                    label="Total solicitudes"
                    value={throughput.total_requests}
                    sub={`${timing.requests_today} hoy / ${timing.requests_this_week} semana`}
                    delay={0}
                  />
                  <KPICard
                    icon={<Lock className="w-5 h-5 text-[var(--ios-green)]" />}
                    iconBg="bg-[var(--ios-green)]/10"
                    label="Lockers ocupados"
                    value={`${throughput.lockers_occupied}/${throughput.lockers_total}`}
                    sub={`${Math.round(throughput.occupancy_rate)}% ocupación`}
                    delay={1}
                    progress={throughput.occupancy_rate}
                  />
                  <KPICard
                    icon={<Clock className="w-5 h-5 text-[var(--ios-orange)]" />}
                    iconBg="bg-[var(--ios-orange)]/10"
                    label="Tiempo medio"
                    value={formatSeconds(timing.avg_delivery_time_seconds)}
                    sub={`Asignación: ${formatSeconds(timing.avg_assignment_time_seconds)}`}
                    delay={2}
                  />
                  <KPICard
                    icon={<Activity className="w-5 h-5 text-[var(--ios-purple)]" />}
                    iconBg="bg-[var(--ios-purple)]/10"
                    label="Conductores"
                    value={fleet?.active_drivers ?? 0}
                    sub={`${fleet?.on_delivery ?? 0} en reparto / ${fleet?.available ?? 0} disponibles`}
                    delay={3}
                  />
                </div>

                {/* Chart */}
                {chartData.length > 0 && (
                  <GlassCard variant="ultra" delay={4}>
                    <h3 className="ios-title mb-3 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-[var(--ios-blue)]" />
                      Solicitudes por estado
                    </h3>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ left: -20 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              background: 'rgba(255,255,255,0.92)',
                              backdropFilter: 'blur(20px)',
                              border: '0.5px solid rgba(255,255,255,0.6)',
                              borderRadius: 12,
                              fontSize: 13,
                            }}
                          />
                          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                            {chartData.map((entry) => (
                              <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#8E8E93'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassCard>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ FLEET TAB ═══ */}
        {activeTab === 'fleet' && (
          <div className="space-y-4 animate-fade-in">
            {loading ? <Skeleton /> : fleet && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Total', value: fleet.total_drivers, color: 'var(--ios-text-primary)' },
                    { label: 'Activos', value: fleet.active_drivers, color: 'var(--ios-green)' },
                    { label: 'Reparto', value: fleet.on_delivery, color: 'var(--ios-blue)' },
                    { label: 'Disponibles', value: fleet.available, color: 'var(--ios-orange)' },
                  ].map((stat, i) => (
                    <GlassCard key={stat.label} variant="default" className="text-center" delay={i}>
                      <p className="text-[24px] font-bold" style={{ color: stat.color }}>{stat.value}</p>
                      <p className="ios-caption">{stat.label}</p>
                    </GlassCard>
                  ))}
                </div>

                {/* Drivers list */}
                <GlassCard variant="ultra" padding="none">
                  <div className="px-4 pt-4 pb-2">
                    <h3 className="ios-title flex items-center gap-2">
                      <Truck className="w-5 h-5 text-[var(--ios-blue)]" />
                      Conductores
                    </h3>
                  </div>
                  {users.filter(u => u.role === 'DRIVER').map((driver) => (
                    <div key={driver.id} className="ios-list-item">
                      <div className="w-9 h-9 rounded-full bg-[var(--ios-blue)]/10 flex items-center justify-center flex-shrink-0">
                        <Truck className="w-4 h-4 text-[var(--ios-blue)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-medium truncate">{driver.name}</p>
                        <p className="ios-caption truncate">{driver.email}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[13px] font-semibold">{driver.deposited_count} dep.</p>
                        <p className="ios-caption">{driver.picked_up_count} rec.</p>
                      </div>
                    </div>
                  ))}
                </GlassCard>
              </>
            )}
          </div>
        )}

        {/* ═══ USERS TAB ═══ */}
        {activeTab === 'users' && (
          <div className="animate-fade-in">
            {loading ? <Skeleton rows={5} /> : (
              <GlassCard variant="ultra" padding="none">
                <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                  <h3 className="ios-title flex items-center gap-2">
                    <Users className="w-5 h-5 text-[var(--ios-blue)]" />
                    Usuarios ({users.length})
                  </h3>
                </div>
                {users.map((user) => (
                  <div key={user.id} className="ios-list-item">
                    <div className={`
                      w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                      ${user.role === 'ADMIN' ? 'bg-[var(--ios-red)]/10' : user.role === 'DRIVER' ? 'bg-[var(--ios-blue)]/10' : 'bg-[var(--ios-green)]/10'}
                    `}>
                      <span className="text-[13px] font-bold">
                        {user.role === 'ADMIN' ? 'A' : user.role === 'DRIVER' ? 'D' : 'C'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[15px] font-medium truncate">{user.name}</p>
                        <span className={`ios-badge text-[10px] ${user.role === 'ADMIN' ? 'ios-badge-red' : user.role === 'DRIVER' ? 'ios-badge-blue' : 'ios-badge-green'}`}>
                          {user.role}
                        </span>
                      </div>
                      <p className="ios-caption truncate">{user.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0 flex items-center gap-2">
                      <div>
                        <p className="text-[12px] font-medium">{user.total_requests} sol.</p>
                      </div>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-2 rounded-xl hover:bg-[var(--ios-red)]/10 transition active:scale-95"
                      >
                        <UserX className="w-4 h-4 text-[var(--ios-red)]" />
                      </button>
                    </div>
                  </div>
                ))}
              </GlassCard>
            )}
          </div>
        )}

        {/* ═══ PAYMENTS TAB ═══ */}
        {activeTab === 'payments' && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="ios-title flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[var(--ios-blue)]" />
                Transacciones
              </h3>
              <button onClick={loadPayments} className="p-2 rounded-full hover:bg-black/5 transition active:scale-95">
                <RefreshCw className={`w-4 h-4 text-[var(--ios-blue)] ${paymentsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {paymentsLoading ? (
              <Skeleton rows={5} />
            ) : payments.length === 0 ? (
              <div className="ios-empty">
                <CreditCard className="w-12 h-12" />
                <p className="ios-subtitle mt-2">Sin transacciones aún</p>
              </div>
            ) : (
              <GlassCard variant="ultra" padding="none">
                {payments.map((payment) => (
                  <div key={payment.id} className="ios-list-item flex-wrap gap-y-2">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <PaymentStatusIcon status={payment.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-semibold">#{payment.request_id}</p>
                        <PaymentStatusBadge status={payment.status} />
                        <span className="text-[12px] text-[var(--ios-text-tertiary)]">
                          {payment.package_size === 'SMALL' ? 'Pequeño' : payment.package_size === 'MEDIUM' ? 'Mediano' : 'Grande'}
                        </span>
                      </div>
                      <p className="text-[12px] text-[var(--ios-text-secondary)] truncate mt-0.5">
                        {payment.pickup_location}
                      </p>
                      <p className="text-[11px] text-[var(--ios-text-tertiary)] mt-0.5">
                        {new Date(payment.created_at).toLocaleString('es-ES', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[16px] font-bold text-[var(--ios-text-primary)]">
                        {(payment.amount_cents / 100).toFixed(2)} €
                      </span>
                      {(payment.status === 'AUTHORIZED' || payment.status === 'CAPTURED') && (
                        <button
                          onClick={() => handleRefund(payment.request_id)}
                          disabled={refundingId === payment.request_id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-[10px] bg-[var(--ios-red)]/10 text-[var(--ios-red)] text-[12px] font-medium hover:bg-[var(--ios-red)]/15 transition active:scale-95 disabled:opacity-50"
                        >
                          {refundingId === payment.request_id ? (
                            <span className="ios-spinner w-3 h-3 border-[var(--ios-red)]/30 border-t-[var(--ios-red)]" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                          Reembolso
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </GlassCard>
            )}
          </div>
        )}

        {/* ═══ AUDIT TAB ═══ */}
        {activeTab === 'audit' && (
          <div className="space-y-4 animate-fade-in">
            <GlassCard variant="ultra">
              <h3 className="ios-title flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-[var(--ios-blue)]" />
                Auditoría HMAC-SHA256
              </h3>
              <div className="flex gap-2">
                <GlassInput
                  icon={<Search className="w-5 h-5" />}
                  type="number"
                  placeholder="ID de solicitud"
                  value={auditSearchId}
                  onChange={(e) => setAuditSearchId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuditSearch()}
                  className="flex-1"
                />
                <button onClick={handleAuditSearch} className="ios-btn-primary ios-btn-sm">
                  Buscar
                </button>
              </div>
            </GlassCard>

            {auditVerification && (
              <GlassCard variant="ultra">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="ios-title flex items-center gap-2">
                      <Shield className={`w-5 h-5 ${auditVerification.verified ? 'text-[var(--ios-green)]' : 'text-[var(--ios-red)]'}`} />
                      Cadena de custodia
                    </h4>
                    <p className="ios-caption mt-1">
                      {auditVerification.storageMode} · {auditVerification.blockCount} bloques · {auditVerification.criticalBlockCount} bloques críticos
                    </p>
                    {auditVerification.lastEventHash && (
                      <p className="font-mono text-[11px] text-[var(--ios-text-tertiary)] mt-1">
                        {auditVerification.lastEventHash.slice(0, 24)}...
                      </p>
                    )}
                  </div>
                  <span className={`ios-badge ${auditVerification.verified ? 'ios-badge-green' : 'ios-badge-red'}`}>
                    {auditVerification.verified ? 'Verificada' : 'Inválida'}
                  </span>
                </div>
                {auditVerification.issues.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {auditVerification.issues.map((issue, idx) => (
                      <p key={idx} className="ios-caption text-[var(--ios-red)]">{issue}</p>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}

            {auditEvents.length > 0 && (
              <GlassCard variant="ultra" padding="none">
                <div className="px-4 pt-4 pb-2">
                  <p className="ios-caption">{auditEvents.length} eventos encontrados</p>
                </div>
                {auditEvents.map((event) => (
                  <div key={event.id} className="ios-list-item flex-col items-start gap-1">
                    <div className="flex items-center justify-between w-full">
                      <span className={`ios-badge ${AUDIT_BADGE[event.event_type] || 'ios-badge-gray'}`}>
                        {event.event_type}
                      </span>
                      <span className="ios-caption">
                        {new Date(event.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 w-full mt-1">
                      <span className="ios-caption">Actor: {event.actor_id}</span>
                      {event.metadata && (
                        <span className="ios-caption truncate flex-1">
                          {(() => {
                            try { return JSON.stringify(JSON.parse(event.metadata)).slice(0, 60); }
                            catch { return event.metadata.slice(0, 60); }
                          })()}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-[var(--ios-text-tertiary)] mt-0.5">
                      #{event.block_index} · {event.event_hash.slice(0, 16)}...
                    </p>
                  </div>
                ))}
              </GlassCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Payment Status Icon ── */
function PaymentStatusIcon({ status }: { status: PaymentRecord['status'] }) {
  const cfg: Record<PaymentRecord['status'], { icon: React.ReactNode; color: string }> = {
    PENDING:    { icon: <MinusCircle className="w-5 h-5" />, color: 'text-[var(--ios-text-tertiary)]' },
    AUTHORIZED: { icon: <AlertCircle className="w-5 h-5" />, color: 'text-[var(--ios-orange)]' },
    CAPTURED:   { icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-[var(--ios-green)]' },
    REFUNDED:   { icon: <RotateCcw className="w-5 h-5" />, color: 'text-[var(--ios-purple)]' },
    FAILED:     { icon: <XCircle className="w-5 h-5" />, color: 'text-[var(--ios-red)]' },
    CANCELLED:  { icon: <XCircle className="w-5 h-5" />, color: 'text-[var(--ios-text-tertiary)]' },
  };
  const { icon, color } = cfg[status] ?? cfg.PENDING;
  return <span className={color}>{icon}</span>;
}

/* ── Payment Status Badge ── */
function PaymentStatusBadge({ status }: { status: PaymentRecord['status'] }) {
  const badgeCls: Record<PaymentRecord['status'], string> = {
    PENDING:    'ios-badge-gray',
    AUTHORIZED: 'ios-badge-orange',
    CAPTURED:   'ios-badge-green',
    REFUNDED:   'ios-badge-purple',
    FAILED:     'ios-badge-red',
    CANCELLED:  'ios-badge-gray',
  };
  const labels: Record<PaymentRecord['status'], string> = {
    PENDING: 'Pendiente', AUTHORIZED: 'Autorizado', CAPTURED: 'Cobrado',
    REFUNDED: 'Reembolsado', FAILED: 'Fallido', CANCELLED: 'Cancelado',
  };
  return (
    <span className={`ios-badge text-[10px] ${badgeCls[status] ?? 'ios-badge-gray'}`}>
      {labels[status] ?? status}
    </span>
  );
}

/* ── KPI Card Component ── */
function KPICard({ icon, iconBg, label, value, sub, delay, progress }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string | number;
  sub: string;
  delay: number;
  progress?: number;
}) {
  return (
    <GlassCard variant="ultra" delay={delay}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
      </div>
      <p className="text-[22px] font-bold tracking-tight">{value}</p>
      <p className="ios-caption font-medium mt-0.5">{label}</p>
      <p className="text-[11px] text-[var(--ios-text-tertiary)] mt-0.5">{sub}</p>
      {progress != null && (
        <div className="ios-progress mt-2">
          <div className="ios-progress-bar" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}
    </GlassCard>
  );
}
