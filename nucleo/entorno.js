// Lee .env sin dependencias. Lo que ya esté en el entorno manda.
import { readFileSync, existsSync } from 'node:fs';

export function cargarEntorno(ruta = '.env') {
  if (!existsSync(ruta)) return {};
  const leidas = {};
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte < 0) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    leidas[clave] = valor;
    if (process.env[clave] === undefined || process.env[clave] === '') process.env[clave] = valor;
  }
  return leidas;
}
