// Codifica una lista de [lat, lon] como polilínea de Google (precisión 1e5).
// Es el mismo formato que decodifica la página, así la ruta viaja en pocos KB.
const trozo = (n) => {
  let v = n < 0 ? ~(n << 1) : n << 1, s = '';
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return s + String.fromCharCode(v + 63);
};

export function decodificar(str) {
  let i = 0, lat = 0, lon = 0;
  const out = [];
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let b, sh = 0, r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i <= str.length);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

export function codificar(puntos) {
  let lat = 0, lon = 0, out = '';
  for (const [la, lo] of puntos) {
    const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
    out += trozo(a - lat) + trozo(b - lon);
    lat = a; lon = b;
  }
  return out;
}
