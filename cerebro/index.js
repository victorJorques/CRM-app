// ---------------------------------------------------------------------------
// Quien contesta. Elige cerebro, guarda lo dicho en la bandeja y se calla
// cuando una persona ha entrado a llevar la conversacion.
// ---------------------------------------------------------------------------

import * as bandeja from '../nucleo/bandeja.js';
import * as clientes from '../nucleo/clientes.js';
import * as reglas from './reglas.js';
import * as claude from './claude.js';

export function cerebroDisponible() {
  return claude.hayClave() ? 'claude' : 'reglas';
}

/**
 * Un mensaje entra, sale (o no) una respuesta. Nunca lanza: si el modelo
 * falla, contesta el cerebro de reglas y queda apuntado.
 */
export async function contestar({
  db, config, canal, externo, texto, contacto = {}, ahora = Date.now(), forzarCerebro = null,
}) {
  // La ficha se crea sola en cuanto sabemos por donde nos escriben: eso es lo
  // que hace que el historial exista sin que nadie de nada de alta.
  const clienteExistente = (contacto.telefono || contacto.correo)
    ? clientes.buscarOCrear(db, contacto)
    : null;
  let conversacion = bandeja.abrir(db, {
    canal, externo, clienteId: clienteExistente?.id ?? null,
  });
  bandeja.entrante(db, conversacion.id, texto, { contacto });

  if (conversacion.estado === 'humano') {
    return { silencio: true, motivo: 'la lleva una persona', conversacion, texto: null, acciones: [] };
  }

  const ctx = {
    db,
    config,
    conversacion,
    contacto,
    canal,
    ahora,
    memoria: bandeja.memoria(db, conversacion.id),
    cliente: clienteExistente,
    historial: claude.historial(bandeja.mensajesDe(db, conversacion.id, { limite: 24 }).slice(0, -1)),
  };

  const elegido = forzarCerebro ?? cerebroDisponible();
  let resultado;
  let cerebro = elegido;

  if (elegido === 'claude') {
    try {
      resultado = await claude.responder(texto, ctx);
    } catch (error) {
      db.apuntar('cerebro.caida', conversacion.id, { mensaje: error.message });
      cerebro = 'reglas';
      resultado = reglas.responder(texto, ctx);
    }
  } else {
    resultado = reglas.responder(texto, ctx);
  }

  bandeja.memoria(db, conversacion.id, resultado.memoria ?? {});
  if (resultado.texto) {
    bandeja.saliente(db, conversacion.id, resultado.texto, { autor: 'bot', datos: { cerebro } });
  }
  conversacion = bandeja.conversacionPorId(db, conversacion.id);

  return { ...resultado, cerebro, conversacion, acciones: resultado.acciones ?? [] };
}
