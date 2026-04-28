import type { ReactNode } from 'react';
import { useAccessibility } from '@/context/AccessibilityContext';

/**
 * Hito 4.1.5 — Vista alternativa textual al mapa.
 *
 * Acepta los mismos datos que el mapa (posiciones, ETA, distancia, etc.)
 * y los muestra como una lista navegable por teclado / lector de pantalla.
 * Se activa automáticamente cuando profile = 'pmr', y como toggle siempre
 * disponible para cualquier usuario que prefiera no usar el mapa.
 */
export interface MapTextLocation {
  label: string;       // p.ej. "Tu posición", "Conductor", "Locker"
  latitude: number;
  longitude: number;
  meta?: ReactNode;    // ETA, descripción adicional...
}

interface MapTextAlternativeProps {
  title: string;
  locations: MapTextLocation[];
  /** Distancia en km al destino, si está calculada */
  distanceKm?: number | null;
  /** ETA en minutos, si está calculada */
  etaMinutes?: number | null;
  /** Status humano-legible del trayecto */
  statusText?: string;
  /** Forzar siempre visible (independiente del perfil) */
  alwaysVisible?: boolean;
  /** Callback cuando el usuario pide volver al mapa visual */
  onShowMap?: () => void;
}

function fmtCoord(n: number) {
  return n.toFixed(5);
}

export default function MapTextAlternative({
  title,
  locations,
  distanceKm,
  etaMinutes,
  statusText,
  alwaysVisible = false,
  onShowMap,
}: MapTextAlternativeProps) {
  const { profile } = useAccessibility();
  const shouldShow = alwaysVisible || profile === 'pmr';
  if (!shouldShow) return null;

  return (
    <section
      aria-label={`${title} (vista textual accesible)`}
      className="rounded-xl border border-border bg-card p-4 my-3"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">{title} — vista accesible</h3>
        {onShowMap && (
          <button
            type="button"
            onClick={onShowMap}
            className="text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
          >
            Ver en mapa
          </button>
        )}
      </header>

      {(distanceKm != null || etaMinutes != null || statusText) && (
        <p
          className="text-sm text-muted-foreground mb-3"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusText && <span className="font-medium text-foreground">{statusText}. </span>}
          {distanceKm != null && (
            <span>
              Distancia: {distanceKm.toFixed(2)} km.{' '}
            </span>
          )}
          {etaMinutes != null && (
            <span>Llegada estimada en {Math.max(0, Math.round(etaMinutes))} minutos.</span>
          )}
        </p>
      )}

      <ul role="list" className="space-y-2">
        {locations.map((loc, idx) => (
          <li
            key={`${loc.label}-${idx}`}
            className="rounded-md border border-border/50 bg-background px-3 py-2"
          >
            <span className="block font-medium text-sm">{loc.label}</span>
            <span className="block text-xs text-muted-foreground">
              Coordenadas: {fmtCoord(loc.latitude)}, {fmtCoord(loc.longitude)}
            </span>
            {loc.meta && (
              <span className="block text-xs text-muted-foreground mt-1">
                {loc.meta}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
