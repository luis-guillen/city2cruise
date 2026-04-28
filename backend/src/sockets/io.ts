import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { getRedisPubSub } from "../cache/redis";
import { Server as HttpServer } from "http";
import { config } from "../config/env";
import { verifyToken } from "../auth/jwt";
import { logger } from "../utils/logger";
import { db } from "../db/database";
import { validateAndRecord, GpsValidationResult } from "../services/GpsValidationService";

let io: Server;

export interface ActiveDriver {
    userId: number;
    socketId: string;
    lat: number;
    lon: number;
}

interface DriverLocationPayload {
    lat: number;
    lon: number;
    deviceTs?: number;   // epoch ms from navigator.geolocation — used for clock-drift check
    routeProgress?: number;
    routeTail?: Array<{ lat: number; lon: number }>;
}

interface DriverRoutePoint {
    lat: number;
    lon: number;
}

interface DriverRoutePayload {
    route: DriverRoutePoint[];
    requestId?: string | number | null;
    phase?: 'CONFIRMATION_PENDING' | 'IN_PROGRESS' | null;
}

const activeDrivers = new Map<number, ActiveDriver>();
const cachedDriverRoutes = new Map<number, DriverRoutePayload>();
const lastRouteRelayMetaByDriver = new Map<number, { key: string; at: number }>();

export const getActiveDrivers = (): ActiveDriver[] => {
    return Array.from(activeDrivers.values());
};

export const updateActiveDriverLocation = (userId: number, lat: number, lon: number) => {
    const driver = activeDrivers.get(userId);
    if (driver) {
        activeDrivers.set(userId, { ...driver, lat, lon });
    }
};

const findActiveClientIdByDriver = async (driverId: number): Promise<number | null> => {
    const { rows } = await db.query(
        `SELECT client_id FROM pickup_requests
         WHERE driver_id = $1 AND status IN ('CONFIRMATION_PENDING', 'IN_PROGRESS')
         LIMIT 1`,
        [driverId]
    );

    if (rows.length === 0) return null;

    const clientId = Number(rows[0]?.client_id);
    return Number.isFinite(clientId) ? clientId : null;
};

const maybeRelayCachedRoute = (driverId: number, clientId: number) => {
    const cached = cachedDriverRoutes.get(driverId);
    if (!cached || !Array.isArray(cached.route) || cached.route.length < 2) {
        return;
    }

    const relayKey = `${clientId}|${cached.requestId ?? ''}|${cached.phase ?? ''}|${cached.route.length}`;
    const now = Date.now();
    const prev = lastRouteRelayMetaByDriver.get(driverId);

    // Reenviar si cambió ruta/cliente o si pasaron >8s (cliente pudo recargar tarde).
    const shouldRelay = !prev || prev.key !== relayKey || (now - prev.at) > 8000;
    if (!shouldRelay) return;

    io.to(`user_${clientId}`).emit('driver:route', cached);
    lastRouteRelayMetaByDriver.set(driverId, { key: relayKey, at: now });
};

