export async function getOSRMRoute(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number }
): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn('OSRM Route failed, using straight line', data);
      return [
        [start.lat, start.lon],
        [end.lat, end.lon],
      ];
    }

    const coordinates = data.routes[0].geometry.coordinates.map(
      (coord: [number, number]) => [coord[1], coord[0]] as [number, number]
    );
    return coordinates;
  } catch (error) {
    console.error('Error fetching OSRM route:', error);
    return [
      [start.lat, start.lon],
      [end.lat, end.lon],
    ];
  }
}