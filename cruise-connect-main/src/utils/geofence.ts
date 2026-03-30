/**
 * Geofencing y ubicaciones de Las Palmas de Gran Canaria.
 *
 * El bounding box cubre toda la zona operativa:
 *   - Norte: ~28.22 (por encima de Las Coloradas / Arucas)
 *   - Sur:   ~27.99 (por debajo de Telde)
 *   - Oeste: ~-15.55 (oeste de Isleta)
 *   - Este:  ~-15.35 (este de Telde)
 */

// ── Bounding box zona operativa ──
export const SERVICE_AREA = {
  latMin: 27.99,
  latMax: 28.22,
  lonMin: -15.55,
  lonMax: -15.35,
  name: 'Las Palmas de Gran Canaria',
};

/**
 * Comprueba si unas coordenadas están dentro de la zona operativa.
 */
export function isInsideServiceArea(lat: number, lon: number): boolean {
  return (
    lat >= SERVICE_AREA.latMin &&
    lat <= SERVICE_AREA.latMax &&
    lon >= SERVICE_AREA.lonMin &&
    lon <= SERVICE_AREA.lonMax
  );
}

// ── Ubicaciones realistas dentro de Las Palmas ──
// Cada punto es un lugar real frecuentado por turistas y residentes.
const LAS_PALMAS_LOCATIONS: Array<{ lat: number; lon: number; name: string }> = [
  { lat: 28.1413, lon: -15.4308, name: 'Santa Catalina' },
  { lat: 28.1468, lon: -15.4170, name: 'Puerto de La Luz' },
  { lat: 28.1362, lon: -15.4340, name: 'Playa de Las Canteras (centro)' },
  { lat: 28.1290, lon: -15.4420, name: 'Playa de Las Canteras (sur)' },
  { lat: 28.1505, lon: -15.4145, name: 'Muelle de cruceros' },
  { lat: 28.1320, lon: -15.4360, name: 'Guanarteme' },
  { lat: 28.1100, lon: -15.4165, name: 'Triana' },
  { lat: 28.1000, lon: -15.4140, name: 'Vegueta' },
  { lat: 28.1180, lon: -15.4280, name: 'Arenales' },
  { lat: 28.1245, lon: -15.4350, name: 'Mesa y López' },
  { lat: 28.1060, lon: -15.4250, name: 'San Nicolás / Ciudad Jardín' },
  { lat: 28.1150, lon: -15.4320, name: 'Alcaravaneras' },
];

/**
 * Devuelve una ubicación aleatoria dentro de Las Palmas.
 * Útil como fallback para demos cuando no hay GPS real.
 */
export function getRandomLasPalmasLocation(): { lat: number; lon: number; name: string } {
  const idx = Math.floor(Math.random() * LAS_PALMAS_LOCATIONS.length);
  // Añadir micro-variación (±50m) para que no caigan en el mismo punto exacto
  const jitter = () => (Math.random() - 0.5) * 0.001;
  const loc = LAS_PALMAS_LOCATIONS[idx];
  return {
    lat: loc.lat + jitter(),
    lon: loc.lon + jitter(),
    name: loc.name,
  };
}