export const initSockets = (httpServer: HttpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => {
                // Allow: no origin (curl/mobile apps), localhost, LAN IPs in dev
                if (
                    !origin ||
                    origin.startsWith('http://localhost:') ||
                    (process.env.NODE_ENV !== 'production' && origin.startsWith('http://192.168.'))
                ) {
                    callback(null, true);
                } else if (origin === config.frontendUrl) {
                    callback(null, true);
                } else {
                    callback(new Error('Socket: Not allowed by CORS'));
                }
            },
            methods: ["GET", "POST"],
            credentials: true,
        }
    });

    // Hito 4.3.2 — Cuando hay Redis, registra el adapter para soportar
    // multi-instancia (eventos cross-worker via pub/sub).
    const ps = getRedisPubSub();
    if (ps) {
        try {
            io.adapter(createAdapter(ps.pub, ps.sub));
            logger.info('socket.io redis adapter active');
        } catch (e) {
            logger.warn({ err: (e as Error).message }, 'failed to attach socket.io redis adapter');
        }
    }

    // JWT Authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error("Authentication error: Token missing"));
        }

        const decoded = verifyToken(token);
        if (!decoded) {
            return next(new Error("Authentication error: Invalid token"));
        }

        // Attach user info to socket
        (socket as any).user = decoded;
        next();
    });

    io.on("connection", (socket) => {
        const user = (socket as any).user;
        const roomName = `user_${user.id}`;

        logger.info({ socketId: socket.id, userId: user.id, room: roomName }, 'Socket connected');

        // Join private user room
        socket.join(roomName);

        // Add to active drivers if role is DRIVER
        if (user.role === 'DRIVER') {
            activeDrivers.set(user.id, {
                userId: user.id,
                socketId: socket.id,
                lat: 0, 
                lon: 0
            });
        }

        // Intercept driver location updates
        socket.on("driver:location:update", async (data: DriverLocationPayload) => {
            if (user.role === 'DRIVER') {
                if (!Number.isFinite(data.lat) || !Number.isFinite(data.lon)) return;

                // Anti-spoofing: validate clock drift + speed before accepting position
                const gpsResult = await validateAndRecord(
                    user.id, data.lat, data.lon,
                    Number.isFinite(data.deviceTs) ? data.deviceTs : null
                ).catch((): GpsValidationResult => ({ ok: true })); // non-blocking — allow on service error

                if (!gpsResult.ok) {
                    socket.emit('gps:anomaly', { anomaly: gpsResult.anomaly, reason: gpsResult.reason });
                    return; // drop the spoofed position
                }

                logger.debug({ driverId: user.id, lat: data.lat, lon: data.lon }, 'Driver location update');
                activeDrivers.set(user.id, {
                    userId: user.id,
                    socketId: socket.id,
                    lat: data.lat,
                    lon: data.lon
                });

                // Sync to DB (PostGIS) — fire-and-forget
                db.query(
                    `UPDATE users SET latitude = $1, longitude = $2,
                     location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
                     WHERE id = $3`,
                    [data.lat, data.lon, user.id]
                ).catch(err => logger.error({ err, driverId: user.id }, 'Failed to sync driver location to DB'));

                // Relay driver position to the client of the active request
                try {
                    const clientId = await findActiveClientIdByDriver(user.id);
                    if (clientId !== null) {
                        const routeTail = Array.isArray(data.routeTail)
                            ? data.routeTail
                                .filter((point): point is { lat: number; lon: number } =>
                                    Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
                                )
                                .slice(0, 2000)
                                .map((point) => ({ lat: point.lat, lon: point.lon }))
                            : null;

                        io.to(`user_${clientId}`).emit('driver:location', {
                            lat: data.lat,
                            lon: data.lon,
                            routeProgress: Number.isFinite(data.routeProgress) ? data.routeProgress : null,
                            routeTail,
                        });
                        maybeRelayCachedRoute(user.id, clientId);
                    }
                } catch (err) {
                    // Non-critical — don't break the flow
                }
            }
        });

        socket.on("driver:route:update", async (data: DriverRoutePayload) => {
            if (user.role !== 'DRIVER' || !Array.isArray(data?.route)) {
                return;
            }

            const sanitizedRoute = data.route
                .filter((point): point is DriverRoutePoint =>
                    Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
                )
                .slice(0, 2000)
                .map((point) => ({ lat: point.lat, lon: point.lon }));

            if (sanitizedRoute.length < 2) {
                return;
            }

            logger.debug(
                { driverId: user.id, points: sanitizedRoute.length, requestId: data.requestId ?? null, phase: data.phase ?? null },
                'Driver route update'
            );

            try {
                const clientId = await findActiveClientIdByDriver(user.id);
                const payloadToClient: DriverRoutePayload = {
                    route: sanitizedRoute,
                    requestId: data.requestId ?? null,
                    phase: data.phase ?? null,
                };
                cachedDriverRoutes.set(user.id, payloadToClient);
                lastRouteRelayMetaByDriver.delete(user.id);

                if (clientId !== null) {
                    io.to(`user_${clientId}`).emit('driver:route', payloadToClient);
                    lastRouteRelayMetaByDriver.set(
                        user.id,
                        {
                            key: `${clientId}|${payloadToClient.requestId ?? ''}|${payloadToClient.phase ?? ''}|${payloadToClient.route.length}`,
                            at: Date.now()
                        }
                    );
                }
            } catch (err) {
                logger.error({ err, driverId: user.id }, 'Failed to relay driver route');
            }
        });

        socket.on("disconnect", () => {
            if (user.role === 'DRIVER') {
                activeDrivers.delete(user.id);
                cachedDriverRoutes.delete(user.id);
                lastRouteRelayMetaByDriver.delete(user.id);
            }
            logger.info({ socketId: socket.id, userId: user.id }, 'Socket disconnected');
        });
    });

    return io;
};

// Utilidad para emitir eventos a todos los clientes
export const emitEvent = (event: string, data: any) => {
    if (io) {
        io.emit(event, data);
    }
};

// Utilidad para emitir a un usuario específico (por User ID para salas estancas)
export const emitToUser = (userId: string | number, event: string, data: any) => {
    if (io) {
        io.to(`user_${userId}`).emit(event, data);
    }
};

// Utilidad para emitir a un socket particular (para dispatch directo a drivers)
export const emitToSocket = (socketId: string, event: string, data: any) => {
    if (io) {
        io.to(socketId).emit(event, data);
    }
};
