// Codifica una lista de [lat, lon] como polilínea de Google (precisión 1e5).
// Es el mismo formato que decodifica la página, así la ruta viaja en pocos KB.
const trozo = (n) => {
  let v = n < 0 ? ~(n << 1) : n << 1, s = '';
  while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
  return s + String.fromCharCode(v + 63);
};

export function codificar(puntos) {
  let lat = 0, lon = 0, out = '';
  for (const [la, lo] of puntos) {
    const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
    out += trozo(a - lat) + trozo(b - lon);
    lat = a; lon = b;
  }
  return out;
}
