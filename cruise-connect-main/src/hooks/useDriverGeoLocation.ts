import { useEffect, useRef, useState } from "react";
import { throttle } from "@/utils/throttle";
import { socket } from "@/socket";
import { isInsideServiceArea, getRandomLasPalmasLocation } from "@/utils/geofence";

/**
 * Hook que retransmite continuamente la posición del conductor al backend vía WebSocket.
 *
 * - Si el GPS real está disponible y dentro de la zona operativa → usa GPS real
 * - Si el GPS real está fuera de la zona → marca `outsideZone = true`
 * - Si el GPS falla o no hay permisos → usa ubicación aleatoria en Las Palmas como fallback demo
 * - En demo, la posición local sigue sincronizándose al backend para que el driver
 *   aparezca como activo y reciba solicitudes en la cascada.
 *
 * @param enabled      Solo emitir cuando true (usuario es DRIVER y está logueado)
 * @param fallbackCoords  Coordenadas de fallback del usuario (de BD). Si no hay, genera random en Las Palmas.
 * @param isDemoAccount  Si es true, no emite actualizaciones al servidor (evita pisar el teletransporte).
 */
export function useDriverGeoLocation(
    enabled: boolean,
    fallbackCoords?: { lat: number; lon: number } | null,
    _isDemoAccount: boolean = false
) {
    const watchIdRef = useRef<number | null>(null);
    const randomFallbackRef = useRef<{ lat: number; lon: number } | null>(null);
    const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
    const [error, setError] = useState<boolean>(false);
    const [outsideZone, setOutsideZone] = useState<boolean>(false);
    const fallbackLat = fallbackCoords?.lat ?? null;
    const fallbackLon = fallbackCoords?.lon ?? null;

    // Generar fallback aleatorio una sola vez (persiste durante la sesión)
    const getFallback = (): [number, number] => {
        if (fallbackCoords) return [fallbackCoords.lat, fallbackCoords.lon];
        if (!randomFallbackRef.current) {
            const rnd = getRandomLasPalmasLocation();
            randomFallbackRef.current = { lat: rnd.lat, lon: rnd.lon };
        }
        return [randomFallbackRef.current.lat, randomFallbackRef.current.lon];
    };

    useEffect(() => {
        if (!enabled) return;
        const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
        let lastEmitted: { lat: number; lon: number } | null = null;

        // Hito 4.2.2 — throttle de la emision al servidor a 1 update/seg
        // (la posicion local se sigue actualizando para mantener UI suave).
        const emitToServer = throttle((lat: number, lon: number) => {
            if (socket.connected) {
                socket.emit("driver:location:update", { lat, lon });
            }
        }, 1000);
        const emit = (lat: number, lon: number) => {
            lastEmitted = { lat, lon };
            setLocation({ lat, lon });
            setOutsideZone(!isInsideServiceArea(lat, lon));
            emitToServer(lat, lon);
            window.dispatchEvent(new CustomEvent('driver:location:updated', { detail: { lat, lon } }));
        };
        const onSocketConnect = () => {
            if (lastEmitted) {
                socket.emit("driver:location:update", lastEmitted);
            }
        };

        socket.on('connect', onSocketConnect);

        if (isDemo) {
            const fb = getFallback();
            setError(false);
            setOutsideZone(false);
            emit(fb[0], fb[1]);
            return () => {
                socket.off('connect', onSocketConnect);
                emitToServer.cancel();
            };
        }

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setError(false);
                    const { latitude, longitude } = pos.coords;
                    if (isInsideServiceArea(latitude, longitude)) {
                        emit(latitude, longitude);
                    } else {
                        // GPS real pero fuera de zona → marcar fuera y usar fallback
                        setOutsideZone(true);
                        const fb = getFallback();
                        emit(fb[0], fb[1]);
                    }
                },
                () => {
                    setError(true);
                    const fb = getFallback();
                    emit(fb[0], fb[1]);
                }
            );

            watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                    setError(false);
                    const { latitude, longitude } = pos.coords;
                    if (isInsideServiceArea(latitude, longitude)) {
                        setOutsideZone(false);
                        emit(latitude, longitude);
                    } else {
                        setOutsideZone(true);
                        // No emitir posición real fuera de zona, mantener última válida
                    }
                },
                () => {
                    setError(true);
                    const fb = getFallback();
                    emit(fb[0], fb[1]);
                },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
            );
        } else {
            setError(true);
            const fb = getFallback();
            emit(fb[0], fb[1]);
        }

        return () => {
            if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
            socket.off('connect', onSocketConnect);
            emitToServer.cancel();
        };
    }, [enabled, fallbackLat, fallbackLon, _isDemoAccount]);

    return { location, error, outsideZone };
}
