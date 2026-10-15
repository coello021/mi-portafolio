// Validación, comparación y reglas del reporte de cierres (funciones puras, sin red).
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
export const ESTADOS = ['Libre', 'Precaución', 'Afectada'];

const pad = (n) => String(n).padStart(2, '0');

// "13 de octubre de 2026, 8:45 a. m." (hora de El Salvador, UTC-6) o una fecha ISO -> ISO con -06:00
export function parseCorte(txt) {
  if (typeof txt !== 'string') return null;
  const m = txt.toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/);
  if (m && MESES[m[2]]) {
    let h = parseInt(m[4], 10) % 12; if (m[6] === 'p') h += 12;
    const d = new Date(`${m[3]}-${pad(MESES[m[2]])}-${pad(+m[1])}T${pad(h)}:${m[5]}:00-06:00`);
    return isNaN(d) ? null : d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(txt)) { const d = new Date(txt); return isNaN(d) ? null : d.toISOString(); }
  return null;
}

const str = (v, max) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()).slice(0, max);
const fechaOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));

export function validar(r, codigosRutas) {
  const errores = [], avisos = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, errores: ['El archivo no es un reporte válido (se esperaba un objeto JSON).'] };
  if (String(r.version) !== '1') errores.push(`Versión de reporte no soportada: ${JSON.stringify(r.version)} (se espera "1").`);
  const corte_iso = parseCorte(r.corte);
  if (!corte_iso) errores.push('No se pudo leer la fecha de corte (campo "corte").');
  else if (new Date(corte_iso) > new Date(Date.now() + 3600e3)) errores.push('La fecha de corte está en el futuro.');
  if (!Array.isArray(r.cierres) || r.cierres.length > 100) errores.push('"cierres" debe ser una lista de hasta 100 elementos.');
  if (!Array.isArray(r.rutas) || r.rutas.length > 100) errores.push('"rutas" debe ser una lista de hasta 100 elementos.');
  if (errores.length) return { ok: false, errores };

  const cierres = [], vistos = new Set();
  r.cierres.forEach((c, i) => {
    const t = `Cierre ${i + 1}`;
    if (!c || typeof c !== 'object') return errores.push(`${t}: formato inválido.`);
    const id = str(c.id, 60), lat = Number(c.lat), lon = Number(c.lon), radio = Number(c.radio_m);
    const vig = c.vigente_hasta == null || c.vigente_hasta === '' ? null : str(c.vigente_hasta, 10);
    if (!/^[a-z0-9_-]{1,60}$/i.test(id)) errores.push(`${t}: id inválido.`);
    else if (vistos.has(id)) errores.push(`${t}: id repetido (${id}).`); else vistos.add(id);
    if (!str(c.nombre, 120)) errores.push(`${t} (${id}): falta el nombre.`);
    if (!ESTADOS.includes(c.estado)) errores.push(`${t} (${id}): estado inválido (${JSON.stringify(c.estado)}).`);
    if (!(lat >= 13.0 && lat <= 14.6 && lon >= -90.2 && lon <= -87.6)) errores.push(`${t} (${id}): coordenadas fuera de El Salvador.`);
    if (!(Number.isFinite(radio) && radio >= 20 && radio <= 5000)) errores.push(`${t} (${id}): radio_m debe estar entre 20 y 5000.`);
    if (vig !== null && !fechaOk(vig)) errores.push(`${t} (${id}): vigente_hasta debe ser AAAA-MM-DD o null.`);
    cierres.push({ id, nombre: str(c.nombre, 120), estado: c.estado, tipo: str(c.tipo, 80), lon, lat, radio_m: Math.round(radio),
      detalle: str(c.detalle, 600), recomendacion: str(c.recomendacion, 600), fuente: str(c.fuente, 160), vigente_hasta: vig });
  });

  const rutas = {};
  r.rutas.forEach((x, i) => {
    const cod = str(x && x.codigo, 10);
    if (!codigosRutas.has(cod)) return avisos.push(`Ruta ${i + 1}: código "${cod}" desconocido, se ignora.`);
    if (!ESTADOS.includes(x.estado)) return errores.push(`Ruta ${cod}: estado inválido (${JSON.stringify(x.estado)}).`);
    rutas[cod] = { estado: x.estado, afectacion: str(x.afectacion, 600), recomendacion: str(x.recomendacion, 600) };
  });
  if (!Object.keys(rutas).length) errores.push('El reporte no trae ninguna ruta conocida.');
  if (errores.length) return { ok: false, errores };
  return { ok: true, avisos, limpio: { corte: str(r.corte, 80), corte_iso, cierres, rutas } };
}

const CAMPOS = ['nombre', 'estado', 'tipo', 'lon', 'lat', 'radio_m', 'detalle', 'recomendacion', 'fuente', 'vigente_hasta'];

// actual/nuevo: { cierres:[], rutas:{cod:{estado,afectacion,recomendacion}}, corte_iso }
export function comparar(actual, nuevo, nombresRutas, hoyISO) {
  const A = new Map(actual.cierres.map((c) => [c.id, c])), B = new Map(nuevo.cierres.map((c) => [c.id, c]));
  const nuevos = nuevo.cierres.filter((c) => !A.has(c.id)).map((c) => ({ id: c.id, nombre: c.nombre }));
  const quitados = actual.cierres.filter((c) => !B.has(c.id)).map((c) => ({ id: c.id, nombre: c.nombre, vigente_hasta: c.vigente_hasta }));
  const cambiados = [];
  for (const [id, b] of B) { const a = A.get(id); if (!a) continue;
    const campos = CAMPOS.filter((k) => (a[k] ?? null) !== (b[k] ?? null)); if (campos.length) cambiados.push({ id, nombre: b.nombre, campos }); }
  const rutas = [];
  for (const [cod, n] of Object.entries(nuevo.rutas)) { const a = actual.rutas[cod] || {};
    if (a.estado !== n.estado || (a.afectacion || '') !== n.afectacion || (a.recomendacion || '') !== n.recomendacion)
      rutas.push({ codigo: cod, sucursal: nombresRutas[cod] || cod, de: a.estado || null, a: n.estado, cambia_estado: a.estado !== n.estado }); }
  const hoy = hoyISO.slice(0, 10);
  const aun = quitados.filter((c) => !c.vigente_hasta || c.vigente_hasta >= hoy);
  const advertencias = [];
  if (aun.length) advertencias.push(`El reporte ya no incluye ${aun.length} cierre(s) que seguían vigentes o sin fecha de fin: ${aun.map((c) => c.nombre + (c.vigente_hasta ? ` (hasta ${c.vigente_hasta})` : '')).join('; ')}.`);
  const mejoran = rutas.filter((r) => r.cambia_estado && r.a === 'Libre' && r.de && r.de !== 'Libre');
  if (mejoran.length) advertencias.push(`${mejoran.length} ruta(s) pasarían a "Libre": ${mejoran.map((r) => r.sucursal).join(', ')}.`);
  return { cierres: { nuevos, quitados, cambiados, total_nuevo: nuevo.cierres.length, total_actual: actual.cierres.length }, rutas, advertencias };
}
