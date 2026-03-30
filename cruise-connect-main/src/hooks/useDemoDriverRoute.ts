import { useEffect, useRef, useState } from 'react';
import { socket } from '@/socket';
import { getOSRMRoute } from '@/utils/routing';

/**
 * Número de waypoints (pasos) para la animación.
 * Queremos que la animación dure unos 20-30 segundos.
 */
const TOTAL_STEPS = 40;
const STEP_INTERVAL_MS = 1000;

/**
 * Interpola una lista de puntos (ruta real) para obtener exactamente N puntos equidistantes.
 * Esto asegura que el icono se mueva a una velocidad constante a lo largo de las calles.
 */
function interpolatePoints(path: [number, number][], steps: number): Array<{ lat: number; lon: number }> {
    if (path.length < 2) return [];
    
    // Calculamos la distancia total acumulada
    const distances: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < path.length; i++) {
        const d = Math.sqrt(Math.pow(path[i][0] - path[i-1][0], 2) + Math.pow(path[i][1] - path[i-1][1], 2));
        totalDist += d;
        distances.push(totalDist);
    }

    const result: Array<{ lat: number; lon: number }> = [];
    for (let i = 0; i <= steps; i++) {
        const targetDist = (i / steps) * totalDist;
        
        // Encontramos el segmento que contiene esta distancia
        let idx = 0;
        while (idx < distances.length - 1 && distances[idx + 1] < targetDist) {
            idx++;
        }

        const d1 = distances[idx];
        const d2 = distances[idx + 1];
        const t = (d2 === d1) ? 0 : (targetDist - d1) / (d2 - d1);

        const p1 = path[idx];
        const p2 = path[idx + 1];

        result.push({
            lat: p1[0] + (p2[0] - p1[0]) * t,
            lon: p1[1] + (p2[1] - p1[1]) * t,
        });
    }
    return result;
}

interface UseDemoDriverRouteOptions {
    startPosition: { lat: number; lon: number } | null;
    destination: { lat: number; lon: number } | null;
    active: boolean;
}

export function useDemoDriverRoute({ startPosition, destination, active }: UseDemoDriverRouteOptions) {
    const [demoPosition, setDemoPosition] = useState<{ lat: number; lon: number } | null>(null);
    const [isDemoActive, setIsDemoActive] = useState(false);

    const wayPointsRef = useRef<Array<{ lat: number; lon: number }>>([]);
    const stepRef = useRef(0);
    const intervalRef = useRef<ReturnType<typeof setInterval>>();
    const currentDestRef = useRef<{ lat: number; lon: number } | null>(null);

    useEffect(() => {
        // Limpieza si no hay datos o no está activo
        if (!active || !startPosition || !destination) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = undefined;
            }
            setIsDemoActive(false);
            currentDestRef.current = null;
            setDemoPosition(null);
            return;
        }

        // Evitar reinicios si el destino es el mismo
        if (currentDestRef.current?.lat === destination.lat && currentDestRef.current?.lon === destination.lon) {
            return;
        }

        // Obtener ruta real por calles y empezar animación
        const fetchAndStart = async () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            currentDestRef.current = destination;

            const origin = demoPosition || startPosition;
            console.log("[Simulation] Fetching street route from", origin, "to", destination);
            
            const routeCoords = await getOSRMRoute(origin, destination);
            wayPointsRef.current = interpolatePoints(routeCoords, TOTAL_STEPS);
            stepRef.current = 0;
            setIsDemoActive(true);
            setDemoPosition(wayPointsRef.current[0]);

            intervalRef.current = setInterval(() => {
                stepRef.current += 1;
                const wp = wayPointsRef.current[stepRef.current];

                if (!wp || stepRef.current >= TOTAL_STEPS) {
                    setDemoPosition(destination);
                    if (socket.connected) {
                        socket.emit('driver:location:update', { lat: destination.lat, lon: destination.lon });
                    }
                    clearInterval(intervalRef.current);
                    intervalRef.current = undefined;
                    setIsDemoActive(false);
                    return;
                }

                setDemoPosition(wp);
                if (socket.connected) {
                    socket.emit('driver:location:update', { lat: wp.lat, lon: wp.lon });
                }
            }, STEP_INTERVAL_MS);
        };

        fetchAndStart();

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [active, startPosition?.lat, startPosition?.lon, destination?.lat, destination?.lon]);

    return { demoPosition, isDemoActive };
}
