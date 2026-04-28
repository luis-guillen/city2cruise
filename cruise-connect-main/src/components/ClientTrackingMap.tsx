import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useState, useEffect, useRef } from 'react';
import { Navigation } from 'lucide-react';
import L from 'leaflet';
import { PickupRequest } from '@/services/api';
import GlassCard from './ios/GlassCard';
import MapTextAlternative from './MapTextAlternative';

const LOCKER_DESTINATION = { lat: 28.1505, lon: -15.4145 };

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.flyTo(center, map.getZoom(), { duration: 1.2 });
  }, [center, map]);
  return null;
}

const driverIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#007AFF,#5AC8FA);border:3px solid white;box-shadow:0 2px 12px rgba(0,122,255,0.4);display:flex;align-items:center;justify-content:center">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const lockerIcon = L.divIcon({
  className: '',
  html: `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#34C759,#30D158);border:3px solid white;box-shadow:0 2px 10px rgba(52,199,89,0.4);display:flex;align-items:center;justify-content:center">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const userIcon = L.divIcon({
  className: '',
  html: `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#FF2D55,#FF3B30);border:3px solid white;box-shadow:0 2px 10px rgba(255,45,85,0.4);display:flex;align-items:center;justify-content:center">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface ClientTrackingMapProps {
  request?: PickupRequest | null;
  driverName?: string;
  selectable?: boolean;
  onLocationSelect?: (lat: number, lon: number) => void;
  initialLat?: number;
  initialLon?: number;
}

function MapClickHandler({ onSelect }: { onSelect: (lat: number, lon: number) => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', (e) => { onSelect(e.latlng.lat, e.latlng.lng); });
    return () => { map.off('click'); };
  }, [map, onSelect]);
  return null;
}

