import { useEffect, useRef, useState } from 'react';
import { socket } from '@/socket';

/**
 * Coordenadas del destino demo: Muelle de cruceros / Taquillas del puerto de Las Palmas.
 */
const LOCKER_DESTINATION = { lat: 28.1505, lon: -15.4145 };

/**
 * Número de waypoints (pasos) para la animación.
 * Con interval de 1.5s → ~30s de animación total.
 */
const TOTAL_STEPS = 20;
const STEP_INTERVAL_MS = 1500;

/**
 * Interpola linealmente entre dos puntos, generando `steps` waypoints.
 */
function interpolate(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  steps: number
): Array<{ lat: number; lon: number }> {
  const waypoints: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Añadir micro-variación para que el movimiento sea más realista (no una línea perfecta)
    const jitter = () => (Math.random() - 0.5) * 0.0003;
    waypoints.push({
      lat: from.lat + (to.lat - from.lat) * t + (i > 0 && i < steps ? jitter() : 0),
      lon: from.lon + (to.lon - from.lon) * t + (i > 0 && i < steps ? jitter() : 0),
    });
  }
  return waypoints;
}

interface UseDemoDriverRouteOptions {
  /** Posición actual real del driver (punto de partida base) */
  startPosition: { lat: number; lon: number } | null;
  /** Destino actual (cliente o taquillas) */
  destination: { lat: number; lon: number } | null;
  /** Activar la simulación */
  active: boolean;
}

/**
 * Hook que simula el movimiento del driver hacia un destino dinámico.
 * Con interval de 1.5s y 20 pasos → ~30s de animación total.
 */
export function useDemoDriverRoute({ startPosition, destination, active }: UseDemoDriverRouteOptions) {
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [demoPosition, setDemoPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [isDemoActive, setIsDemoActive] = useState(false);
  
  const wayPointsRef = useRef<Array<{ lat: number; lon: number }>>([]);
  const stepRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const currentDestRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    // Solo activar en demo mode y con datos válidos
    if (!isDemoMode || !active || !startPosition || !destination) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
      setIsDemoActive(false);
      currentDestRef.current = null;
      return;
    }

    // Si el destino es el mismo que el anterior, no reiniciar animación
    if (currentDestRef.current?.lat === destination.lat && currentDestRef.current?.lon === destination.lon) {
      return;
    }

    // Reiniciar animación para el nuevo destino
    if (intervalRef.current) clearInterval(intervalRef.current);
    
    currentDestRef.current = destination;
    // Partir de la última posición demo si existe, o de la posición actual
    const origin = demoPosition || startPosition;
    
    wayPointsRef.current = interpolate(origin, destination, TOTAL_STEPS);
    stepRef.current = 0;
    setIsDemoActive(true);
    setDemoPosition(origin);

    intervalRef.current = setInterval(() => {
      stepRef.current += 1;
      const wp = wayPointsRef.current[stepRef.current];

      if (!wp || stepRef.current >= TOTAL_STEPS) {
        setDemoPosition(destination);
        if (socket.connected) {
          socket.emit('driver:location:update', destination);
        }
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
        setIsDemoActive(false);
        return;
      }

      setDemoPosition(wp);
      if (socket.connected) {
        socket.emit('driver:location:update', wp);
      }
    }, STEP_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    };
  }, [isDemoMode, active, startPosition, destination]);

  return { demoPosition, isDemoActive };
}
