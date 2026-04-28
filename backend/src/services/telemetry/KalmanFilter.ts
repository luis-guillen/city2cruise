/**
 * 2-D GPS Kalman filter using two independent 1-D constant-velocity filters.
 * Decoupling lat/lon is exact when process and measurement noise are axis-independent,
 * which holds for isotropic GPS errors — so no accuracy is lost vs. a full 4×4 filter.
 *
 * State per axis: [position_deg, velocity_deg_per_s]
 * Process model:  constant-velocity with white-acceleration noise σa
 * Measurement:    raw GPS reading with noise σm (derived from `accuracyM` field)
 */

export interface GpsPoint {
    lat: number;
    lon: number;
    timestamp: number; // Unix ms
    accuracyM?: number; // GPS horizontal accuracy; defaults to DEFAULT_GPS_SIGMA_M
}

export interface SmoothedPoint {
    lat: number;
    lon: number;
    timestamp: number;
    vLat: number;   // estimated velocity — degrees/s, north-positive
    vLon: number;   // estimated velocity — degrees/s, east-positive
    sigmaM: number; // 1-σ position uncertainty in metres
}

const DEG_TO_M = 111_139;         // metres per degree of latitude (equatorial approximation)
const DEFAULT_GPS_SIGMA_M = 10;   // fallback noise when `accuracyM` is absent
const DEFAULT_SIGMA_ACC = 0.5;    // m/s² process noise (typical urban driving acceleration)

// ─── 1-D Kalman filter ───────────────────────────────────────────────────────

class Kf1D {
    private pos: number;
    private vel = 0;
    // Upper-triangular symmetric 2×2 covariance P stored as four scalars
    private p00: number;
    private p01 = 0;
    private p10 = 0;
    private p11 = 1e-10; // near-zero initial velocity uncertainty

    constructor(initPosDeg: number, sigmaPosDeg: number) {
        this.pos = initPosDeg;
        this.p00 = sigmaPosDeg * sigmaPosDeg;
    }

    /** Propagate state forward by `dt` seconds. */
    predict(dt: number, sigmaAccDeg: number): void {
        const dt2 = dt * dt;
        const sa2 = sigmaAccDeg * sigmaAccDeg;

        this.pos += this.vel * dt;

        // P_pred = F P F^T + Q
        const np00 = this.p00 + dt * (this.p01 + this.p10) + dt2 * this.p11 + sa2 * dt2 * dt2 / 4;
        const np01 = this.p01 + dt * this.p11 + sa2 * dt2 * dt / 2;
        const np10 = this.p10 + dt * this.p11 + sa2 * dt2 * dt / 2;
        const np11 = this.p11 + sa2 * dt2;
        this.p00 = np00; this.p01 = np01; this.p10 = np10; this.p11 = np11;
    }

    /** Fuse a new measurement with noise `sigmaMeasDeg`. */
    update(measurement: number, sigmaMeasDeg: number): void {
        const S = this.p00 + sigmaMeasDeg * sigmaMeasDeg; // innovation covariance (scalar)
        const k0 = this.p00 / S; // Kalman gain for position
        const k1 = this.p10 / S; // Kalman gain for velocity
        const innov = measurement - this.pos;

        this.pos += k0 * innov;
        this.vel += k1 * innov;

        // P = (I − K H) P  (Joseph form simplifies to this for scalar H = [1,0])
        const np00 = (1 - k0) * this.p00;
        const np01 = (1 - k0) * this.p01;
        const np10 = this.p10 - k1 * this.p00;
        const np11 = this.p11 - k1 * this.p01;
        this.p00 = np00; this.p01 = np01; this.p10 = np10; this.p11 = np11;
    }

    get position(): number { return this.pos; }
    get velocity(): number { return this.vel; }
    get posVarianceDeg2(): number { return this.p00; }
}

// ─── Public GPS Kalman filter ─────────────────────────────────────────────────

export class GpsKalmanFilter {
    private latKf: Kf1D | null = null;
    private lonKf: Kf1D | null = null;
    private lastTs: number | null = null;
    private readonly sigmaAccDeg: number; // process noise in deg/s²

