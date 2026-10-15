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
for (const f of ['estado', 'tiles', 'eta']) {
  execSync(`npx --yes esbuild netlify/functions/${f}.mjs --bundle --format=esm --platform=node --outfile=${out}/${f}.mjs --log-level=error`, { cwd: raiz, stdio: 'inherit' });
}
const cargar = async (f) => (await import(pathToFileURL(join(out, f + '.mjs')).href));
const estado = (await cargar('estado')).default;
const tiles = await cargar('tiles');
const eta = await cargar('eta');

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
r = await eta.default(new Request('http://x/api/eta?codigo=15&debug=1'));
const dbg = await r.json(); assert.equal(dbg.resumen_tomtom.trafficDelayInSeconds, 300); assert.ok(!JSON.stringify(dbg).includes('LLAVE_DE_PRUEBA')); ok('eta debug: devuelve segundos crudos sin la llave');
assert.equal((await eta.default(new Request('http://x/api/eta?codigo=CD'))).status, 400); ok('eta: no acepta CD como destino');
assert.equal((await eta.default(new Request('http://x/api/eta?codigo=999'))).status, 400); ok('eta: código desconocido => 400');

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
