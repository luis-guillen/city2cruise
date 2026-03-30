import { Router } from 'express';
import { sendError } from '../utils/errors';
import { authMiddleware, requireRole } from '../auth/middleware';
import { config } from '../config/env';

const locationsRouter = Router();

// GET /locations/search?q=
locationsRouter.get('/search', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    try {
        const query = req.query.q as string;
        if (!query || query.length < 3) {
            return res.json([]);
        }

        // Construir URL de Nominatim con viewbox para restringir al área de servicio
        const params = new URLSearchParams({
            format: 'json',
            limit: '6',
            q: query,
            viewbox: config.SERVICE_AREA_VIEWBOX,  // lon_min,lat_min,lon_max,lat_max
            bounded: '1',                           // solo resultados dentro del viewbox
            countrycodes: 'es',                     // solo España
            'accept-language': 'es',                // resultados en español
        });

        const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'City2Cruise/1.0 (info@rekertech.com)'
            }
        });

        if (!response.ok) {
            throw new Error(`Nominatim API returned ${response.status}`);
        }

        const data = await response.json();

        const results = data.map((item: any) => ({
            displayName: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon)
        }));

        res.json(results);
    } catch (error) {
        console.error('[Nominatim Proxy Error]', error);
        return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Error fetching locations');
    }
});

export default locationsRouter;
