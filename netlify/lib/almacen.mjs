import cierresBase from '../../public/data/cierres.json';
import rutasBase from '../../public/data/rutas.json';
import metaBase from '../../public/data/meta.json';

// Almacenamiento (Netlify Blobs). En las pruebas se reemplaza con globalThis.__ALMACEN__.
export async function almacen() {
  if (globalThis.__ALMACEN__) return globalThis.__ALMACEN__;
  const { getStore } = await import('@netlify/blobs');
  return getStore('reporte-vmt');
}

export const nombresRutas = Object.fromEntries(rutasBase.map((r) => [String(r.codigo), r.sucursal]));
export const codigosRutas = new Set(Object.keys(nombresRutas));

export function base() {
  return {
    origen: 'base', corte: metaBase.corte, corte_iso: metaBase.corte_iso, cierres: cierresBase,
    rutas: Object.fromEntries(rutasBase.map((r) => [String(r.codigo), { estado: r.estado, afectacion: r.afectacion || '', recomendacion: r.recomendacion || '' }])),
  };
}

// Devuelve lo publicado: el último reporte subido o, si no hay, los datos base del proyecto.
export async function leerActual() {
  try {
    const s = await almacen();
    const v = await s.get('actual', { type: 'json' });
    if (v && v.corte_iso && Array.isArray(v.cierres)) return { ...v, origen: 'subido' };
  } catch (e) { return { ...base(), aviso: 'almacen_no_disponible' }; }
  return base();
}
