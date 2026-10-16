// Pruebas de las funciones con TomTom simulado (no usa red ni tu llave real).
// Uso: npm test   (necesita Node 20+ y esbuild: se descarga solo con npx)
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'fn-'));
for (const f of ['estado', 'tiles', 'eta', 'ruta', 'incidentes']) {
  execSync(`npx --yes esbuild netlify/functions/${f}.mjs --bundle --format=esm --platform=node --outfile=${out}/${f}.mjs --log-level=error`, { cwd: raiz, stdio: 'inherit' });
}
const cargar = async (f) => (await import(pathToFileURL(join(out, f + '.mjs')).href));
const estado = (await cargar('estado')).default;
const tiles = await cargar('tiles');
const eta = await cargar('eta');
const ruta = await cargar('ruta');
const inc = await cargar('incidentes');

const llamadas = [];
globalThis.fetch = async (url) => {
  llamadas.push(String(url));
  if (String(url).includes('/routing/')) {
    return new Response(JSON.stringify({ routes: [{ summary: { lengthInMeters: 18500, travelTimeInSeconds: 1800, trafficDelayInSeconds: 300, noTrafficTravelTimeInSeconds: 1500 } }] }), { status: 200 });
  }
  return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
};
const ctx = (p) => ({ params: p });
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`) || n++;

// sin llave
delete process.env.TOMTOM_API_KEY;
assert.equal((await (await estado()).json()).trafico, false); ok('estado: sin llave => trafico=false');
assert.equal((await tiles.default(new Request('http://x/'), ctx({ capa: 'flujo', z: '12', x: '1', y: '1' }))).status, 503); ok('tiles: sin llave => 503');
assert.equal((await eta.default(new Request('http://x/api/eta?codigo=15'))).status, 503); ok('eta: sin llave => 503');
assert.equal(llamadas.length, 0); ok('sin llave no se llama a TomTom');

// con llave de prueba
process.env.TOMTOM_API_KEY = 'LLAVE_DE_PRUEBA';
assert.equal((await (await estado()).json()).trafico, true); ok('estado: con llave => trafico=true');
let r = await tiles.default(new Request('http://x/'), ctx({ capa: 'flujo', z: '12', x: '1024', y: '1800' }));
assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/);
assert.match(llamadas.at(-1), /flow\/relative0\/12\/1024\/1800\.png\?key=LLAVE_DE_PRUEBA/); ok('tiles flujo: URL y caché correctas');
r = await tiles.default(new Request('http://x/'), ctx({ capa: 'incidentes', z: '12', x: '1024', y: '1800' }));
assert.match(llamadas.at(-1), /incidents\/s3\//); ok('tiles incidentes: URL correcta');
assert.equal((await tiles.default(new Request('http://x/'), ctx({ capa: 'otra', z: '12', x: '1', y: '1' }))).status, 400); ok('tiles: capa inválida => 400');
assert.equal((await tiles.default(new Request('http://x/'), ctx({ capa: 'flujo', z: '3', x: '1', y: '1' }))).status, 400); ok('tiles: zoom fuera de rango => 400');
assert.equal((await tiles.default(new Request('http://x/'), ctx({ capa: 'flujo', z: '12', x: '99999', y: '1' }))).status, 400); ok('tiles: x fuera de rango => 400');

r = await eta.default(new Request('http://x/api/eta?codigo=15'));
const d = await r.json();
assert.equal(r.status, 200); assert.equal(d.min_vivo, 30); assert.equal(d.min_sin_trafico, 25); assert.equal(d.retraso_min, 5); assert.equal(d.km, 18.5);
assert.match(llamadas.at(-1), /calculateRoute\/13\.80527,-89\.23599:13\.67597,-89\.26437\/json/);
assert.match(llamadas.at(-1), /traffic=true/); ok('eta: cálculo y URL correctos (CD -> Merliot)');
assert.match(llamadas.at(-1), /travelMode=truck/); assert.match(llamadas.at(-1), /vehicleCommercial=true/); assert.match(llamadas.at(-1), /vehicleMaxSpeed=80/);
assert.ok(!/vehicleWeight/.test(llamadas.at(-1))); assert.equal(d.modo, 'camion'); assert.equal(d.margen_pct, 20); assert.equal(d.min_ajustado, 36); ok('eta: calcula como camión (80 km/h) con margen del 20 % => 30 -> 36 min');
process.env.CAMION_PESO_KG = '7500'; process.env.MARGEN_PORCENTAJE = '0'; process.env.CAMION_VEL_MAX = '70';
{ const x = await (await eta.default(new Request('http://x/api/eta?codigo=15'))).json();
  assert.match(llamadas.at(-1), /vehicleWeight=7500/); assert.match(llamadas.at(-1), /vehicleMaxSpeed=70/); assert.equal(x.min_ajustado, 30); }
delete process.env.CAMION_PESO_KG; delete process.env.MARGEN_PORCENTAJE; delete process.env.CAMION_VEL_MAX; ok('eta: peso, velocidad y margen configurables por variables de entorno');
{ const f0 = globalThis.fetch; const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return String(u).includes('travelMode=truck') ? new Response('x', { status: 400 }) : f0(u); };
  const x = await (await eta.default(new Request('http://x/api/eta?codigo=15'))).json();
  assert.equal(x.modo, 'carro'); assert.equal(urls.length, 2); globalThis.fetch = f0; ok('eta: si TomTom rechaza el modo camión, calcula como carro y lo indica'); }
r = await eta.default(new Request('http://x/api/eta?codigo=15&debug=1'));
const dbg = await r.json(); assert.equal(dbg.resumen_tomtom.trafficDelayInSeconds, 300); assert.ok(!JSON.stringify(dbg).includes('LLAVE_DE_PRUEBA')); ok('eta debug: devuelve segundos crudos sin la llave');
assert.equal((await eta.default(new Request('http://x/api/eta?codigo=CD'))).status, 400); ok('eta: no acepta CD como destino');
assert.equal((await eta.default(new Request('http://x/api/eta?codigo=999'))).status, 400); ok('eta: código desconocido => 400');

// ---- /api/ruta: mejor ruta en vivo, alternativas y tramos con tráfico ----
const decodificar = (str) => { let i = 0, la = 0, lo = 0; const o = [];
  while (i < str.length) { let b, s = 0, v = 0;
    do { b = str.charCodeAt(i++) - 63; v |= (b & 31) << s; s += 5; } while (b >= 32); la += v & 1 ? ~(v >> 1) : v >> 1;
    s = 0; v = 0; do { b = str.charCodeAt(i++) - 63; v |= (b & 31) << s; s += 5; } while (b >= 32); lo += v & 1 ? ~(v >> 1) : v >> 1;
    o.push([la / 1e5, lo / 1e5]); } return o; };
const pts = (n, d = 0) => Array.from({ length: n }, (_, i) => ({ latitude: 13.80527 - i * 0.002 + d, longitude: -89.23599 - i * 0.001 }));
const rutaTT = (seg, km, extra = {}) => ({
  summary: { lengthInMeters: km, travelTimeInSeconds: seg, trafficDelayInSeconds: extra.ret ?? 300, noTrafficTravelTimeInSeconds: seg - (extra.ret ?? 300) },
  legs: [{ points: extra.puntos || pts(12) }],
  sections: extra.sections || [],
});
{
  const f0 = globalThis.fetch; const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response(JSON.stringify({ routes: [
    rutaTT(1800, 18500, { sections: [
      { sectionType: 'TRAFFIC', startPointIndex: 3, endPointIndex: 6, simpleCategory: 'JAM', magnitudeOfDelay: 2, effectiveSpeedInKmh: 17.6, delayInSeconds: 270 },
      { sectionType: 'TRAFFIC', startPointIndex: 8, endPointIndex: 99, simpleCategory: 'ROAD_CLOSURE', magnitudeOfDelay: 4, delayInSeconds: 0 },
      { sectionType: 'TRAFFIC', startPointIndex: 5, endPointIndex: 5, simpleCategory: 'JAM', magnitudeOfDelay: 1 },
      { sectionType: 'TRAVEL_MODE', startPointIndex: 0, endPointIndex: 11 },
    ] }),
    rutaTT(2100, 21000, { ret: 60, puntos: pts(14, 0.001) }),
  ] }), { status: 200 }); };

  r = await ruta.default(new Request('http://x/api/ruta?codigo=15'));
  const x = await r.json();
  assert.equal(r.status, 200); assert.equal(x.rutas.length, 2); assert.equal(x.modo, 'camion');
  assert.match(urls.at(-1), /calculateRoute\/13\.80527,-89\.23599:13\.67597,-89\.26437\/json/);
  assert.match(urls.at(-1), /sectionType=traffic/); assert.match(urls.at(-1), /maxAlternatives=2/); assert.match(urls.at(-1), /travelMode=truck/); assert.match(urls.at(-1), /traffic=true/);
  ok('ruta: pide tramos de tráfico y 2 alternativas como camión');
  assert.equal(x.rutas[0].km, 18.5); assert.equal(x.rutas[0].min_vivo, 30); assert.equal(x.rutas[0].min_ajustado, 36);
  assert.equal(x.rutas[0].min_sin_trafico, 25); assert.equal(x.rutas[0].retraso_min, 5); assert.equal(x.rutas[1].retraso_min, 1);
  ok('ruta: tiempos, margen del 20 % y retraso por cada ruta');
  assert.equal(x.rutas[0].tramos.length, 2); // el tramo de un solo punto y el que no es de tráfico se descartan
  assert.deepEqual(x.rutas[0].tramos[0], { a: 3, b: 6, cat: 'JAM', mag: 2, vel: 18, ret: 4.5 });
  assert.equal(x.rutas[0].tramos[1].b, 11); assert.equal(x.rutas[0].tramos[1].cat, 'ROAD_CLOSURE'); assert.equal(x.rutas[0].tramos[1].mag, 4);
  ok('ruta: tramos con categoría, severidad, velocidad y demora (índices acotados a la ruta)');
  const dec = decodificar(x.rutas[0].poly), orig = pts(12);
  assert.equal(dec.length, 12); assert.ok(dec.every((p, i) => Math.abs(p[0] - orig[i].latitude) < 1e-5 && Math.abs(p[1] - orig[i].longitude) < 1e-5));
  ok('ruta: la geometría codificada se decodifica igual que la original');
  assert.ok(!JSON.stringify(x).includes('LLAVE_DE_PRUEBA')); ok('ruta: la respuesta no contiene la llave');
  assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/); ok('ruta: se cachea 5 min en el CDN');

  // si TomTom rechaza camión + alternativas (400), reintenta camión sin alternativas antes de caer a carro
  urls.length = 0;
  globalThis.fetch = async (u) => { urls.push(String(u)); return /maxAlternatives/.test(String(u)) ? new Response('x', { status: 400 }) : new Response(JSON.stringify({ routes: [rutaTT(1800, 18500)] }), { status: 200 }); };
  const y = await (await ruta.default(new Request('http://x/api/ruta?codigo=15'))).json();
  assert.equal(y.modo, 'camion'); assert.equal(y.rutas.length, 1); assert.equal(urls.length, 2); ok('ruta: sin alternativas sigue siendo camión (no cae a carro de inmediato)');
  urls.length = 0;
  globalThis.fetch = async (u) => { urls.push(String(u)); return /travelMode=truck/.test(String(u)) ? new Response('x', { status: 400 }) : new Response(JSON.stringify({ routes: [rutaTT(1800, 18500)] }), { status: 200 }); };
  const z = await (await ruta.default(new Request('http://x/api/ruta?codigo=15'))).json();
  assert.equal(z.modo, 'carro'); assert.equal(urls.length, 3); ok('ruta: si el modo camión no existe en la zona, calcula como carro y lo indica');
  urls.length = 0; globalThis.fetch = async (u) => { urls.push(String(u)); return new Response('x', { status: 401 }); };
  r = await ruta.default(new Request('http://x/api/ruta?codigo=15'));
  assert.equal(r.status, 502); assert.equal(urls.length, 1); assert.ok(!(await r.text()).includes('LLAVE_DE_PRUEBA')); ok('ruta: 401 corta de inmediato y no filtra la llave');
  globalThis.fetch = async () => new Response('x', { status: 403 });
  assert.equal((await ruta.default(new Request('http://x/api/ruta?codigo=15'))).status, 429); ok('ruta: 403 de TomTom => 429');
  globalThis.fetch = f0;
  assert.equal((await ruta.default(new Request('http://x/api/ruta?codigo=CD'))).status, 400);
  assert.equal((await ruta.default(new Request('http://x/api/ruta?codigo=999'))).status, 400);
  assert.equal((await ruta.default(new Request('http://x/api/ruta'))).status, 400); ok('ruta: solo acepta sucursales conocidas');
  process.env.TOPE_RUTA_DIA = '1';
  assert.equal((await ruta.default(new Request('http://x/api/ruta?codigo=15'))).status, 429); delete process.env.TOPE_RUTA_DIA; ok('ruta: tope diario => 429');
  const k0 = process.env.TOMTOM_API_KEY; delete process.env.TOMTOM_API_KEY;
  assert.equal((await ruta.default(new Request('http://x/api/ruta?codigo=15'))).status, 503); process.env.TOMTOM_API_KEY = k0; ok('ruta: sin llave => 503');
}

// ---- /api/incidentes: accidentes, cierres y obras reportados por TomTom ----
{
  const f0 = globalThis.fetch; const urls = [];
  const feat = (id, cat, geom, extra = {}) => ({ type: 'Feature', geometry: geom, properties: { id, iconCategory: cat, magnitudeOfDelay: 3, events: [{ description: 'Accidente', code: 201 }, { description: 'Carril bloqueado' }], startTime: '2026-10-16T13:00:00Z', endTime: null, from: 'Bulevar Constitución', to: 'Carretera a Quezaltepeque', length: 350.4, delay: 270, roadNumbers: ['CA-4'], ...extra } });
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response(JSON.stringify({ incidents: [
    feat('a1', 1, { type: 'Point', coordinates: [-89.2301, 13.8021] }),
    feat('c1', 8, { type: 'LineString', coordinates: Array.from({ length: 100 }, (_, i) => [-89.2 - i * 0.0005, 13.78]) }, { delay: null, events: [{ description: 'Cerrado' }] }),
    { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { id: 'malo', iconCategory: 1 } },
  ] }), { status: 200 }); };

  r = await inc.default(new Request('http://x/api/incidentes'));
  const x = await r.json();
  assert.equal(r.status, 200); assert.ok(urls.length >= 2, 'la red mide más de 10,000 km²: debe dividirse en franjas'); ok(`incidentes: la red se divide en ${urls.length} franjas (TomTom permite 10,000 km² por consulta)`);
  for (const u of urls) {
    assert.match(u, /traffic\/services\/5\/incidentDetails\?key=LLAVE_DE_PRUEBA/); assert.match(u, /timeValidityFilter=present/); assert.match(u, /language=es-ES/);
    const b = new URL(u).searchParams.get('bbox').split(',').map(Number);
    const km2 = (b[3] - b[1]) * 110.54 * (b[2] - b[0]) * 111.32 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180);
    assert.ok(km2 < 10000, `franja de ${Math.round(km2)} km²`);
  }
  ok('incidentes: URL correcta y cada franja queda bajo 10,000 km²');
  assert.equal(x.incidentes.length, 2); assert.equal(x.parcial, false); // el repetido entre franjas y el de geometría vacía no cuentan
  const a = x.incidentes.find((i) => i.id === 'a1');
  assert.equal(a.cat, 1); assert.equal(a.desc, 'Accidente. Carril bloqueado'); assert.equal(a.de, 'Bulevar Constitución'); assert.equal(a.ret_min, 4.5); assert.deepEqual(a.vias, ['CA-4']); assert.deepEqual(a.geo, [[13.8021, -89.2301]]);
  assert.equal(x.incidentes.find((i) => i.id === 'c1').geo.length, 30); assert.equal(x.incidentes.find((i) => i.id === 'c1').ret_min, 0);
  ok('incidentes: normaliza, quita repetidos y geometrías vacías, y reduce líneas largas');
  assert.ok(!JSON.stringify(x).includes('LLAVE_DE_PRUEBA')); assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/); ok('incidentes: no filtra la llave y se cachea 5 min');
  let n = 0; globalThis.fetch = async () => (n++ === 0 ? new Response(JSON.stringify({ incidents: [feat('z', 1, { type: 'Point', coordinates: [-89.2, 13.7] })] }), { status: 200 }) : new Response('x', { status: 500 }));
  const p = await (await inc.default(new Request('http://x/api/incidentes'))).json();
  assert.equal(p.parcial, true); assert.equal(p.incidentes.length, 1); ok('incidentes: si una franja falla, devuelve las demás y avisa que es parcial');
  globalThis.fetch = async () => new Response('x', { status: 403 });
  r = await inc.default(new Request('http://x/api/incidentes')); assert.equal(r.status, 429); assert.ok(!(await r.text()).includes('LLAVE_DE_PRUEBA')); ok('incidentes: 403 => 429 sin filtrar la llave');
  globalThis.fetch = async () => new Response('x', { status: 400 });
  r = await inc.default(new Request('http://x/api/incidentes')); assert.equal(r.status, 502); ok('incidentes: si TomTom rechaza la consulta (p. ej. el plan no la incluye) => 502 con el código');
  globalThis.fetch = f0;
  process.env.TOPE_INC_DIA = '1'; assert.equal((await inc.default(new Request('http://x/api/incidentes'))).status, 429); delete process.env.TOPE_INC_DIA; ok('incidentes: tope diario => 429');
  const k0 = process.env.TOMTOM_API_KEY; delete process.env.TOMTOM_API_KEY;
  assert.equal((await inc.default(new Request('http://x/api/incidentes'))).status, 503); process.env.TOMTOM_API_KEY = k0; ok('incidentes: sin llave => 503');
}

// error de TomTom: no debe filtrar la llave
globalThis.fetch = async () => new Response('x', { status: 403 });
r = await tiles.default(new Request('http://x/'), ctx({ capa: 'flujo', z: '12', x: '5', y: '5' }));
assert.equal(r.status, 429); assert.ok(!(await r.text()).includes('LLAVE_DE_PRUEBA')); ok('403 de TomTom => 429 sin filtrar la llave');

// tope diario
process.env.TOPE_TESELAS_DIA = '1';
globalThis.fetch = async () => new Response(new Uint8Array([1]), { status: 200 });
// el contador ya acumuló llamadas arriba; con tope=1 la siguiente debe rechazarse
r = await tiles.default(new Request('http://x/'), ctx({ capa: 'flujo', z: '12', x: '6', y: '6' }));
assert.equal(r.status, 429); ok('tope diario: supera el máximo => 429');

// la llave no aparece en ningún archivo del proyecto
for (const f of ['public/index.html', 'netlify.toml', 'README.md']) {
  try { assert.ok(!/[A-Za-z0-9]{32}/.test(readFileSync(join(raiz, f), 'utf8').replace(/[A-Za-z0-9_-]{33,}/g, ''))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
console.log(`\n${n} pruebas OK`);
