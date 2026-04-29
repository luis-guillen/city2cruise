import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { handleAcceptRequest, handleDeposit, handleRenewHandshake } from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { useDriverGeoLocation } from '@/hooks/useDriverGeoLocation';
import { useDemoDriverRoute } from '@/hooks/useDemoDriverRoute';
import IOSStatusBadge from '@/components/ios/IOSStatusBadge';
import GlassNavbar from '@/components/ios/GlassNavbar';
import GlassCard from '@/components/ios/GlassCard';
import DriverMap from '@/components/maps/LazyDriverMap';
import OutsideZoneBanner from '@/components/ios/OutsideZoneBanner';
import { NotificationSettings } from '@/components/NotificationSettings';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/utils/errors';
import {
  Navigation, MapPin, Package, Box, Archive, LogOut,
  RefreshCw, CheckCircle2, Truck, AlertTriangle, Settings
} from 'lucide-react';

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const sizeLabel = (s: string) => s === 'SMALL' ? 'Pequeño' : s === 'MEDIUM' ? 'Mediano' : 'Grande';
const SizeIcon = ({ size }: { size: string }) => {
  if (size === 'SMALL') return <Package className="w-4 h-4" />;
  if (size === 'MEDIUM') return <Box className="w-4 h-4" />;
  return <Archive className="w-4 h-4" />;
};

