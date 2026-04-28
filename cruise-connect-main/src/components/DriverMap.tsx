import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import { useEffect, useState } from 'react';
import L from 'leaflet';
import type { PickupRequest } from '@/services/api';
import { Package, Box, Archive, Navigation } from 'lucide-react';
import { getOSRMRoute } from '@/utils/routing';

/** Coordenadas de las taquillas del puerto */
const LOCKER_DESTINATION = { lat: 28.1505, lon: -15.4145 };

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function deg2rad(deg: number): number { return deg * (Math.PI / 180); }

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center, map.getZoom()); }, [center, map]);
  return null;
}

const sizeLabel = (s: string) => s === 'SMALL' ? 'Pequeño' : s === 'MEDIUM' ? 'Mediano' : 'Grande';

/* Custom marker icons */
const driverIcon = L.divIcon({
  className: '',
  html: `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#007AFF,#5AC8FA);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const requestIcon = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FF9500,#FFCC00);border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
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

interface DriverMapProps {
  center: [number, number];
  radiusKm: number;
  pendingRequests: PickupRequest[];
  onAccept: (req: PickupRequest) => void;
  isLoading: boolean;
  activeRequest?: PickupRequest | null;
}

export default function DriverMap({ center, radiusKm, pendingRequests, onAccept, isLoading, activeRequest }: DriverMapProps) {
  const [route, setRoute] = useState<[number, number][]>([]);

  useEffect(() => {
    if (!activeRequest) {
      setRoute([]);
      return;
    }

    const driverPos = { lat: center[0], lon: center[1] };
    const destination = activeRequest.status === 'CONFIRMATION_PENDING'
      ? { lat: activeRequest.latitude || 28.12, lon: activeRequest.longitude || -15.43 }
      : LOCKER_DESTINATION;

    getOSRMRoute(driverPos, destination).then(setRoute);
  }, [center, activeRequest?.status, activeRequest?.latitude, activeRequest?.longitude]);

  return (
    <MapContainer aria-label="Mapa de solicitudes y ruta del conductor" role="application"
      center={center}
      zoom={14}
      scrollWheelZoom
      style={{ height: '320px', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapUpdater center={center} />

      {/* Driver marker */}
      <Marker position={center} icon={driverIcon}>
        <Popup>
          <div style={{ fontFamily: '-apple-system, Inter, sans-serif', fontSize: 14 }}>
            <strong>Tu ubicación</strong>
          </div>
        </Popup>
      </Marker>

      {/* Radius (solo si no hay pedido activo) */}
      {!activeRequest && (
        <Circle
          center={center}
          radius={radiusKm * 1000}
          pathOptions={{
            color: '#007AFF',
            fillColor: '#007AFF',
            fillOpacity: 0.06,
            weight: 1.5,
            dashArray: '6,4',
          }}
        />
      )}

      {/* Active Request Destination and Route */}
      {activeRequest && (
        <>
          <Marker
            position={activeRequest.status === 'CONFIRMATION_PENDING' 
              ? [activeRequest.latitude || 28.12, activeRequest.longitude || -15.43]
              : [LOCKER_DESTINATION.lat, LOCKER_DESTINATION.lon]
            }
            icon={activeRequest.status === 'CONFIRMATION_PENDING' ? userIcon : lockerIcon}
          >
            <Popup>
              <div className="text-[13px]">
                <strong>{activeRequest.status === 'CONFIRMATION_PENDING' ? 'Recogida: ' + activeRequest.clientName : 'Destino: Puerto'}</strong>
              </div>
            </Popup>
          </Marker>

          {route.length > 0 ? (
            <Polyline
              positions={route}
              pathOptions={{
                color: '#007AFF',
                weight: 5,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
          ) : (
             <Polyline
              positions={[center, activeRequest.status === 'CONFIRMATION_PENDING' 
                ? [activeRequest.latitude || 28.12, activeRequest.longitude || -15.43]
                : [LOCKER_DESTINATION.lat, LOCKER_DESTINATION.lon]
              ]}
              pathOptions={{ color: '#007AFF', weight: 3, dashArray: '8,6', opacity: 0.5 }}
            />
          )}
        </>
      )}

      {/* Pending Request markers */}
      {!activeRequest && pendingRequests.filter(r => r.latitude && r.longitude).map((req) => {
        const dist = getDistanceFromLatLonInKm(center[0], center[1], req.latitude!, req.longitude!);
        return (
          <Marker key={req.id} position={[req.latitude!, req.longitude!]} icon={requestIcon}>
            <Popup>
              <div style={{ fontFamily: '-apple-system, Inter, sans-serif', fontSize: 13, minWidth: 180 }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{req.pickupLocation}</p>
                <p style={{ color: '#8E8E93', marginBottom: 4 }}>
                  {dist.toFixed(2)} km &middot; {sizeLabel(req.packageSize)}
                </p>
                <button
                  onClick={() => onAccept(req)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '8px 0',
                    background: '#007AFF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  {isLoading ? 'Cargando...' : 'Aceptar'}
                </button>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
