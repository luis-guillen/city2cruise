import { db } from '../db/database';
import { config } from '../config/env';
import { getActiveDrivers, emitToSocket, emitToUser, updateActiveDriverLocation, emitEvent } from '../sockets/io';
import { logger } from '../utils/logger';
import { getRLDriverRankingDetailed, applyRLRanking } from './RLDispatchService';
import { clearPendingOffers, registerPendingOffers } from './ReassignmentService';

interface CascadeEntry {
    timeouts: NodeJS.Timeout[];
}

const activeCascades = new Map<number, CascadeEntry>();

/**
 * Usa PostGIS ST_DWithin para encontrar conductores activos dentro del radio.
 * Cruza resultado DB con conductores conectados por socket.
 * Emite "request:new" a los que estén en radio y no hayan sido notificados antes.
 */
async function notifyDriversInRadius(
    requestId: number,
    safeDto: any,
    radiusKm: number,
    alreadyNotified: Set<number>
): Promise<Set<number>> {
    const drivers = getActiveDrivers();
    const newly = new Set<number>();

    if (safeDto.latitude == null || safeDto.longitude == null) {
        // Sin coordenadas en el pedido → notificar a todos los conductores activos
        for (const driver of drivers) {
            if (alreadyNotified.has(driver.userId)) continue;
            emitToSocket(driver.socketId, 'new:pickup:request', safeDto);
            newly.add(driver.userId);
        }
        return newly;
    }

    // Query PostGIS: conductores cuya ubicación DB esté dentro del radio
    const { rows: nearbyDrivers } = await db.query(`
        SELECT id,
               ST_Distance(
                 location,
                 ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
               ) / 1000.0 AS distance_km
        FROM users
        WHERE role = 'DRIVER'
          AND location IS NOT NULL
          AND ST_DWithin(
                location,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                $3 * 1000
              )
    `, [safeDto.longitude, safeDto.latitude, radiusKm]);

    const nearbyDriverIds = new Set(nearbyDrivers.map((r: any) => r.id as number));
    const distanceMap = new Map(nearbyDrivers.map((r: any) => [r.id as number, r.distance_km as number]));

    // Filter eligible candidates (in radius or no GPS yet)
    const eligible = drivers.filter(d => {
        if (alreadyNotified.has(d.userId)) return false;
        const inRadius = nearbyDriverIds.has(d.userId);
        const noGps = d.lat === 0 && d.lon === 0;
        return inRadius || noGps;
    });

    // Apply RL ranking (no-op when RL is disabled or service is down)
    const rl = await getRLDriverRankingDetailed();
    const rlRankings = rl.rankings;
    const rankedIds = applyRLRanking(eligible.map(d => d.userId), rlRankings);
    const driverById = new Map(eligible.map(d => [d.userId, d]));

    // Surface the RL decision to the Control Tower ("Ranking de IA" panel).
    // Advisory data consumed by the admin-only ControlTowerPage; passengers/drivers
    // ignore the event. Only emitted when the RL agent actually produced a ranking.
    if (rlRankings.length > 0) {
        emitEvent('rl:rankings', {
            requestId,
            rankings: rlRankings.map(r => ({ driverId: r.driverId, score: r.score, rank: r.rank })),
            modelVersion: rl.modelVersion ?? undefined,
            inferenceMs: rl.inferenceMs ?? undefined,
        });
    }

    for (const userId of rankedIds) {
        const driver = driverById.get(userId);
        if (!driver) continue;

        emitToSocket(driver.socketId, 'new:pickup:request', safeDto);
        newly.add(driver.userId);
        const dist = distanceMap.get(driver.userId) ?? 0;
        const inRadius = nearbyDriverIds.has(driver.userId);
        logger.info(
            { requestId, driverId: driver.userId, distKm: parseFloat(dist.toFixed(2)), radiusKm, mode: inRadius ? 'geo' : 'no-gps-fallback', rlRanked: rlRankings.length > 0 },
            'CASCADE driver notified'
        );
    }

    registerPendingOffers(requestId, [...newly]);

    return newly;
}

export const __testables = {
    notifyDriversInRadius,
};

/**
 * Teletransporta conductores de prueba a distancias específicas del punto de recogida.
 */
async function teleportDemoDrivers(lat: number, lon: number): Promise<void> {
    const demos = [
        { email: 'drivercerca@test.com', dLat: 0.02, dLon: 0 },  // ~2.2km
        { email: 'drivermedio@test.com', dLat: 0.04, dLon: 0 },  // ~4.4km
        { email: 'driverlejos@test.com', dLat: 0.06, dLon: 0 },  // ~6.6km
    ];

    for (const d of demos) {
        const { rows } = await db.query(`
            UPDATE users 
            SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            WHERE email = $3
            RETURNING id
        `, [lon + d.dLon, lat + d.dLat, d.email]);
        
        if (rows.length > 0) {
            updateActiveDriverLocation(rows[0].id, lat + d.dLat, lon + d.dLon);
        }
    }
    logger.info({ lat, lon }, 'DEMO: Test drivers teleported relative to pickup');
}

/**
 * Inicia la búsqueda en cascada: 3km → 5km → 7km (17s entre fases).
 * Ciclo: Si tras la fase 7km nadie acepta, reinicia desde 3km.
 */
export function startCascadeSearch(requestId: number, clientId: number, safeDto: any): void {
    const radii = config.searchRadii; // [3, 5, 7]
    const delay = config.cascadeTimeout; // 17000

    const timeouts: NodeJS.Timeout[] = [];
    activeCascades.set(requestId, { timeouts });

    const notified = new Set<number>();

    const runCascade = async (phase: number) => {
        if (!activeCascades.has(requestId)) return;

        // Verificar si el pedido sigue en REQUESTED
        const { rows } = await db.query('SELECT status FROM pickup_requests WHERE id = $1', [requestId]);
        if (!rows[0] || rows[0].status !== 'REQUESTED') {
            activeCascades.delete(requestId);
            return;
        }

        // Notificar al cliente que la búsqueda sigue activa (mantenimiento de estado)
        emitToUser(clientId, 'request:updated', { id: requestId, phase: phase + 1, radiusKm: radii[phase] || radii[0] });

        // Teletransportar drivers solo en la primera fase del primer ciclo
        if (phase === 0 && safeDto.latitude != null && safeDto.longitude != null) {
            await teleportDemoDrivers(safeDto.latitude, safeDto.longitude);
            // No reseteamos 'notified' aquí para evitar spam, pero sí buscamos en radio 3
        }

        const radius = radii[phase] || radii[0];
        const newly = await notifyDriversInRadius(requestId, safeDto, radius, notified);
        newly.forEach(id => notified.add(id));
        
        logger.info({ requestId, radiusKm: radius, phase: phase + 1, newly: newly.size }, 'CASCADE Phase');

        const nextPhase = (phase + 1) % radii.length;
        const t = setTimeout(() => { runCascade(nextPhase).catch((err) => logger.error({ err, requestId }, 'CASCADE next-phase error')); }, delay);
        timeouts.push(t);
    };

    runCascade(0).catch(err => logger.error({ err, requestId }, 'CASCADE Error'));
}

/**
 * Cancela todos los timeouts de una cascada activa.
 * Llamar cuando un conductor acepta la solicitud.
 */
export function cancelCascade(requestId: number): void {
    const entry = activeCascades.get(requestId);
    if (entry) {
        for (const t of entry.timeouts) clearTimeout(t);
        activeCascades.delete(requestId);
        logger.info({ requestId }, 'CASCADE cancelled (driver accepted)');
    }
    clearPendingOffers(requestId);
}
