// ---------------------------------------------------------------------------
// Por donde sale un mensaje. Se intenta por donde hablo el cliente la ultima
// vez; si ese canal no esta encendido, se prueba el otro; y si no hay ninguno,
// se dice claramente que hay que mandarlo a mano. Nunca se finge que salio.
// ---------------------------------------------------------------------------

import * as whatsapp from './whatsapp.js';
import * as correo from './correo.js';
import * as llamadas from './llamadas.js';

export function canalesEncendidos() {
  return {
    whatsapp: whatsapp.configurado(),
    correo: correo.configurado(),
    llamadas: llamadas.configurado(),
  };
}

/**
 * @param destino { telefono, correo, canalPreferido }
 */
export async function mandar(destino, texto, { config = null, asunto = null } = {}) {
  const intentos = [];
  const orden = [];
  if (destino.canalPreferido) orden.push(destino.canalPreferido);
  orden.push('whatsapp', 'correo');

  for (const canal of [...new Set(orden)]) {
    if (canal === 'whatsapp' && destino.telefono && whatsapp.configurado()) {
      const resultado = await whatsapp.enviar(destino.telefono, texto).catch((e) => ({ ok: false, motivo: e.message }));
      intentos.push({ canal, ...resultado });
      if (resultado.ok) return { ok: true, canal, intentos };
    }
    if (canal === 'correo' && destino.correo && correo.configurado()) {
      const resultado = await correo.enviar(destino.correo, texto, { config, asunto }).catch((e) => ({ ok: false, motivo: e.message }));
      intentos.push({ canal, ...resultado });
      if (resultado.ok) return { ok: true, canal, intentos };
    }
  }
  if (destino.telefono && llamadas.configurado()) {
    const resultado = await llamadas.enviarSms(destino.telefono, texto).catch((e) => ({ ok: false, motivo: e.message }));
    intentos.push({ canal: 'sms', ...resultado });
    if (resultado.ok) return { ok: true, canal: 'sms', intentos };
  }
  return { ok: false, motivo: 'sin-canal', intentos };
}
