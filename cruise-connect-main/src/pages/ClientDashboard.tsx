import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import {
  handleCreateRequest, handleOpenLockerWithChallenge, handleConfirmDriverWithChallenge,
  searchLocations, getClientHistory, PickupRequest
} from '@/services/api';
import { useSocket } from '@/hooks/useSocket';
import { useClientGeoLocation } from '@/hooks/useClientGeoLocation';
import IOSStatusBadge from '@/components/ios/IOSStatusBadge';
import GlassNavbar from '@/components/ios/GlassNavbar';
import GlassCard from '@/components/ios/GlassCard';
import GlassInput from '@/components/ios/GlassInput';
import GlassSegmented from '@/components/ios/GlassSegmented';
import IOSNotificationBell from '@/components/ios/IOSNotificationBell';
import OutsideZoneBanner from '@/components/ios/OutsideZoneBanner';
import ClientTrackingMap from '@/components/maps/LazyClientTrackingMap';
import StripeCheckout from '@/components/StripeCheckout';
import { NotificationSettings } from '@/components/NotificationSettings';
import { toast } from 'sonner';
import {
  Package, MapPin, ShieldCheck, Lock, PackageCheck,
  Search, Archive, Box, LogOut, Clock, ChevronRight,
  AlertTriangle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '@/utils/errors';
import { createAndSignCustodyChallenge, signExistingCustodyChallenge } from '@/services/custodyClient';

const PACKAGE_OPTIONS = [
  { id: 'SMALL' as const, label: 'Pequeño', icon: Package, desc: 'Bolsas, souvenirs' },
  { id: 'MEDIUM' as const, label: 'Mediano', icon: Box, desc: 'Cajas medianas' },
  { id: 'LARGE' as const, label: 'Grande', icon: Archive, desc: 'Equipaje, grandes' },
];

const STATUS_STEPS = [
  { key: 'REQUESTED', label: 'Solicitado', icon: '1' },
  { key: 'CONFIRMATION_PENDING', label: 'Encuentro', icon: '2' },
  { key: 'IN_PROGRESS', label: 'Traslado', icon: '3' },
  { key: 'DEPOSITED', label: 'En locker', icon: '4' },
  { key: 'PICKED_UP', label: 'Recogido', icon: '5' },
];

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.findIndex(s => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default function ClientDashboard() {
  const navigate = useNavigate();
  const { userId, userName, currentRequest, setCurrentRequest, logout, refreshData } = useApp();
  useSocket();
  const { outsideZone, loading: geoLoading } = useClientGeoLocation();

  const [activeTab, setActiveTab] = useState<'current' | 'history' | 'settings'>('current');
  const [history, setHistory] = useState<PickupRequest[]>([]);

  // Request form
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ displayName: string; lat: number; lon: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ displayName: string; lat: number; lon: number } | null>(null);
  const [packageSize, setPackageSize] = useState<'SMALL' | 'MEDIUM' | 'LARGE'>('SMALL');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Confirmation
  const [handshakeCodeInput, setHandshakeCodeInput] = useState('');
  const [lockerCode, setLockerCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [showOpenConfirm, setShowOpenConfirm] = useState(false);

  // Payment flow: null = not started, 'pending' = showing checkout
  const [paymentStep, setPaymentStep] = useState<'idle' | 'checkout'>('idle');
  const [pendingRequestId, setPendingRequestId] = useState<number | null>(null);

  // Auto-location logic
  const { location: gpsLocation } = useClientGeoLocation();
  const [hasAutoLocated, setHasAutoLocated] = useState(false);

  useEffect(() => {
    // Caso 1: Auto-ubicar por primera vez
    if (!geoLoading && gpsLocation && !selectedLocation && !hasAutoLocated && !currentRequest) {
      setSelectedLocation({
        displayName: 'Ubicación actual (GPS)',
        lat: gpsLocation.lat,
        lon: gpsLocation.lon
      });
      setHasAutoLocated(true);
    }
    
    // Caso 2: El GPS ha cambiado y el usuario tiene seleccionada la "Ubicación actual"
    // Esto es crítico para el Modo Demo donde el GPS es dinámico
    if (gpsLocation && selectedLocation?.displayName === 'Ubicación actual (GPS)') {
      if (gpsLocation.lat !== selectedLocation.lat || gpsLocation.lon !== selectedLocation.lon) {
        setSelectedLocation({
          displayName: 'Ubicación actual (GPS)',
          lat: gpsLocation.lat,
          lon: gpsLocation.lon
        });
      }
    }
  }, [geoLoading, gpsLocation, selectedLocation, hasAutoLocated, currentRequest]);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const status = currentRequest?.status;
  const showForm = !currentRequest || status === 'PICKED_UP';

  // Locker ready event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.lockerCode) {
        setLockerCode(detail.lockerCode);
      }
      refreshData();
    };
    window.addEventListener('locker:ready:received', handler);
    return () => window.removeEventListener('locker:ready:received', handler);
  }, [refreshData]);

  // Sincronizar código de locker si ya existe en el pedido (ej: tras recargar)
  useEffect(() => {
    if (currentRequest?.lockerCode && !lockerCode) {
      setLockerCode(currentRequest.lockerCode);
    }
  }, [currentRequest?.lockerCode, lockerCode]);

  // Load history
  useEffect(() => {
    if (activeTab === 'history') {
      getClientHistory().then(setHistory).catch(() => {});
    }
  }, [activeTab]);

  // Debounced search
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setSelectedLocation(null);
    clearTimeout(searchTimeout.current);
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchLocations(q);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch { setSuggestions([]); }
      finally { setIsSearching(false); }
    }, 600);
  };

  const selectLocation = (loc: { displayName: string; lat: number; lon: number }) => {
    setSelectedLocation(loc);
    setSearchQuery(loc.displayName === 'Ubicación actual (GPS)' ? 'Ubicación actual' : loc.displayName);
    setShowSuggestions(false);
  };

  // Step 1: create the request in REQUESTED state → then show checkout
  const onInitiateRequest = async () => {
    if (!selectedLocation) { toast.error('Selecciona una ubicación'); return; }
    setIsLoading(true);
    try {
      const req = await handleCreateRequest(
        selectedLocation.displayName,
        selectedLocation.lat,
        selectedLocation.lon,
        packageSize,
      );
      setCurrentRequest(req);
      setPendingRequestId(req.id);
      setPaymentStep('checkout');
      setSearchQuery('');
      setSelectedLocation(null);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al crear solicitud'));
    } finally { setIsLoading(false); }
  };

  // Step 2: payment authorized → cascade search already running
  const onPaymentSuccess = () => {
    setPaymentStep('idle');
    setPendingRequestId(null);
    toast.success('Pago autorizado — buscando conductor...');
    refreshData();
  };

  // Step 2b: user cancelled checkout → we keep the request but surface error
  const onPaymentCancel = () => {
    setPaymentStep('idle');
    setPendingRequestId(null);
    toast('Pago cancelado. Puedes intentarlo de nuevo.');
    refreshData();
  };

  const onConfirmDriver = async () => {
    if (!currentRequest || handshakeCodeInput.length !== 4) return;
    setIsLoading(true);
    try {
      if (!userId) throw new Error('Usuario no disponible');
      const baseChallenge = currentRequest.custodyChallenge
        ?? await createAndSignCustodyChallenge(userId, Number(currentRequest.id), 'HANDSHAKE_VALIDATED');
      const signedChallenge = await signExistingCustodyChallenge(userId, baseChallenge);
      const updated = await handleConfirmDriverWithChallenge(currentRequest.id, handshakeCodeInput, signedChallenge.id);
      setCurrentRequest(updated);
      setHandshakeCodeInput('');
      toast.success('Encuentro confirmado');
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Código incorrecto'));
    } finally { setIsLoading(false); }
  };

  const onOpenLocker = async () => {
    const codeToUse = lockerCode || currentRequest?.lockerCode;
    if (!codeToUse || codeToUse.length < 1) {
      toast.error('Código no disponible');
      return;
    }
    setIsLoading(true);
    try {
      if (!userId || !currentRequest) throw new Error('Usuario no disponible');
      const challenge = await createAndSignCustodyChallenge(userId, Number(currentRequest.id), 'PICKED_UP');
      const updated = await handleOpenLockerWithChallenge(codeToUse, challenge.id);
      if (updated && updated.status) {
        setCurrentRequest(updated);
        setLockerCode('');
        setShowOpenConfirm(false);
        toast.success('Locker abierto');
      } else {
        throw new Error('Respuesta del servidor incompleta');
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al abrir'));
    } finally { setIsLoading(false); }
  };

  const handleLogout = () => { logout(); navigate('/'); };

  // Geofencing: bloquear si está fuera de zona
  if (!geoLoading && outsideZone) {
    return <OutsideZoneBanner blocking />;
  }

  return (
    <div className="min-h-dvh bg-[var(--ios-bg-primary)]">
      {/* Navbar */}
      <GlassNavbar
        title="City2Cruise"
        leading={<IOSNotificationBell />}
        trailing={
          <button onClick={handleLogout} className="p-2 rounded-full hover:bg-black/5 active:scale-95 transition">
            <LogOut className="w-5 h-5 text-[var(--ios-text-secondary)]" />
          </button>
        }
      />

      <div className="ios-page-notab max-w-lg mx-auto px-4">
        {/* Welcome */}
        <div className="mb-4 animate-slide-up">
          <h1 className="ios-title-large">Hola, {userName}</h1>
          <p className="ios-subtitle mt-1">Gestiona tus envíos portuarios</p>
        </div>

        {/* Segmented */}
        <GlassSegmented
          items={[
            { id: 'current', label: 'Actual' },
            { id: 'history', label: 'Historial' },
            { id: 'settings', label: 'Ajustes' },
          ]}
          active={activeTab}
          onChange={(id) => setActiveTab(id as 'current' | 'history' | 'settings')}
          className="mb-5"
        />

        {/* ═══ CURRENT TAB ═══ */}
        {activeTab === 'current' && (
          <div className="space-y-4">
            {/* ── NEW REQUEST FORM ── */}
            {showForm && (
              <GlassCard variant="ultra" delay={1}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--ios-blue)]/10 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-[var(--ios-blue)]" />
                  </div>
                  <div>
                    <h2 className="ios-title">Nueva solicitud</h2>
                    <p className="ios-caption">Indica recogida y tamaño</p>
                  </div>
                </div>

                {/* Location Search */}
                <div className="relative mb-3">
                  <GlassInput
                    icon={<Search className="w-5 h-5" />}
                    placeholder="Buscar ubicación de recogida..."
                    value={searchQuery || (selectedLocation?.displayName === 'Ubicación actual (GPS)' ? 'Ubicación actual' : '')}
                    onChange={(e) => handleSearch(e.target.value)}
                    onFocus={() => {
                        if (suggestions.length > 0) setShowSuggestions(true);
                        if (selectedLocation?.displayName === 'Ubicación actual (GPS)') setSearchQuery('');
                    }}
                  />
                  {!searchQuery && selectedLocation?.displayName === 'Ubicación actual (GPS)' && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                       <span className="text-[12px] text-[var(--ios-blue)] font-medium">GPS</span>
                       <div className="w-2 h-2 rounded-full bg-[var(--ios-blue)] animate-pulse" />
                    </div>
                  )}
                  {isSearching && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <span className="ios-spinner w-4 h-4" />
                    </div>
                  )}
                  {showSuggestions && (
                    <div className="absolute z-30 left-0 right-0 top-[calc(100%+4px)] glass-ultra rounded-[14px] overflow-hidden shadow-lg shadow-black/10 animate-slide-down max-h-[200px] overflow-y-auto">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => selectLocation(s)}
                          className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-black/[0.03] active:bg-black/[0.06] transition"
                        >
                          <MapPin className="w-4 h-4 text-[var(--ios-blue)] flex-shrink-0" />
                          <span className="text-[14px] leading-tight line-clamp-2">{s.displayName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Map Picker Toggle */}
                <button
                  onClick={() => setShowMapPicker(!showMapPicker)}
                  className="flex items-center gap-2 text-[13px] text-[var(--ios-blue)] font-medium px-1 mb-4 hover:opacity-70 transition"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  {showMapPicker ? 'Cerrar mapa' : 'Seleccionar pin en el mapa'}
                </button>
                
                {showMapPicker && (
                  <div className="w-full h-56 rounded-[14px] overflow-hidden border border-black/5 mb-4 animate-scale-in">
                    <ClientTrackingMap
                      selectable
                      onLocationSelect={(lat, lon) => {
                        setSelectedLocation({ displayName: `Punto en el mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})`, lat, lon });
                        setSearchQuery(`Punto en el mapa (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
                        setShowSuggestions(false);
                      }}
                      initialLat={selectedLocation?.lat}
                      initialLon={selectedLocation?.lon}
                    />
                  </div>
                )}

                {/* Package Size */}
                <label className="ios-caption font-medium pl-1 mb-2 block">Tamaño del paquete</label>
                <div className="grid grid-cols-3 gap-2 mb-5">
                  {PACKAGE_OPTIONS.map(({ id, label, icon: Icon, desc }) => (
                    <button
                      key={id}
                      onClick={() => setPackageSize(id)}
                      className={`
                        flex flex-col items-center gap-1.5 p-3 rounded-[14px] transition-all duration-200
                        ${packageSize === id
                          ? 'glass-thick ring-2 ring-[var(--ios-blue)]/20 scale-[1.02]'
                          : 'bg-black/[0.03] hover:bg-black/[0.05]'
                        }
                      `}
                    >
                      <Icon className={`w-5 h-5 ${packageSize === id ? 'text-[var(--ios-blue)]' : 'text-[var(--ios-text-tertiary)]'}`} />
                      <span className={`text-[13px] font-semibold ${packageSize === id ? 'text-[var(--ios-blue)]' : 'text-[var(--ios-text-secondary)]'}`}>{label}</span>
                      <span className="text-[11px] text-[var(--ios-text-tertiary)]">{desc}</span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={onInitiateRequest}
                  disabled={!selectedLocation || isLoading}
                  className="ios-btn-primary ios-btn-lg"
                >
                  {isLoading ? <span className="ios-spinner border-white/30 border-t-white" /> : 'Continuar al pago →'}
                </button>
              </GlassCard>
            )}

            {/* ── STRIPE CHECKOUT ── */}
            {paymentStep === 'checkout' && pendingRequestId && (
              <StripeCheckout
                requestId={pendingRequestId}
                packageSize={packageSize}
                onSuccess={onPaymentSuccess}
                onCancel={onPaymentCancel}
              />
            )}

            {/* ── ACTIVE REQUEST ── */}
            {currentRequest && status !== 'PICKED_UP' && paymentStep === 'idle' && (
              <>
                {/* Status Card */}
                <GlassCard variant="ultra" delay={1}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="ios-caption">Solicitud activa</p>
                      <h2 className="ios-title">{currentRequest.pickupLocation}</h2>
                    </div>
                    <IOSStatusBadge status={status!} />
                  </div>

                  {/* Progress Steps */}
                  <div className="flex items-center gap-1 mb-2">
                    {STATUS_STEPS.map((step, i) => {
                      const active = i <= getStepIndex(status!);
                      return (
                        <div key={step.key} className="flex-1 flex flex-col items-center gap-1.5">
                          <div className={`
                            w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-all duration-500
                            ${active
                              ? 'bg-[var(--ios-blue)] text-white shadow-sm shadow-blue-500/30'
                              : 'bg-black/[0.06] text-[var(--ios-text-tertiary)]'
                            }
                          `}>
                            {step.icon}
                          </div>
                          <span className={`text-[10px] font-medium text-center leading-tight ${active ? 'text-[var(--ios-blue)]' : 'text-[var(--ios-text-tertiary)]'}`}>
                            {step.label}
                          </span>
                          {i < STATUS_STEPS.length - 1 && (
                            <div className={`absolute h-0.5 ${active ? 'bg-[var(--ios-blue)]' : 'bg-black/[0.06]'}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="ios-progress mt-3">
                    <div
                      className="ios-progress-bar"
                      style={{ width: `${((getStepIndex(status!) + 1) / STATUS_STEPS.length) * 100}%` }}
                    />
                  </div>
                </GlassCard>

                {currentRequest.custodySummary && (
                  <GlassCard variant="default" delay={1}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--ios-blue)]/10 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-[var(--ios-blue)]" />
                      </div>
                      <div>
                        <h3 className="ios-title">Recibo digital</h3>
                        <p className="ios-caption">{currentRequest.custodySummary.storageMode}</p>
                      </div>
                    </div>
                    <p className="font-mono text-[11px] text-[var(--ios-text-tertiary)] break-all">
                      {currentRequest.custodySummary.blockHash}
                    </p>
                    <p className="ios-caption mt-2">
                      Bloque #{currentRequest.custodySummary.ledgerHeight} · Quórum {currentRequest.custodySummary.quorumProof.map((vote) => vote.validatorId).join(', ')}
                    </p>
                  </GlassCard>
                )}

                {/* ── SEARCHING ANIMATION ── */}
                {status === 'REQUESTED' && (
                  <GlassCard variant="ultra" className="py-8" delay={1}>
                    <div className="flex flex-col items-center justify-center text-center space-y-4">
                      <div className="relative">
                        <div className="absolute inset-0 bg-[var(--ios-blue)] opacity-20 rounded-full animate-ping-slow" />
                        <div className="relative w-16 h-16 rounded-full bg-[var(--ios-blue)]/10 flex items-center justify-center border border-[var(--ios-blue)]/20 shadow-lg shadow-blue-500/10">
                          <Search className="w-8 h-8 text-[var(--ios-blue)] animate-pulse-slow" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <h2 className="ios-title text-[17px]">Estamos buscando un driver para ti...</h2>
                        <p className="ios-caption px-4">
                          Analizando conductores disponibles en tu radio de servicio.
                        </p>
                      </div>

                      <div className="w-full max-w-[120px] h-[4px] bg-black/[0.05] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--ios-blue)] rounded-full w-1/3 animate-progress-indefinite" />
                      </div>
                    </div>
                  </GlassCard>
                )}

                {/* ── DRIVER TRACKING MAP ── */}
                {(status === 'CONFIRMATION_PENDING' || status === 'IN_PROGRESS') && (
                  <ClientTrackingMap request={currentRequest} driverName={currentRequest.driver?.name} />
                )}

                {/* ── HANDSHAKE CONFIRMATION ── */}
                {status === 'CONFIRMATION_PENDING' && (
                  <GlassCard variant="thick" delay={2}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[var(--ios-purple)]/10 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-[var(--ios-purple)]" />
                      </div>
                      <div>
                        <h3 className="ios-title">Paso de seguridad</h3>
                        <p className="ios-caption">Introduce el código del conductor</p>
                      </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`
                            flex-1 h-14 rounded-[12px] flex items-center justify-center text-[24px] font-bold tracking-widest
                            ${handshakeCodeInput[i]
                              ? 'glass-thick text-[var(--ios-blue)]'
                              : 'bg-black/[0.04] text-[var(--ios-text-quaternary)]'
                            }
                          `}
                        >
                          {handshakeCodeInput[i] || '-'}
                        </div>
                      ))}
                    </div>

                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={handshakeCodeInput}
                      onChange={(e) => setHandshakeCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="ios-input text-center text-[20px] tracking-[0.3em] font-semibold mb-4"
                      placeholder="0000"
                    />

                    <button
                      onClick={onConfirmDriver}
                      disabled={handshakeCodeInput.length !== 4 || isLoading}
                      className="ios-btn-primary ios-btn-lg"
                    >
                      {isLoading ? <span className="ios-spinner border-white/30 border-t-white" /> : (
                        <>Confirmar encuentro <ChevronRight className="w-5 h-5" /></>
                      )}
                    </button>

                    {currentRequest.clientConfirmed && (
                      <p className="ios-caption text-center mt-3 text-[var(--ios-green)]">
                        Ya has confirmado. Esperando al conductor...
                      </p>
                    )}
                  </GlassCard>
                )}

                {/* ── OPEN LOCKER ── */}
                {status === 'DEPOSITED' && (
                  <GlassCard variant="thick" delay={2} className="relative overflow-hidden">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-[var(--ios-green)]/10 flex items-center justify-center">
                        <Lock className="w-5 h-5 text-[var(--ios-green)]" />
                      </div>
                      <div>
                        <h3 className="ios-title">Tu paquete está listo</h3>
                        <p className="ios-caption">
                          Depositado en locker <strong>{currentRequest.locker?.label || '—'}</strong>
                        </p>
                      </div>
                    </div>

                    {!showOpenConfirm ? (
                      <>
                        <div className="bg-black/[0.03] rounded-[14px] p-4 mb-6 border border-black/5">
                          <p className="text-[13px] text-[var(--ios-text-secondary)] leading-tight text-center">
                            Usa este código en el panel de la taquilla <strong>{currentRequest.locker?.label}</strong>
                          </p>
                        </div>

                        <div className="flex justify-center gap-2 mb-8 mt-2">
                          {(lockerCode || '------').split('').map((char, i) => (
                            <div 
                              key={i} 
                              className="w-10 h-14 bg-black/5 rounded-xl border border-black/10 flex items-center justify-center text-[22px] font-bold text-[var(--ios-text-primary)] animate-scale-in"
                              style={{ animationDelay: `${i * 50}ms`, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}
                            >
                              {char}
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => setShowOpenConfirm(true)}
                          disabled={!lockerCode || isLoading}
                          className="ios-btn-primary ios-btn-lg mt-4"
                          style={{ background: 'var(--ios-green)', boxShadow: '0 4px 14px rgba(52,199,89,0.3)' }}
                        >
                          {isLoading ? <span className="ios-spinner border-white/30 border-t-white" /> : 'Siguiente'}
                        </button>
                      </>
                    ) : (
                      <div className="animate-scale-in">
                        <div className="bg-[var(--ios-orange)]/10 rounded-[14px] p-4 mb-5 border border-[var(--ios-orange)]/20">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-[var(--ios-orange)] flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[14px] font-semibold text-[var(--ios-orange)] mb-1">Aviso de seguridad</p>
                              <p className="text-[12px] text-[var(--ios-text-secondary)] leading-tight">
                                Una vez abierta, el envío se considera <strong>finalizado</strong>. <br/>¿Estás delante de la taquilla?
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-3">
                           <button
                             onClick={() => setShowOpenConfirm(false)}
                             className="flex-1 ios-btn-ghost bg-black/5"
                           >
                             Cancelar
                           </button>
                           <button
                             onClick={onOpenLocker}
                             disabled={isLoading}
                             className="flex-[2] ios-btn-primary"
                             style={{ background: 'var(--ios-green)' }}
                           >
                             Sí, abrir ahora
                           </button>
                        </div>
                      </div>
                    )}

                    <p className="ios-caption text-center mt-3">
                      Revisa tus notificaciones para el código
                    </p>
                  </GlassCard>
                )}
              </>
            )}

            {/* ── COMPLETION ── */}
            {currentRequest && status === 'PICKED_UP' && (
              <GlassCard variant="ultra" className="text-center" delay={1}>
                <div className="w-16 h-16 rounded-full bg-[var(--ios-green)]/10 flex items-center justify-center mx-auto mb-4 animate-bounce-in">
                  <PackageCheck className="w-8 h-8 text-[var(--ios-green)]" />
                </div>
                <h2 className="text-[22px] font-bold mb-1">Completado</h2>
                <p className="ios-subtitle mb-5">Tu paquete ha sido recogido con éxito</p>
                <button
                  onClick={() => { setCurrentRequest(null); setActiveTab('current'); }}
                  className="ios-btn-primary ios-btn-lg"
                >
                  Nueva solicitud
                </button>
              </GlassCard>
            )}
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="ios-empty">
                <Clock className="w-12 h-12" />
                <p className="ios-subtitle mt-2">Sin historial todavía</p>
              </div>
            ) : (
              history.map((req, i) => (
                <GlassCard key={req.id} variant="default" delay={i}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <IOSStatusBadge status={req.status} size="sm" />
                        <span className="ios-caption">
                          {new Date(req.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[15px] font-medium truncate">{req.pickupLocation}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="ios-caption flex items-center gap-1">
                          <Package className="w-3.5 h-3.5" />
                          {req.packageSize === 'SMALL' ? 'Pequeño' : req.packageSize === 'MEDIUM' ? 'Mediano' : 'Grande'}
                        </span>
                        {req.locker && (
                          <span className="ios-caption flex items-center gap-1">
                            <Lock className="w-3.5 h-3.5" />
                            {req.locker.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              ))
            )}
          </div>
        )}
        {/* ═══ SETTINGS TAB ═══ */}
        {activeTab === 'settings' && (
          <GlassCard variant="default">
            <NotificationSettings />
          </GlassCard>
        )}
      </div>
    </div>
  );
}
