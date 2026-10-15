import { dentroDelTope, llave, entero } from '../lib/tope.mjs';
import sucursales from '../../public/data/sucursales.json';

// Tiempo de viaje en vivo CD Nejapa -> sucursal (TomTom Routing, con tráfico).
// Solo acepta códigos de sucursal conocidos: nadie puede usarlo para rutas arbitrarias.
const json = (obj, status = 200, cache = 'public, max-age=60') =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

export default async (req) => {
  const codigo = new URL(req.url).searchParams.get('codigo') || '';
  const cd = sucursales.find((s) => s.codigo === 'CD');
  const dest = sucursales.find((s) => s.codigo === codigo && s.codigo !== 'CD');
  if (!dest) return json({ error: 'Sucursal desconocida' }, 400);

  const k = llave();
  if (!k) return json({ error: 'Tráfico en vivo no configurado' }, 503);
  if (!dentroDelTope('eta', entero('TOPE_ETA_DIA', 400))) return json({ error: 'Tope diario alcanzado' }, 429, 'public, max-age=300');

  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/${cd.lat},${cd.lon}:${dest.lat},${dest.lon}/json` +
    `?key=${encodeURIComponent(k)}&traffic=true&departAt=now&computeTravelTimeFor=all&travelMode=car&routeType=fastest`;

  let r;
  try { r = await fetch(url); } catch { return json({ error: 'No se pudo contactar a TomTom' }, 502); }
  if (!r.ok) return json({ error: `TomTom respondió ${r.status}` }, r.status === 403 ? 429 : 502, 'public, max-age=120');

  const data = await r.json();
  const s = data?.routes?.[0]?.summary;
  if (!s) return json({ error: 'Respuesta sin ruta' }, 502);

  // Diagnóstico: /api/eta?codigo=15&debug=1 muestra los segundos crudos que devolvió TomTom.
  if (new URL(req.url).searchParams.get('debug') === '1') {
    return json({ resumen_tomtom: s, parametros: 'traffic=true, departAt=now, computeTravelTimeFor=all' }, 200, 'no-store');
  }

  const vivo = Math.round(s.travelTimeInSeconds / 60);
  const libre = Math.round((s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0)) / 60);
  return new Response(JSON.stringify({
    codigo,
    km: Math.round(s.lengthInMeters / 100) / 10,
    min_vivo: vivo,
    min_sin_trafico: libre,
    retraso_min: Math.max(0, Math.round((s.trafficDelayInSeconds || 0) / 60)),
    actualizado: new Date().toISOString(),
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=900',
    },
  });
};

export const config = { path: '/api/eta' };
