/**
 * Obtiene una ruta real por calles entre dos puntos usando la API pública de OSRM.
 * Devuelve un array de coordenadas [[lat, lon], ...]
 */
export async function getOSRMRoute(start: { lat: number; lon: number }, end: { lat: number; lon: number }): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn('OSRM Route failed, using straight line', data);
      return [
        [start.lat, start.lon],
        [end.lat, end.lon]
      ];
    }

    // GeoJSON usa [lon, lat], nosotros necesitamos [lat, lon] para Leaflet
    const coordinates = data.routes[0].geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]]);
    return coordinates as [number, number][];
  } catch (error) {
    console.error('Error fetching OSRM route:', error);
    return [
      [start.lat, start.lon],
      [end.lat, end.lon]
    ];
  }
}
