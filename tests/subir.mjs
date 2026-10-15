// Pruebas de la subida de reportes (almacenamiento simulado en memoria).
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'sub-'));
for (const f of ['subir', 'cierres'])
  execSync(`npx --yes esbuild netlify/functions/${f}.mjs --bundle --format=esm --platform=node --outfile=${out}/${f}.mjs --log-level=error`, { cwd: raiz, stdio: 'inherit' });
execSync(`npx --yes esbuild netlify/lib/reporte.mjs --bundle --format=esm --platform=node --outfile=${out}/reporte.mjs --log-level=error`, { cwd: raiz, stdio: 'inherit' });
const imp = async (f) => import(pathToFileURL(join(out, f + '.mjs')).href);
const subir = (await imp('subir')).default, cierres = (await imp('cierres')).default, { parseCorte } = await imp('reporte');

// almacenamiento falso
const datos = new Map();
globalThis.__ALMACEN__ = {
  get: async (k) => datos.get(k) ?? null,
  setJSON: async (k, v) => { datos.set(k, JSON.parse(JSON.stringify(v))); },
  list: async ({ prefix }) => ({ blobs: [...datos.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  delete: async (k) => { datos.delete(k); },
};
let n = 0; const ok = (m) => console.log(`  ✓ ${m}`) || n++;
const post = (body, ip = '1.1.1.1') => subir(new Request('http://x/api/cierres/subir', { method: 'POST', body: JSON.stringify(body) }), { ip });
const leer = (f) => JSON.parse(readFileSync(join(raiz, 'public/data', f), 'utf8'));

// fechas
assert.equal(parseCorte('13 de octubre de 2026, 8:45 a. m.'), '2026-10-13T14:45:00.000Z');
assert.equal(parseCorte('14 de octubre de 2026, 3:00 p. m.'), '2026-10-14T21:00:00.000Z');
assert.equal(parseCorte('12 de octubre de 2026, 12:10 a. m.'), '2026-10-12T06:10:00.000Z');
assert.equal(parseCorte('texto raro'), null); ok('fechas de corte en español se leen bien (hora de El Salvador)');

// sin PIN configurado
delete process.env.ADMIN_PIN;
assert.equal((await post({ pin: 'x', reporte: {} })).status, 503); ok('sin ADMIN_PIN => 503');
process.env.ADMIN_PIN = 'pin-de-prueba';

assert.equal((await post({ pin: 'mal', reporte: {} }, '2.2.2.2')).status, 401); ok('PIN incorrecto => 401');
for (let i = 0; i < 5; i++) await post({ pin: "mal", reporte: {} }, "3.3.3.3");
assert.equal((await post({ pin: 'pin-de-prueba', reporte: {} }, '3.3.3.3')).status, 429); ok('5 fallos seguidos => bloqueo 429');

// reporte más nuevo construido a partir de los datos base
const cierresBase = leer('cierres.json'), rutasBase = leer('rutas.json');
const nuevo = {
  version: '1', corte: '15 de octubre de 2026, 10:00 a. m.', generado: new Date().toISOString(),
  cierres: [
    ...cierresBase.filter((c) => c.id !== 'bacheo_blvd_ejercito'),
    { id: 'obra_nueva', nombre: 'Obra nueva de prueba', estado: 'Precaución', tipo: 'carril cerrado', lon: -89.2, lat: 13.7, radio_m: 300, detalle: 'x', recomendacion: 'y', fuente: 'prueba', vigente_hasta: '2026-10-20' },
  ],
  rutas: rutasBase.map((r) => ({ codigo: r.codigo, estado: r.codigo === '59' ? 'Libre' : r.estado, afectacion: r.afectacion, recomendacion: r.recomendacion })),
};
let r = await post({ pin: 'pin-de-prueba', reporte: nuevo });
let d = await r.json();
assert.equal(r.status, 200); assert.equal(d.modo, 'previa');
assert.equal(d.diferencias.cierres.nuevos.length, 1); assert.equal(d.diferencias.cierres.quitados.length, 1);
assert.ok(d.diferencias.advertencias.some((a) => /seguían vigentes/.test(a))); ok('previa: detecta cierre nuevo, cierre quitado y avisa de uno aún vigente');
assert.equal(datos.size, 0); ok('previa no guarda nada');

// coordenadas fuera del país
const malo = structuredClone(nuevo); malo.cierres[0].lat = 40;
r = await post({ pin: 'pin-de-prueba', reporte: malo }); assert.equal(r.status, 422); ok('coordenadas fuera de El Salvador => 422');
const malo2 = structuredClone(nuevo); malo2.cierres[0].estado = 'Roto';
assert.equal((await post({ pin: 'pin-de-prueba', reporte: malo2 })).status, 422); ok('estado inválido => 422');

// aplicar
r = await post({ pin: 'pin-de-prueba', reporte: nuevo, modo: 'aplicar' }); d = await r.json();
assert.equal(r.status, 200); assert.equal(d.modo, 'aplicado'); ok('aplicar => 200');
let pub = await (await cierres()).json();
assert.equal(pub.origen, 'subido'); assert.equal(pub.cierres.length, cierresBase.length); assert.equal(pub.rutas['59'].estado, 'Libre'); ok('/api/cierres ahora devuelve el reporte subido');

// no retroceder
r = await post({ pin: 'pin-de-prueba', reporte: nuevo, modo: 'aplicar' });
assert.equal(r.status, 409); ok('mismo corte otra vez => 409 (no retrocede)');
const viejo = structuredClone(nuevo); viejo.corte = '14 de octubre de 2026, 9:00 a. m.';
r = await post({ pin: 'pin-de-prueba', reporte: viejo, modo: 'aplicar' }); assert.equal(r.status, 409); ok('corte más viejo => 409');

// otro más nuevo guarda historial
const mas = structuredClone(nuevo); mas.corte = '15 de octubre de 2026, 11:00 a. m.';
assert.equal((await post({ pin: 'pin-de-prueba', reporte: mas, modo: 'aplicar' })).status, 200);
assert.equal([...datos.keys()].filter((k) => k.startsWith('historial/')).length, 1); ok('guarda la versión anterior en el historial');

// archivo real de la usuaria (corte 13 oct) contra los datos base: debe rechazarse
datos.clear();
const real = '/root/.claude/uploads/b45e392b-7db1-5512-acc5-78b569bb8ecf/5f6d147c-reporte_vidri.json';
if (existsSync(real)) { r = await post({ pin: 'pin-de-prueba', reporte: JSON.parse(readFileSync(real, 'utf8')) }); d = await r.json();
  assert.equal(r.status, 409); ok('reporte real del 13 oct vs publicado del 14 oct => rechazado'); }

// almacenamiento caído
globalThis.__ALMACEN__ = { get: async () => { throw new Error('caído'); } };
assert.equal((await post({ pin: 'pin-de-prueba', reporte: nuevo })).status, 503); ok('almacenamiento caído => 503 sin cambiar nada');
const g = await (await cierres()).json(); assert.equal(g.origen, 'base'); assert.equal(g.aviso, 'almacen_no_disponible'); ok('/api/cierres cae a los datos base');
console.log(`\n${n} pruebas OK`);
