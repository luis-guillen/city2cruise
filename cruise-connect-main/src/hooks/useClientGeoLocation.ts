import { useEffect, useRef, useState } from "react";
import { isInsideServiceArea, getRandomLasPalmasLocation } from "@/utils/geofence";

/**
 * Hook que obtiene la ubicación del cliente y comprueba si está dentro de la zona operativa.
 *
 * - Si el GPS real está dentro de la zona → devuelve coordenadas reales
 * - Si el GPS real está fuera → marca `outsideZone = true`
 * - Si falla el GPS → usa ubicación aleatoria en Las Palmas como fallback demo
 */
export function useClientGeoLocation() {
    const randomFallbackRef = useRef<{ lat: number; lon: number; name: string } | null>(null);
    const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
    const [outsideZone, setOutsideZone] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);
    const [usingFallback, setUsingFallback] = useState<boolean>(false);

    useEffect(() => {
        const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

        if (!navigator.geolocation || isDemo) {
            // Empezar directamente con fallback en demo para asegurar dinamismo
            if (!randomFallbackRef.current) {
                randomFallbackRef.current = getRandomLasPalmasLocation();
            }
            setLocation({ lat: randomFallbackRef.current.lat, lon: randomFallbackRef.current.lon });
            setUsingFallback(true);
            setLoading(false);
            if (isDemo) return; // En demo no intentamos GPS real para asegurar consistencia con drivers
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                if (isInsideServiceArea(latitude, longitude)) {
                    setLocation({ lat: latitude, lon: longitude });
                    setOutsideZone(false);
                } else {
                    setOutsideZone(true);
                    // Guardar ubicación real pero marcar fuera de zona
                    setLocation({ lat: latitude, lon: longitude });
                }
                setLoading(false);
            },
            () => {
                // GPS denegado/error → fallback aleatorio Las Palmas
                if (!randomFallbackRef.current) {
                    randomFallbackRef.current = getRandomLasPalmasLocation();
                }
                setLocation({ lat: randomFallbackRef.current.lat, lon: randomFallbackRef.current.lon });
                setUsingFallback(true);
                setLoading(false);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
    }, []);

    return { location, outsideZone, loading, usingFallback };
}
