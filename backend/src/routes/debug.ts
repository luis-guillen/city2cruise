import { Router } from 'express';
import { getActiveDrivers } from '../sockets/io';
import { calculateDistance } from '../utils/geo';
import { db } from '../db/database';

const debugRouter = Router();

// Solo disponible en desarrollo / demo
const isDev = process.env.NODE_ENV !== 'production';

/**
 * GET /debug/active-drivers
 * Lista los conductores activos y su distancia a los pedidos pendientes.
 */
debugRouter.get('/active-drivers', async (req, res) => {
    if (!isDev) {
        return res.status(403).json({ error: 'Not available in production' });
    }

    const drivers = getActiveDrivers();

    // Obtener los pedidos activos para calcular distancias
    const { rows: pendingRequests } = await db.query(
        "SELECT id, pickup_location, latitude, longitude FROM pickup_requests WHERE status = 'REQUESTED'"
    );

    const result = drivers.map(driver => ({
        driverId: driver.userId,
        socketId: driver.socketId,
        lat: driver.lat,
        lon: driver.lon,
        distancesToPendingRequests: pendingRequests.map((req: any) => ({
            requestId: req.id,
            location: req.pickup_location,
            distanceKm: (req.latitude != null && req.longitude != null)
                ? parseFloat(calculateDistance(driver.lat, driver.lon, req.latitude, req.longitude).toFixed(2))
                : null
        }))
    }));

    res.json({
        activeDriverCount: drivers.length,
        pendingRequestCount: pendingRequests.length,
        drivers: result,
        timestamp: new Date().toISOString()
    });
});

export default debugRouter;