export default function DriverDashboard() {
  const navigate = useNavigate();
  const {
    userName, pendingRequests, driverPickups,
    setCurrentRequest, refreshData, logout, homeCoords
  } = useApp();
  const { isConnected: socketConnected } = useSocket();
  
  // Identificar si es cuenta de prueba para la demo
  const isDemoAccount = userName.toLowerCase().includes('driver') || userName.toLowerCase().includes('test');
  
  const { location, error: geoError, outsideZone } = useDriverGeoLocation(true, homeCoords, isDemoAccount);

  // Active pickup for routing
  const activePickup = driverPickups.find(p =>
    ['CONFIRMATION_PENDING', 'IN_PROGRESS'].includes(p.status)
  );

  // Demo destination: Client if phase 1, Port if phase 2
  const demoDestination = activePickup 
    ? (activePickup.status === 'CONFIRMATION_PENDING' 
        ? { lat: activePickup.latitude || 28.1413, lon: activePickup.longitude || -15.4308 }
        : { lat: 28.1505, lon: -15.4145 })
    : null;

  const { demoPosition, isDemoActive } = useDemoDriverRoute({
    startPosition: location,
    destination: demoDestination,
    active: !!activePickup,
    requestId: activePickup?.id ?? null,
    phase: activePickup?.status === 'CONFIRMATION_PENDING' || activePickup?.status === 'IN_PROGRESS'
      ? activePickup.status
      : null,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleLogout = () => { logout(); navigate('/'); };

  // Geofencing: bloquear si está fuera de zona
  if (outsideZone) {
    return <OutsideZoneBanner blocking />;
  }

  const onAccept = async (requestId: string) => {
    setIsLoading(true);
    try {
      const updated = await handleAcceptRequest(
        requestId,
        location?.lat,
        location?.lon,
        7
      );
      setCurrentRequest(updated);
      await refreshData();
      toast.success('Solicitud aceptada');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error'));
    } finally { setIsLoading(false); }
  };

  const onDeposit = async (requestId: string) => {
    setIsLoading(true);
    try {
      const updated = await handleDeposit(requestId);
      setCurrentRequest(updated);
      await refreshData();
      toast.success('Paquete depositado');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error'));
    } finally { setIsLoading(false); }
  };

  const onRenew = async (requestId: string) => {
    setIsLoading(true);
    try {
      const updated = await handleRenewHandshake(requestId);
      setCurrentRequest(updated);
      await refreshData();
      toast.success('Código renovado');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error'));
    } finally { setIsLoading(false); }
  };

  // En demo mode con animación activa, usar demoPosition como center del mapa
  const effectiveLocation = (isDemoActive && demoPosition) ? demoPosition : location;
  const mapCenter: [number, number] = effectiveLocation
    ? [effectiveLocation.lat, effectiveLocation.lon]
    : homeCoords
      ? [homeCoords.lat, homeCoords.lon]
      : [28.1235, -15.4363];

  // Usar activePickup definido arriba para la lógica de navegación

  return (
    <div className="min-h-dvh bg-[var(--ios-bg-primary)]">
      <GlassNavbar
        title="Conductor"
        subtitle={userName}
        trailing={
          <button onClick={handleLogout} className="p-2 rounded-full hover:bg-black/5 active:scale-95 transition">
            <LogOut className="w-5 h-5 text-[var(--ios-text-secondary)]" />
          </button>
        }
      />

      <div className="ios-page-notab max-w-lg mx-auto px-4">
        {/* GPS Status */}
        <GlassCard variant="default" className="mb-4 animate-slide-up" padding="sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${geoError ? 'bg-[var(--ios-orange)]/10' : 'bg-[var(--ios-blue)]/10'}`}>
                <Navigation className={`w-4.5 h-4.5 ${geoError ? 'text-[var(--ios-orange)]' : 'text-[var(--ios-blue)]'}`} />
              </div>
              <div>
                {location ? (
                  <p className="text-[14px] font-medium">
                    {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
                  </p>
                ) : (
                  <p className="text-[14px] text-[var(--ios-text-tertiary)]">Obteniendo GPS...</p>
                )}
                {geoError && !isDemoAccount && (
                  <p className="text-[12px] text-[var(--ios-orange)] flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Ubicación por defecto
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase text-[var(--ios-text-tertiary)] font-bold">GPS</span>
                <div className={`ios-dot ${location ? 'bg-[var(--ios-green)] ios-dot-pulse' : 'bg-[var(--ios-text-quaternary)]'}`} />
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase text-[var(--ios-text-tertiary)] font-bold">Live</span>
                <div className={`ios-dot ${socketConnected ? 'bg-[var(--ios-green)] ios-dot-pulse' : 'bg-[var(--ios-red)]'}`} />
              </div>
            </div>
          </div>
        </GlassCard>

        {(pendingRequests.length > 0 || activePickup) && (
          <div className="mb-4 animate-scale-in rounded-[20px] overflow-hidden shadow-lg shadow-black/10">
            <DriverMap
              center={mapCenter}
              radiusKm={3}
              pendingRequests={pendingRequests}
              onAccept={(req) => onAccept(req.id)}
              isLoading={isLoading}
              activeRequest={activePickup}
            />
          </div>
        )}

        {/* Pending Requests */}
        <div className="mb-2">
          <h2 className="ios-section-header mb-3">
            SOLICITUDES PENDIENTES ({pendingRequests.length})
          </h2>
          {pendingRequests.length === 0 ? (
            <GlassCard variant="thin" className="text-center py-8">
              <div className="ios-empty py-0">
                <Truck className="w-10 h-10" />
                <p className="ios-subtitle mt-2">Sin solicitudes pendientes</p>
                <p className="ios-caption mt-1">Las nuevas solicitudes aparecerán aquí</p>
              </div>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req, i) => (
                <GlassCard key={req.id} delay={i}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold">{req.clientName}</p>
                      <p className="ios-caption flex items-center gap-1 mt-1 truncate">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        {req.pickupLocation}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="ios-badge-gray ios-badge text-[11px] flex items-center gap-1">
                          <SizeIcon size={req.packageSize} />
                          {sizeLabel(req.packageSize)}
                        </span>
                        {location && req.latitude && req.longitude && (
                          <span className="ios-caption font-medium">
                            {getDistanceKm(location.lat, location.lon, req.latitude, req.longitude).toFixed(1)} km
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => onAccept(req.id)}
                      disabled={isLoading}
                      className="ios-btn-primary ios-btn-sm ml-3 flex-shrink-0"
                    >
                      {isLoading ? <span className="ios-spinner w-4 h-4 border-white/30 border-t-white" /> : 'Aceptar'}
                    </button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>

        {/* My Pickups */}
        {driverPickups.length > 0 && (
          <div className="mt-6">
            <h2 className="ios-section-header mb-3">MIS RECOGIDAS ({driverPickups.length})</h2>
            <div className="space-y-3">
              {driverPickups.map((pickup, i) => (
                <GlassCard key={pickup.id} variant="ultra" delay={i}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[15px] font-semibold">{pickup.clientName}</p>
                    <IOSStatusBadge status={pickup.status} size="sm" />
                  </div>

                  <p className="ios-caption flex items-center gap-1 mb-3 truncate">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    {pickup.pickupLocation}
                  </p>

                  {/* Handshake Code Display */}
                  {pickup.status === 'CONFIRMATION_PENDING' && /^\d{4}$/.test(pickup.handshakeCode ?? '') && (
                    <div className="glass rounded-[14px] p-4 text-center mb-3">
                      <p className="ios-caption mb-2">Código para el cliente</p>
                      <div className="flex justify-center gap-2">
                        {pickup.handshakeCode.split('').map((digit, di) => (
                          <span key={di} className="w-12 h-14 rounded-xl bg-[var(--ios-blue)]/10 flex items-center justify-center text-[24px] font-bold text-[var(--ios-blue)]">
                            {digit}
                          </span>
                        ))}
                      </div>
                      <p className="ios-caption mt-3 flex items-center justify-center gap-1">
                        <span className="ios-dot bg-[var(--ios-orange)] ios-dot-pulse" />
                        Esperando confirmación del cliente...
                      </p>
                      <button
                        onClick={() => onRenew(pickup.id)}
                        disabled={isLoading}
                        className="ios-btn-ghost ios-btn-sm mt-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Renovar código
                      </button>
                    </div>
                  )}

                  {/* Deposit action */}
                  {pickup.status === 'IN_PROGRESS' && (
                    <button
                      onClick={() => onDeposit(pickup.id)}
                      disabled={isLoading}
                      className="ios-btn-primary ios-btn-lg"
                      style={{ background: 'var(--ios-green)', boxShadow: '0 2px 12px rgba(52,199,89,0.3)' }}
                    >
                      {isLoading ? <span className="ios-spinner border-white/30 border-t-white" /> : (
                        <><CheckCircle2 className="w-5 h-5" /> Depositar en locker</>
                      )}
                    </button>
                  )}

                  {/* Locker info */}
                  {pickup.locker && (
                    <p className="ios-caption mt-2">
                      Locker: <strong>{pickup.locker.label}</strong>
                    </p>
                  )}
                </GlassCard>
              ))}
            </div>
          </div>
        )}
        {/* ═══ SETTINGS ═══ */}
        <GlassCard variant="default" className="mt-4 animate-slide-up">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="flex items-center justify-between w-full"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--ios-text-primary)]">
              <Settings className="w-4 h-4 text-[var(--ios-blue)]" />
              Ajustes de notificaciones
            </span>
            <span className="text-xs text-[var(--ios-text-secondary)]">
              {showSettings ? '▲' : '▼'}
            </span>
          </button>
          {showSettings && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <NotificationSettings />
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
