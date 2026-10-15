import { dentroDelTope, llave, entero } from '../lib/tope.mjs';

// Proxy de teselas de tráfico de TomTom. La llave vive solo en el servidor.
const CAPAS = {
  flujo: (z, x, y, k) =>
    `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${encodeURIComponent(k)}&tileSize=256`,
  incidentes: (z, x, y, k) =>
    `https://api.tomtom.com/traffic/map/4/tile/incidents/s3/${z}/${x}/${y}.png?key=${encodeURIComponent(k)}&tileSize=256`,
};

function error(status, msg, cache = 'public, max-age=60') {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}

export default async (req, context) => {
  const { capa, z, x, y } = context.params || {};
  const fn = CAPAS[capa];
  const Z = Number(z), X = Number(x), Y = Number(String(y).replace(/\.png$/, ''));
  if (!fn || !Number.isInteger(Z) || !Number.isInteger(X) || !Number.isInteger(Y)) return error(400, 'Parámetros inválidos');
  if (Z < 6 || Z > 17 || X < 0 || Y < 0 || X >= 2 ** Z || Y >= 2 ** Z) return error(400, 'Tesela fuera de rango');

  const k = llave();
  if (!k) return error(503, 'Tráfico en vivo no configurado');

  if (!dentroDelTope('tiles', entero('TOPE_TESELAS_DIA', 1800))) {
    return error(429, 'Tope diario de teselas alcanzado', 'public, max-age=300');
  }

  let r;
  try {
    r = await fetch(fn(Z, X, Y, k), { headers: { Accept: 'image/png' } });
  } catch {
    return error(502, 'No se pudo contactar a TomTom');
  }
  if (!r.ok) return error(r.status === 403 ? 429 : 502, `TomTom respondió ${r.status}`, 'public, max-age=120');

  return new Response(r.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=120',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
};

export const config = { path: '/api/tiles/:capa/:z/:x/:y' };
