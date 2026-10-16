import { dentroDelTope, llave, entero } from '../lib/tope.mjs';
import { codificar } from '../lib/polilinea.mjs';
import sucursales from '../../public/data/sucursales.json';

// Mejor ruta en vivo CD Nejapa -> sucursal (TomTom Routing, con tráfico y alternativas).
// Devuelve la geometría de cada ruta y los tramos con demora que TomTom reporta sobre ella.
// Solo acepta códigos de sucursal conocidos. La llave nunca sale en la respuesta.
// Variables (las mismas de /api/eta): CAMION_VEL_MAX, CAMION_PESO_KG, MARGEN_PORCENTAJE.
//   TOPE_RUTA_DIA (por defecto 300) · ALTERNATIVAS_RUTA (0 a 3, por defecto 2)
const num = (nombre, def, min, max) => {
  const raw = process.env[nombre];
  const v = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(v) && v >= min && v <= max ? v : def;
};

const json = (obj, status = 200, cache = 'public, max-age=60') =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

const CATEGORIAS = { JAM: 'JAM', ROAD_WORK: 'ROAD_WORK', ROAD_CLOSURE: 'ROAD_CLOSURE' };

function resumir(ruta, margen) {
  const s = ruta.summary || {};
  const puntos = (ruta.legs || []).flatMap((l) => l.points || []);
  if (!s.travelTimeInSeconds || puntos.length < 2) return null;
  const vivo = Math.round(s.travelTimeInSeconds / 60);
  const libre = Math.round((s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0)) / 60);
  const tramos = (ruta.sections || [])
    .filter((x) => x.sectionType === 'TRAFFIC' && Number.isInteger(x.startPointIndex) && Number.isInteger(x.endPointIndex) && x.endPointIndex > x.startPointIndex)
    .slice(0, 40)
    .map((x) => ({
      a: x.startPointIndex,
      b: Math.min(x.endPointIndex, puntos.length - 1),
      cat: CATEGORIAS[x.simpleCategory] || 'OTHER',
      mag: Number.isInteger(x.magnitudeOfDelay) ? x.magnitudeOfDelay : 0,
      vel: Number.isFinite(x.effectiveSpeedInKmh) ? Math.round(x.effectiveSpeedInKmh) : null,
      ret: Math.max(0, Math.round((x.delayInSeconds || 0) / 60 * 10) / 10),
    }));
  return {
    km: Math.round(s.lengthInMeters / 100) / 10,
    min_vivo: vivo,
    min_ajustado: Math.round(vivo * (1 + margen / 100)),
    min_sin_trafico: libre,
    retraso_min: Math.max(0, Math.round((s.trafficDelayInSeconds || 0) / 60)),
    poly: codificar(puntos.map((p) => [p.latitude, p.longitude])),
    tramos,
  };
}

export default async (req) => {
  const codigo = new URL(req.url).searchParams.get('codigo') || '';
  const cd = sucursales.find((s) => s.codigo === 'CD');
  const dest = sucursales.find((s) => s.codigo === codigo && s.codigo !== 'CD');
  if (!dest) return json({ error: 'Sucursal desconocida' }, 400);

  const k = llave();
  if (!k) return json({ error: 'Tráfico en vivo no configurado' }, 503);
  if (!dentroDelTope('ruta', entero('TOPE_RUTA_DIA', 300))) return json({ error: 'Tope diario alcanzado' }, 429, 'public, max-age=300');

  const alt = Math.round(num('ALTERNATIVAS_RUTA', 2, 0, 3));
  const vel = Math.round(num('CAMION_VEL_MAX', 80, 20, 140)), peso = Math.round(num('CAMION_PESO_KG', 0, 0, 60000));
  const margen = num('MARGEN_PORCENTAJE', 20, 0, 200);

  const base =
    `https://api.tomtom.com/routing/1/calculateRoute/${cd.lat},${cd.lon}:${dest.lat},${dest.lon}/json` +
    `?key=${encodeURIComponent(k)}&traffic=true&departAt=now&computeTravelTimeFor=all&routeType=fastest&sectionType=traffic`;
  const camion = `&travelMode=truck&vehicleCommercial=true&vehicleMaxSpeed=${vel}` + (peso > 0 ? `&vehicleWeight=${peso}` : '');
  const masAlt = alt > 0 ? `&maxAlternatives=${alt}` : '';

  // Intentos de más a menos exigente. Un 401/403/429 no es culpa del modo: se corta de inmediato.
  const intentos = [
    { modo: 'camion', url: base + camion + masAlt },
    ...(alt > 0 ? [{ modo: 'camion', url: base + camion }] : []),
    { modo: 'carro', url: base + '&travelMode=car' + masAlt },
  ];
  let r = null, modo = 'camion';
  for (const it of intentos) {
    try { r = await fetch(it.url); } catch { return json({ error: 'No se pudo contactar a TomTom' }, 502); }
    modo = it.modo;
    if (r.ok || [401, 403, 429].includes(r.status)) break;
  }
  if (!r.ok) return json({ error: `TomTom respondió ${r.status}` }, r.status === 403 ? 429 : 502, 'public, max-age=120');

  const data = await r.json();
  const rutas = (data?.routes || []).map((x) => resumir(x, margen)).filter(Boolean);
  if (!rutas.length) return json({ error: 'Respuesta sin ruta' }, 502);

  return new Response(JSON.stringify({
    codigo,
    modo,
    margen_pct: margen,
    rutas, // la primera es la recomendada por TomTom; las demás son alternativas
    actualizado: new Date().toISOString(),
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
};

export const config = { path: '/api/ruta' };
