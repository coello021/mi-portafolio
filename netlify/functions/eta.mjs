import { dentroDelTope, llave, entero } from '../lib/tope.mjs';
import sucursales from '../../public/data/sucursales.json';

// Tiempo de viaje en vivo CD Nejapa -> sucursal (TomTom Routing, con tráfico).
// Solo acepta códigos de sucursal conocidos: nadie puede usarlo para rutas arbitrarias.
// Perfil de camión y margen: se ajustan en Netlify (variables de entorno), sin tocar código.
//   CAMION_VEL_MAX (km/h, por defecto 80) · CAMION_PESO_KG (0 = sin restricciones de peso)
//   MARGEN_PORCENTAJE (por defecto 20): margen sobre el tiempo de TomTom por semáforos, paradas y maniobras.
const num = (nombre, def, min, max) => { const v = Number(process.env[nombre]); return Number.isFinite(v) && v >= min && v <= max && process.env[nombre] !== '' && process.env[nombre] != null ? v : def; };

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

  const base =
    `https://api.tomtom.com/routing/1/calculateRoute/${cd.lat},${cd.lon}:${dest.lat},${dest.lon}/json` +
    `?key=${encodeURIComponent(k)}&traffic=true&departAt=now&computeTravelTimeFor=all&routeType=fastest`;
  const vel = Math.round(num('CAMION_VEL_MAX', 80, 20, 140)), peso = Math.round(num('CAMION_PESO_KG', 0, 0, 60000));
  const camion = `${base}&travelMode=truck&vehicleCommercial=true&vehicleMaxSpeed=${vel}` + (peso > 0 ? `&vehicleWeight=${peso}` : '');

  let r, modo = 'camion';
  try { r = await fetch(camion); } catch { return json({ error: 'No se pudo contactar a TomTom' }, 502); }
  // Si TomTom no acepta el modo camión (no es problema de la llave ni de la cuota), se calcula como carro y se avisa.
  if (!r.ok && ![401, 403, 429].includes(r.status)) {
    modo = 'carro';
    try { r = await fetch(`${base}&travelMode=car`); } catch { return json({ error: 'No se pudo contactar a TomTom' }, 502); }
  }
  if (!r.ok) return json({ error: `TomTom respondió ${r.status}` }, r.status === 403 ? 429 : 502, 'public, max-age=120');

  const data = await r.json();
  const s = data?.routes?.[0]?.summary;
  if (!s) return json({ error: 'Respuesta sin ruta' }, 502);

  // Diagnóstico: /api/eta?codigo=15&debug=1 muestra los segundos crudos que devolvió TomTom.
  if (new URL(req.url).searchParams.get('debug') === '1') {
    return json({ resumen_tomtom: s, parametros: `traffic=true, departAt=now, computeTravelTimeFor=all, modo=${modo}, vel_max=${vel}, peso=${peso}` }, 200, 'no-store');
  }

  const vivo = Math.round(s.travelTimeInSeconds / 60);
  const libre = Math.round((s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0)) / 60);
  const margen = num('MARGEN_PORCENTAJE', 20, 0, 200);
  return new Response(JSON.stringify({
    codigo,
    km: Math.round(s.lengthInMeters / 100) / 10,
    modo,
    margen_pct: margen,
    min_vivo: vivo,
    min_ajustado: Math.round(vivo * (1 + margen / 100)),
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
