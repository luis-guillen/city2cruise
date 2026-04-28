/**
 * Hito 6.5.2 — Validación robustez del pipeline de telemetría.
 *
 * Inyecta datos sintéticos:
 *   - GPS jitter (ruido gaussiano)
 *   - Outliers extremos (jumps de cientos de metros)
 *   - Packet loss (>10% drops)
 *   - Stale timestamps fuera de orden
 *
 * Verifica que el filtro Kalman:
 *   - No diverge ante outliers
 *   - Mantiene la trayectoria estimada cerca del ground truth
 *   - Recupera la estructura correcta tras packet loss
 */
import { GpsKalmanFilter, GpsPoint } from '../services/telemetry/KalmanFilter';

function gaussianNoise(sigma: number): number {
    // Box-Muller
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6_371_000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe('Hito 6.5.2 — Pipeline telemetría: robustez', () => {
    describe('Kalman filter ante GPS jitter', () => {
        it('reduce ruido vs raw para una trayectoria recta a velocidad constante', () => {
            const kf = new GpsKalmanFilter();
            const trueLatStart = 28.123;
            const trueLonStart = -15.436;
            const speedMs = 10;  // 10 m/s ~ 36 km/h
            const totalSec = 60;
            let rawDeviationSum = 0;
            let smoothedDeviationSum = 0;

            for (let t = 0; t < totalSec; t++) {
                // Trayectoria GT: avanza ~10m/s al norte (lat sube)
                const trueLat = trueLatStart + (speedMs * t) / 111139;
                const trueLon = trueLonStart;

                // Ruido GPS sigma 8m
                const noiseLat = gaussianNoise(8 / 111139);
                const noiseLon = gaussianNoise(8 / 111139);
                const raw: GpsPoint = {
                    lat: trueLat + noiseLat,
                    lon: trueLon + noiseLon,
                    timestamp: t * 1000,
                    accuracyM: 8,
                };

                const smoothed = kf.update(raw);

                // Después de la ventana de "warmup" (10 muestras)
                if (t > 10) {
                    rawDeviationSum += distM(raw.lat, raw.lon, trueLat, trueLon);
                    smoothedDeviationSum += distM(smoothed.lat, smoothed.lon, trueLat, trueLon);
                }
            }

            // Smoothed debe ser <80% del raw deviation
            expect(smoothedDeviationSum).toBeLessThan(rawDeviationSum * 0.8);
        });
    });

    describe('Outliers extremos no rompen el filtro', () => {
        it('un jump de 500m no diverge la estimación >100m al final', () => {
            const kf = new GpsKalmanFilter();
            const lat0 = 28.123, lon0 = -15.436;
            // 30 muestras buenas
            for (let t = 0; t < 30; t++) {
                kf.update({ lat: lat0, lon: lon0, timestamp: t * 1000, accuracyM: 5 });
            }
            // Outlier: 500m al sur (~0.0045°)
            kf.update({ lat: lat0 - 0.0045, lon: lon0, timestamp: 30 * 1000, accuracyM: 5 });
            // 10 muestras buenas más
            for (let t = 31; t < 41; t++) {
                kf.update({ lat: lat0, lon: lon0, timestamp: t * 1000, accuracyM: 5 });
            }
            // El último smoothed debe estar muy cerca del lat0
            const finalSmoothed = kf.update({ lat: lat0, lon: lon0, timestamp: 41 * 1000, accuracyM: 5 });
            const dev = distM(finalSmoothed.lat, finalSmoothed.lon, lat0, lon0);
            expect(dev).toBeLessThan(100);
        });
    });

    describe('Packet loss 10%: estructura del estado se conserva', () => {
        it('el filtro funciona con 10% drops; resultado final cerca de GT', () => {
            const kf = new GpsKalmanFilter();
            const lat0 = 28.123, lon0 = -15.436;
            const speedMs = 5;

            const totalSec = 100;
            const dropProb = 0.10;
            let lastSmoothed: { lat: number; lon: number } | null = null;

            for (let t = 0; t < totalSec; t++) {
                if (Math.random() < dropProb) continue;  // packet drop

                const trueLat = lat0 + (speedMs * t) / 111139;
                const sample: GpsPoint = {
                    lat: trueLat + gaussianNoise(5 / 111139),
                    lon: lon0 + gaussianNoise(5 / 111139),
                    timestamp: t * 1000,
                    accuracyM: 5,
                };
                lastSmoothed = kf.update(sample);
            }

            expect(lastSmoothed).not.toBeNull();
            const finalTrueLat = lat0 + (speedMs * (totalSec - 1)) / 111139;
            const dev = distM(lastSmoothed!.lat, lastSmoothed!.lon, finalTrueLat, lon0);
            // Aún con 10% drops, deviation < 20m
            expect(dev).toBeLessThan(20);
        });
    });

    describe('Reset por gap >5min', () => {
        it('un gap muy largo entre samples reinicia el filtro y NO produce velocidad espuria', () => {
            const kf = new GpsKalmanFilter();
            kf.update({ lat: 28.10, lon: -15.40, timestamp: 0, accuracyM: 5 });
            kf.update({ lat: 28.10, lon: -15.40, timestamp: 1000, accuracyM: 5 });
            // Salto de 10 min
            const sm = kf.update({ lat: 28.20, lon: -15.50, timestamp: 1000 + 10 * 60 * 1000, accuracyM: 5 });
            // Tras reset, vLat y vLon ~ 0 (no se asume velocidad antigua)
            expect(Math.abs(sm.vLat)).toBeLessThan(1e-3);
            expect(Math.abs(sm.vLon)).toBeLessThan(1e-3);
        });
    });
});
