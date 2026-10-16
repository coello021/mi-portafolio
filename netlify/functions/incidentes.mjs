import { dentroDelTope, llave, entero } from '../lib/tope.mjs';
import { decodificar } from '../lib/polilinea.mjs';
import sucursales from '../../public/data/sucursales.json';
import rutas from '../../public/data/rutas.json';

// Incidentes reportados por TomTom (accidentes, vía o carril cerrado, obras, inundaciones, vehículos averiados...)
// en toda la zona de la red. La API de TomTom acepta como máximo 10,000 km² por consulta; la red mide más,
// así que se divide en franjas de oeste a este. El resultado es el mismo para todos los visitantes:
// se cachea 5 min en el CDN y la página filtra los que quedan cerca de la ruta elegida.
// Variable opcional: TOPE_INC_DIA (por defecto 400 consultas al día, de mejor esfuerzo).
const MAX_KM2 = 9000; // margen bajo el límite de 10,000 km² de TomTom
const MAX_INCIDENTES = 300;
const CAMPOS = 'incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}';

function calcularFranjas() {
  const pts = [...sucursales.map((s) => [s.lat, s.lon]), ...rutas.flatMap((r) => (r.poly ? decodificar(r.poly) : []))];
  const pad = 0.03;
  const minLat = Math.min(...pts.map((p) => p[0])) - pad, maxLat = Math.max(...pts.map((p) => p[0])) + pad;
  const minLon = Math.min(...pts.map((p) => p[1])) - pad, maxLon = Math.max(...pts.map((p) => p[1])) + pad;
  const alto = (maxLat - minLat) * 110.54;
  const ancho = (maxLon - minLon) * 111.32 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const n = Math.max(1, Math.ceil((alto * ancho) / MAX_KM2));
  const paso = (maxLon - minLon) / n;
  return Array.from({ length: n }, (_, i) => [minLon + i * paso, minLat, minLon + (i + 1) * paso, maxLat].map((v) => Math.round(v * 1e4) / 1e4));
}
const FRANJAS = calcularFranjas();

const json = (obj, status = 200, cache = 'public, max-age=60') =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

function normalizar(f) {
  const p = f?.properties || {}, g = f?.geometry || {};
  let c = g.type === 'Point' ? [g.coordinates] : Array.isArray(g.coordinates) ? g.coordinates : [];
  c = c.filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (!c.length) return null;
  if (c.length > 30) { const paso = (c.length - 1) / 29; c = Array.from({ length: 30 }, (_, i) => c[Math.round(i * paso)]); }
  const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  return {
    id: texto(p.id, 80) || null,
    cat: Number.isInteger(p.iconCategory) ? p.iconCategory : 0,
    mag: Number.isInteger(p.magnitudeOfDelay) ? p.magnitudeOfDelay : 0,
    desc: (p.events || []).map((e) => texto(e?.description, 120)).filter(Boolean).slice(0, 2).join('. '),
    desde: texto(p.startTime, 40), hasta: texto(p.endTime, 40),
    de: texto(p.from, 120), a: texto(p.to, 120),
    m: Math.round(Number(p.length) || 0),
    ret_min: Number.isFinite(p.delay) ? Math.round((p.delay / 60) * 10) / 10 : 0,
    vias: (p.roadNumbers || []).map((v) => texto(v, 20)).filter(Boolean).slice(0, 4),
    geo: c.map(([lo, la]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]),
  };
}

export default async () => {
  const k = llave();
  if (!k) return json({ error: 'Tráfico en vivo no configurado' }, 503);
  if (!dentroDelTope('inc', entero('TOPE_INC_DIA', 400))) return json({ error: 'Tope diario alcanzado' }, 429, 'public, max-age=300');

  const pedir = async (b) => {
    const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(k)}&bbox=${b.join(',')}` +
      `&fields=${encodeURIComponent('{' + CAMPOS + '}')}&language=es-ES&timeValidityFilter=present`;
    try { return await fetch(url); } catch { return null; }
  };
  const resp = await Promise.all(FRANJAS.map(pedir));
  const buenas = resp.filter((r) => r && r.ok);
  if (!buenas.length) {
    const r = resp.find((x) => x && !x.ok);
    if (!r) return json({ error: 'No se pudo contactar a TomTom' }, 502);
    return json({ error: `TomTom respondió ${r.status}` }, r.status === 403 ? 429 : 502, 'public, max-age=120');
  }

  const vistos = new Set(), lista = [];
  for (const r of buenas) {
    let data; try { data = await r.json(); } catch { continue; }
    for (const f of data?.incidents || []) {
      const n = normalizar(f);
      if (!n) continue;
      const clave = n.id || JSON.stringify(n.geo[0]) + n.cat;
      if (vistos.has(clave)) continue;
      vistos.add(clave); lista.push(n);
      if (lista.length >= MAX_INCIDENTES) break;
    }
  }
  return new Response(JSON.stringify({
    incidentes: lista,
    parcial: buenas.length < resp.length, // alguna franja no respondió: puede faltar una parte del mapa
    actualizado: new Date().toISOString(),
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
};

export const config = { path: '/api/incidentes' };
