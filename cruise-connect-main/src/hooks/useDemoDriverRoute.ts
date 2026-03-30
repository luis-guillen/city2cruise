import { useEffect, useRef, useState } from 'react';
import { socket } from '@/socket';
import { getOSRMRoute } from '@/utils/routing';

const TOTAL_STEPS = 40;
const STEP_INTERVAL_MS = 1000;

function interpolatePoints(
    path: [number, number][],
    steps: number
): Array<{ lat: number; lon: number }> {
    if (path.length < 2) return [];

    const distances: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < path.length; i++) {
        const d = Math.sqrt(
            Math.pow(path[i][0] - path[i - 1][0], 2) +
            Math.pow(path[i][1] - path[i - 1][1], 2)
        );
        totalDist += d;
        distances.push(totalDist);
    }

    const result: Array<{ lat: number; lon: number }> = [];
    for (let i = 0; i <= steps; i++) {
        const targetDist = (i / steps) * totalDist;
        let idx = 0;
        while (idx < distances.length - 1 && distances[idx + 1] < targetDist) idx++;

        const d1 = distances[idx];
        const d2 = distances[idx + 1] ?? d1;
        const t = d2 === d1 ? 0 : (targetDist - d1) / (d2 - d1);
        const p1 = path[idx];
        const p2 = path[idx + 1] ?? p1;

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
    requestId: string | null;
    phase: 'CONFIRMATION_PENDING' | 'IN_PROGRESS' | null;
}

export function useDemoDriverRoute({
    startPosition,
    destination,
    active,
    requestId,
    phase,
}: UseDemoDriverRouteOptions) {
    const [demoPosition, setDemoPosition] = useState<{ lat: number; lon: number } | null>(null);
    const [isDemoActive, setIsDemoActive] = useState(false);

    const wayPointsRef = useRef<Array<{ lat: number; lon: number }>>([]);
    const rawRouteRef = useRef<Array<{ lat: number; lon: number }>>([]);  // ruta OSRM sin interpolar
    const stepRef = useRef(0);
    const intervalRef = useRef<ReturnType<typeof setInterval>>();
    const currentDestRef = useRef<{ lat: number; lon: number } | null>(null);
    const demoPositionRef = useRef<{ lat: number; lon: number } | null>(null);

    useEffect(() => {
        demoPositionRef.current = demoPosition;
    }, [demoPosition]);

    useEffect(() => {
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

        if (
            currentDestRef.current?.lat === destination.lat &&
            currentDestRef.current?.lon === destination.lon
        ) {
            return;
        }

        const fetchAndStart = async (retryCount = 0) => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            currentDestRef.current = destination;

            const origin = demoPositionRef.current || startPosition;

            try {
                const routeCoords = await getOSRMRoute(origin, destination);

                if (
                    routeCoords.length <= 2 &&
                    retryCount < 2 &&
                    Math.abs(origin.lat - destination.lat) > 0.001
                ) {
                    console.warn(`[Simulation] OSRM straight line, retrying... (${retryCount + 1})`);
                    setTimeout(() => fetchAndStart(retryCount + 1), 600);
                    return;
                }

                // Guardar ruta cruda (para el PC) y la interpolada (para mover el icono)
                rawRouteRef.current = routeCoords.map(([lat, lon]) => ({ lat, lon }));
                wayPointsRef.current = interpolatePoints(routeCoords, TOTAL_STEPS);
                stepRef.current = 0;

                // ── Emitir la ruta completa al PC una sola vez ──
                if (socket.connected) {
                    socket.emit('driver:route:update', {
                        route: rawRouteRef.current,
                        requestId: requestId ?? null,
                        phase: phase ?? null,
                    });
                }

                setIsDemoActive(true);
                setDemoPosition(wayPointsRef.current[0]);

                intervalRef.current = setInterval(() => {
                    stepRef.current += 1;
                    const wp = wayPointsRef.current[stepRef.current];

                    if (!wp || stepRef.current >= TOTAL_STEPS) {
                        setDemoPosition(destination);
                        if (socket.connected) {
                            socket.emit('driver:location:update', {
                                lat: destination.lat,
                                lon: destination.lon,
                                routeProgress: 1,
                                routeTail: [],
                            });
                        }
                        clearInterval(intervalRef.current);
                        intervalRef.current = undefined;
                        setIsDemoActive(false);
                        return;
                    }

                    setDemoPosition(wp);

                    if (socket.connected) {
                        // Emitir posición + índice actual para que el PC recorte la línea
                        socket.emit('driver:location:update', {
                            lat: wp.lat,
                            lon: wp.lon,
                            routeProgress: stepRef.current / TOTAL_STEPS,
                            // routeTail: puntos restantes de la ruta cruda desde la pos actual
                            routeTail: rawRouteRef.current.slice(
                                Math.floor((stepRef.current / TOTAL_STEPS) * rawRouteRef.current.length)
                            ),
                        });
                    }
                }, STEP_INTERVAL_MS);
            } catch (err) {
                console.error('[Simulation] Error starting route:', err);
            }
        };

        fetchAndStart();

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [active, startPosition?.lat, startPosition?.lon, destination?.lat, destination?.lon]);

    return { demoPosition, isDemoActive };
}