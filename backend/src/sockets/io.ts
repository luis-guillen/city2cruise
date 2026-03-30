import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { config } from "../config/env";
import { verifyToken } from "../auth/jwt";
import { logger } from "../utils/logger";
import { db } from "../db/database";

let io: Server;

export interface ActiveDriver {
    userId: number;
    socketId: string;
    lat: number;
    lon: number;
}

const activeDrivers = new Map<number, ActiveDriver>();

export const getActiveDrivers = (): ActiveDriver[] => {
    return Array.from(activeDrivers.values());
};

export const updateActiveDriverLocation = (userId: number, lat: number, lon: number) => {
    const driver = activeDrivers.get(userId);
    if (driver) {
        activeDrivers.set(userId, { ...driver, lat, lon });
    }
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
        socket.on("driver:location:update", async (data: { lat: number; lon: number }) => {
            if (user.role === 'DRIVER') {
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
                    const { rows } = await db.query(
                        `SELECT client_id FROM pickup_requests
                         WHERE driver_id = $1 AND status IN ('CONFIRMATION_PENDING', 'IN_PROGRESS')
                         LIMIT 1`,
                        [user.id]
                    );
                    if (rows.length > 0) {
                        const clientId = rows[0].client_id;
                        io.to(`user_${clientId}`).emit('driver:location', { lat: data.lat, lon: data.lon });
                    }
                } catch (err) {
                    // Non-critical — don't break the flow
                }
            }
        });

        socket.on("disconnect", () => {
            if (user.role === 'DRIVER') {
                activeDrivers.delete(user.id);
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