    /**
     * @param sigmaAccMps2  Expected acceleration magnitude (m/s²). Larger → filter
     *                      reacts faster to manoeuvres but is less smooth.
     */
    constructor(sigmaAccMps2: number = DEFAULT_SIGMA_ACC) {
        this.sigmaAccDeg = sigmaAccMps2 / DEG_TO_M;
    }

    /**
     * Feed one raw GPS reading; returns the filtered estimate.
     * The first call initialises the filter — the returned position equals the raw input.
     */
    update(point: GpsPoint): SmoothedPoint {
        const sigmaMeasDeg = (point.accuracyM ?? DEFAULT_GPS_SIGMA_M) / DEG_TO_M;

        if (this.latKf === null || this.lonKf === null || this.lastTs === null) {
            this.latKf = new Kf1D(point.lat, sigmaMeasDeg);
            this.lonKf = new Kf1D(point.lon, sigmaMeasDeg);
            this.lastTs = point.timestamp;
            return {
                lat: point.lat,
                lon: point.lon,
                timestamp: point.timestamp,
                vLat: 0,
                vLon: 0,
                sigmaM: point.accuracyM ?? DEFAULT_GPS_SIGMA_M,
            };
        }

        // Clamp dt to avoid numerical blow-up on large gaps (> 5 min → treat as re-init)
        const dtMs = point.timestamp - this.lastTs;
        if (dtMs > 300_000) {
            this.reset();
            return this.update(point);
        }
        const dtS = Math.max(dtMs / 1000, 0.001);
        this.lastTs = point.timestamp;

        this.latKf.predict(dtS, this.sigmaAccDeg);
        this.lonKf.predict(dtS, this.sigmaAccDeg);
        this.latKf.update(point.lat, sigmaMeasDeg);
        this.lonKf.update(point.lon, sigmaMeasDeg);

        const sigmaM = Math.sqrt(this.latKf.posVarianceDeg2) * DEG_TO_M;

        return {
            lat: this.latKf.position,
            lon: this.lonKf.position,
            timestamp: point.timestamp,
            vLat: this.latKf.velocity,
            vLon: this.lonKf.velocity,
            sigmaM,
        };
    }

    /** Smooth an entire historical track in a single forward pass. */
    static smoothTrack(points: GpsPoint[], sigmaAccMps2 = DEFAULT_SIGMA_ACC): SmoothedPoint[] {
        const kf = new GpsKalmanFilter(sigmaAccMps2);
        return points.map(p => kf.update(p));
    }

    /**
     * Detect GPS anomalies by comparing raw positions to the Kalman-smoothed track.
     * A point is flagged as an outlier when it deviates more than `thresholdM` metres
     * from its smoothed counterpart.
     *
     * Note: because the filter is causal (forward-pass only), a large outlier at time t
     * will slightly bias the smoothed state at t before decaying in subsequent steps.
     * For real-time streaming, prefer comparing the measurement against the *predicted*
     * state (before the update step) instead.
     */
    static detectOutliers(
        points: GpsPoint[],
        thresholdM = 50,
        sigmaAccMps2 = DEFAULT_SIGMA_ACC,
    ): Array<{ point: GpsPoint; isOutlier: boolean; deviationM: number }> {
        const smoothed = GpsKalmanFilter.smoothTrack(points, sigmaAccMps2);
        return points.map((p, i) => {
            const s = smoothed[i];
            const cosLat = Math.cos((p.lat * Math.PI) / 180);
            const dLatM = (p.lat - s.lat) * DEG_TO_M;
            const dLonM = (p.lon - s.lon) * DEG_TO_M * cosLat;
            const deviationM = Math.sqrt(dLatM ** 2 + dLonM ** 2);
            return { point: p, isOutlier: deviationM > thresholdM, deviationM };
        });
    }

    reset(): void {
        this.latKf = null;
        this.lonKf = null;
        this.lastTs = null;
    }
}
