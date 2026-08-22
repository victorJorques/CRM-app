// ---------------------------------------------------------------------------
// Leer la configuración de un fichero. Es lo único del núcleo que toca el
// disco, y por eso vive aparte: así nucleo/config.js sirve igual en el
// servidor que dentro de un navegador.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { revisarConfig, ErroresConfig } from './config.js';

export function cargarConfig(ruta = 'conserje.config.json') {
  if (!existsSync(ruta)) {
    throw new ErroresConfig([
      `No encuentro ${ruta}. Copia una plantilla de plantillas/ o ejecuta: node configurar.js`,
    ]);
  }
  let bruta;
  try {
    bruta = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (error) {
    throw new ErroresConfig([`${ruta} no es un JSON válido: ${error.message}`]);
  }
  const revision = revisarConfig(bruta);
  if (!revision.ok) throw new ErroresConfig(revision.errores);
  return revision;
}