export default function ClientTrackingMap({
  request,
  driverName,
  selectable,
  onLocationSelect,
  initialLat,
  initialLon,
}: ClientTrackingMapProps) {
  const [driverPos, setDriverPos] = useState<{ lat: number; lon: number } | null>(
    request?.driverLatitude && request?.driverLongitude
      ? { lat: request.driverLatitude, lon: request.driverLongitude }
      : null
  );

  // La ruta que dibujamos: viene del móvil vía socket, ya recortada
  const [route, setRoute] = useState<[number, number][]>([]);

  // routeTail llega en cada tick de location:update ya recortada desde el driver
  // driver:route llega una vez al inicio con la ruta completa (fallback)
  const fullRouteRef = useRef<[number, number][]>([]);

  // 1. Recibir la ruta completa cuando el driver arranca (evento driver:route)
  useEffect(() => {
    const handler = (e: Event) => {
      const { route: pts } = (e as CustomEvent).detail as {
        route: Array<{ lat: number; lon: number }>;
        requestId?: string | null;
        phase?: string | null;
      };
      if (!Array.isArray(pts) || pts.length < 2) return;
      const coords: [number, number][] = pts.map(p => [p.lat, p.lon]);
      fullRouteRef.current = coords;
      // Mostrar ruta completa hasta que llegue el primer tick de posición
      setRoute(coords);
    };
    window.addEventListener('driver:route:received', handler);
    return () => window.removeEventListener('driver:route:received', handler);
  }, []);

  // 2. Recibir posición + routeTail en cada tick (evento driver:location)
  useEffect(() => {
    const handler = (e: Event) => {
      const { lat, lon, routeTail } = (e as CustomEvent).detail as {
        lat: number;
        lon: number;
        routeTail?: Array<{ lat: number; lon: number }> | null;
      };
      if (!lat || !lon) return;

      setDriverPos({ lat, lon });

      if (Array.isArray(routeTail) && routeTail.length > 1) {
        // routeTail viene directo del móvil: ya es el tramo restante exacto
        const tail: [number, number][] = [
          [lat, lon],
          ...routeTail.map(p => [p.lat, p.lon] as [number, number]),
        ];
        setRoute(tail);
      } else if (fullRouteRef.current.length > 1) {
        // Fallback: si no hay routeTail, mostrar ruta completa guardada
        setRoute([[lat, lon], ...fullRouteRef.current.slice(1)]);
      }
    };
    window.addEventListener('driver:location:received', handler);
    return () => window.removeEventListener('driver:location:received', handler);
  }, []);

  // 3. Sincronizar posición inicial desde request (refresco de página)
  useEffect(() => {
    if (request?.driverLatitude && request?.driverLongitude) {
      setDriverPos({ lat: request.driverLatitude, lon: request.driverLongitude });
    }
  }, [request?.id, request?.driverLatitude, request?.driverLongitude]);

  // ── Modo seleccionable ──
  if (selectable) {
    return (
      <div className="h-full w-full">
        <MapContainer aria-label="Mapa de seguimiento del envío" role="application"
          center={[initialLat || 28.1413, initialLon || -15.4308]}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {onLocationSelect && <MapClickHandler onSelect={onLocationSelect} />}
          {initialLat && initialLon && <MapUpdater center={[initialLat, initialLon]} />}
          {initialLat && initialLon && (
            <Marker position={[initialLat, initialLon]} icon={lockerIcon} />
          )}
        </MapContainer>
      </div>
    );
  }

  // ── Estado de carga ──
  if (!driverPos) {
    return (
      <GlassCard variant="thin" className="py-12 text-center animate-pulse">
        <div className="w-10 h-10 rounded-full bg-[var(--ios-blue)]/10 flex items-center justify-center mx-auto mb-3">
          <Navigation className="w-5 h-5 text-[var(--ios-blue)] animate-spin" />
        </div>
        <p className="text-[13px] text-[var(--ios-text-secondary)]">Localizando conductor...</p>
      </GlassCard>
    );
  }

  const destination =
    request?.status === 'CONFIRMATION_PENDING'
      ? { lat: request?.latitude || 28.12, lon: request?.longitude || -15.43 }
      : LOCKER_DESTINATION;

  const distance = getDistanceKm(driverPos.lat, driverPos.lon, destination.lat, destination.lon);

  return (
    <div className="rounded-[20px] overflow-hidden shadow-lg shadow-black/10 animate-scale-in bg-white/50 backdrop-blur-md border border-white/20">
      {/* Header */}
      <div className="glass-ultra px-4 py-3 flex items-center justify-between border-b border-black/5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--ios-green)] animate-pulse" />
          <span className="text-[13px] font-semibold">
            {driverName || 'Conductor'}{' '}
            {request?.status === 'CONFIRMATION_PENDING'
              ? 'viniendo a por tu paquete'
              : 'llevando tu paquete al puerto'}
          </span>
        </div>
        <span className="text-[13px] font-medium text-[var(--ios-blue)]">
          {distance < 0.1 ? '¡Llegando!' : `${distance.toFixed(1)} km`}
        </span>
      </div>

      {/* Mapa */}
      <MapContainer aria-label="Mapa de seguimiento del envío" role="application"
        center={[driverPos.lat, driverPos.lon]}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: '260px', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapUpdater center={[driverPos.lat, driverPos.lon]} />

        <Marker position={[driverPos.lat, driverPos.lon]} icon={driverIcon}>
          <Popup>
            <div className="text-[13px]"><strong>{driverName || 'Conductor'}</strong></div>
          </Popup>
        </Marker>

        <Marker
          position={[destination.lat, destination.lon]}
          icon={request?.status === 'CONFIRMATION_PENDING' ? userIcon : lockerIcon}
        >
          <Popup>
            <div className="text-[13px]">
              <strong>
                {request?.status === 'CONFIRMATION_PENDING' ? 'Tu ubicación' : 'Puerto (Taquillas)'}
              </strong>
            </div>
          </Popup>
        </Marker>

      </MapContainer>

      <MapTextAlternative
        title="Seguimiento del envío"
        statusText={
          request?.status === 'CONFIRMATION_PENDING'
            ? `${driverName || 'El conductor'} viene a por tu paquete`
            : `${driverName || 'El conductor'} lleva tu paquete al puerto`
        }
        distanceKm={distance}
        locations={[
          { label: driverName || 'Conductor', latitude: driverPos.lat, longitude: driverPos.lon },
          {
            label:
              request?.status === 'CONFIRMATION_PENDING'
                ? 'Tu ubicación'
                : 'Taquillas del puerto',
            latitude: destination.lat,
            longitude: destination.lon,
          },
        ]}
      />
    </div>
  );
}
