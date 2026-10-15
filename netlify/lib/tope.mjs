// Contador diario "de mejor esfuerzo" en memoria.
// Aviso honesto: cada instancia de la función tiene su propia memoria, así que
// esto NO es un tope exacto. Lo que realmente protege tu cuota es (1) la caché
// del CDN, que evita llamar a TomTom por cada visitante, y (2) el límite
// gratuito de TomTom, que responde 403 al excederse.
const contadores = new Map();

export function dentroDelTope(nombre, maximo) {
  const dia = new Date().toISOString().slice(0, 10);
  const clave = `${nombre}:${dia}`;
  const actual = contadores.get(clave) || 0;
  if (actual >= maximo) return false;
  for (const k of contadores.keys()) if (!k.endsWith(dia)) contadores.delete(k);
  contadores.set(clave, actual + 1);
  return true;
}

export function reiniciarTopes() { contadores.clear(); }

export function llave() {
  const k = (typeof process !== 'undefined' && process.env && process.env.TOMTOM_API_KEY) || '';
  return k.trim();
}

export function entero(nombre, defecto) {
  const v = parseInt(process.env[nombre], 10);
  return Number.isFinite(v) && v > 0 ? v : defecto;
}
