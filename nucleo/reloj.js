// ---------------------------------------------------------------------------
// El reloj: cada minuto mira si toca mandar algun recordatorio. Si no hay
// canal para mandarlo, no lo pierde: lo deja en "a mano" para que salga en el
// panel. Prefiero una lista de tareas a un mensaje que nadie ha recibido.
// ---------------------------------------------------------------------------

import * as recordatorios from './recordatorios.js';
import * as clientes from './clientes.js';
import * as bandeja from './bandeja.js';
import * as redaccion from './redaccion.js';
import { mandar } from '../canales/enviar.js';

function textoDe(config, recordatorio) {
  if (recordatorio.tipo === 'vispera') {
    return redaccion.recordatorioVispera(config, {
      inicio: recordatorio.cita_inicio,
      servicio_nombre: recordatorio.servicio_nombre,
      recurso_nombre: recordatorio.recurso_nombre,
    });
  }
  if (recordatorio.tipo === 'no_vino') {
    return redaccion.mensajeNoVino(config, {
      inicio: recordatorio.cita_inicio,
      servicio_nombre: recordatorio.servicio_nombre,
    });
  }
  return redaccion.mensajeSeguimiento(config, { nombre: recordatorio.cliente_nombre });
}

/** Una pasada. Devuelve que ha hecho, para poder probarlo sin esperar. */
export async function pasada(db, config, { ahora = Date.now(), enviar = mandar } = {}) {
  const hecho = { enviados: 0, aMano: 0, cancelados: 0 };
  for (const recordatorio of recordatorios.pendientes(db, { hasta: ahora })) {
    // Si la cita ya no está viva, el recordatorio sobra.
    if (recordatorio.cita_id && !['reservada', 'confirmada'].includes(recordatorio.cita_estado ?? '')
      && recordatorio.tipo === 'vispera') {
      recordatorios.cancelarDeCita(db, recordatorio.cita_id);
      hecho.cancelados += 1;
      continue;
    }
    const texto = textoDe(config, recordatorio);
    const resultado = await enviar({
      telefono: recordatorio.cliente_telefono,
      correo: recordatorio.cliente_correo,
    }, texto, { config, asunto: `${config.negocio.nombre}: recordatorio` });

    if (resultado.ok) {
      recordatorios.marcarEnviado(db, recordatorio.id, resultado.canal);
      const conversacion = bandeja.abrir(db, {
        canal: resultado.canal === 'sms' ? 'llamada' : resultado.canal,
        externo: recordatorio.cliente_telefono ?? recordatorio.cliente_correo ?? recordatorio.cliente_id,
        clienteId: recordatorio.cliente_id,
      });
      bandeja.saliente(db, conversacion.id, texto, { autor: 'bot', datos: { recordatorio: recordatorio.tipo } });
      hecho.enviados += 1;
    } else {
      db.ejecutar("UPDATE recordatorios SET estado = 'a_mano', detalle = $detalle WHERE id = $id", {
        id: recordatorio.id,
        detalle: `${texto} (${resultado.motivo})`,
      });
      hecho.aMano += 1;
    }
  }
  recordatorios.programarSeguimientos(db, config, { ahora });
  return hecho;
}

export function arrancarReloj(db, config, { cada = 60000 } = {}) {
  const tic = () => pasada(db, config).catch((error) => db.apuntar('reloj.error', null, { mensaje: error.message }));
  tic();
  const temporizador = setInterval(tic, cada);
  temporizador.unref?.();
  return () => clearInterval(temporizador);
}
