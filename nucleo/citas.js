// ---------------------------------------------------------------------------
// Citas: reservar, mover, anular y cerrar el circulo (vino / no vino).
// Todo lo que escribe pasa por una transaccion que vuelve a comprobar el
// hueco. Si el hueco ya no esta, no se reserva: no hay medias tintas.
// ---------------------------------------------------------------------------

import { nuevoId } from '../datos/db.js';
import { servicioPorId } from './config.js';
import { comprobarHora, minutosQueOcupa, ESTADOS_ACTIVOS } from './agenda.js';
import { buscarOCrear, porId as clientePorId } from './clientes.js';
import { programarDeCita, cancelarDeCita, programarNoVino } from './recordatorios.js';

export const ESTADOS = ['reservada', 'confirmada', 'atendida', 'anulada', 'no_vino'];

export function porId(db, id) {
  return db.fila(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono, cl.correo AS cliente_correo
     FROM citas c JOIN clientes cl ON cl.id = c.cliente_id WHERE c.id = $id`,
    { id },
  );
}

export function entre(db, desde, hasta, { estados = null } = {}) {
  const filas = db.filas(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono
     FROM citas c JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.inicio >= $desde AND c.inicio < $hasta ORDER BY c.inicio`,
    { desde, hasta },
  );
  return estados ? filas.filter((f) => estados.includes(f.estado)) : filas;
}

export function deCliente(db, clienteId, { soloProximas = false, ahora = Date.now() } = {}) {
  const filas = db.filas(
    'SELECT * FROM citas WHERE cliente_id = $clienteId ORDER BY inicio DESC',
    { clienteId },
  );
  if (!soloProximas) return filas;
  return filas
    .filter((c) => c.inicio >= ahora && ESTADOS_ACTIVOS.includes(c.estado))
    .sort((a, b) => a.inicio - b.inicio);
}

function centimos(precio) {
  return precio === null || precio === undefined ? null : Math.round(Number(precio) * 100);
}

/**
 * Reserva. Devuelve { ok: false, motivo, alternativas } cuando el hueco no
 * esta libre, para que quien llame pueda ofrecer otra cosa en vez de fallar.
 */
export function reservar(db, config, {
  servicioId, inicio, recursoId = null, clienteId = null, cliente = null,
  canal = 'panel', notas = '', precio = undefined, ahora = Date.now(),
}) {
  const servicio = servicioPorId(config, servicioId);
  if (!servicio) return { ok: false, motivo: 'servicio-desconocido', alternativas: [] };
  if (!Number.isFinite(inicio)) return { ok: false, motivo: 'hora-invalida', alternativas: [] };

  return db.transaccion(() => {
    const comprobacion = comprobarHora(db, config, { servicioId, inicio, recursoId, ahora });
    if (!comprobacion.libre) {
      return { ok: false, motivo: comprobacion.motivo, detalle: comprobacion.detalle, alternativas: comprobacion.alternativas };
    }
    const ficha = clienteId ? clientePorId(db, clienteId) : buscarOCrear(db, cliente ?? {});
    if (!ficha) {
      return {
        ok: false,
        motivo: clienteId ? 'cliente-desconocido' : 'sin-contacto',
        alternativas: [],
      };
    }

    const hueco = comprobacion.hueco;
    const id = nuevoId('cita');
    const finVisible = inicio + servicio.duracionMinutos * 60000;
    const fin = inicio + minutosQueOcupa(config, servicio) * 60000;
    db.ejecutar(
      `INSERT INTO citas (id, cliente_id, servicio_id, servicio_nombre, recurso_id, recurso_nombre,
                          inicio, fin, fin_visible, estado, precio_centimos, canal, notas, creada_en, actualizada_en)
       VALUES ($id, $clienteId, $servicioId, $servicioNombre, $recursoId, $recursoNombre,
               $inicio, $fin, $finVisible, 'reservada', $precio, $canal, $notas, $ahoraReal, $ahoraReal)`,
      {
        id,
        clienteId: ficha.id,
        servicioId: servicio.id,
        servicioNombre: servicio.nombre,
        recursoId: hueco.recursoId,
        recursoNombre: hueco.recursoNombre,
        inicio,
        fin,
        finVisible,
        precio: precio === undefined ? centimos(servicio.precio) : centimos(precio),
        canal,
        notas: String(notas ?? ''),
        ahoraReal: Date.now(),
      },
    );
    db.apuntar('cita.reservada', id, { clienteId: ficha.id, servicioId: servicio.id, inicio, canal });
    const cita = porId(db, id);
    programarDeCita(db, config, cita, { ahora });
    return { ok: true, cita };
  });
}

/** Cambia la hora (y si hace falta el recurso) de una cita que sigue viva. */
export function mover(db, config, { citaId, nuevoInicio, recursoId = null, ahora = Date.now() }) {
  return db.transaccion(() => {
    const cita = porId(db, citaId);
    if (!cita) return { ok: false, motivo: 'cita-desconocida', alternativas: [] };
    if (!ESTADOS_ACTIVOS.includes(cita.estado)) return { ok: false, motivo: 'cita-no-activa', alternativas: [] };
    const servicio = servicioPorId(config, cita.servicio_id);
    if (!servicio) return { ok: false, motivo: 'servicio-desconocido', alternativas: [] };

    const comprobacion = comprobarHora(db, config, {
      servicioId: cita.servicio_id, inicio: nuevoInicio, recursoId: recursoId ?? null, ahora, excluir: citaId,
    });
    if (!comprobacion.libre) {
      return { ok: false, motivo: comprobacion.motivo, alternativas: comprobacion.alternativas };
    }
    const hueco = comprobacion.hueco;
    db.ejecutar(
      `UPDATE citas SET inicio = $inicio, fin = $fin, fin_visible = $finVisible,
                        recurso_id = $recursoId, recurso_nombre = $recursoNombre,
                        estado = 'reservada', actualizada_en = $ahoraReal
       WHERE id = $citaId`,
      {
        citaId,
        inicio: nuevoInicio,
        fin: nuevoInicio + minutosQueOcupa(config, servicio) * 60000,
        finVisible: nuevoInicio + servicio.duracionMinutos * 60000,
        recursoId: hueco.recursoId,
        recursoNombre: hueco.recursoNombre,
        ahoraReal: Date.now(),
      },
    );
    db.apuntar('cita.movida', citaId, { de: cita.inicio, a: nuevoInicio });
    const actualizada = porId(db, citaId);
    cancelarDeCita(db, citaId);
    programarDeCita(db, config, actualizada, { ahora });
    return { ok: true, cita: actualizada, anterior: cita };
  });
}

/**
 * Anula. Se permite siempre (nadie quiere pelearse con un cliente por el
 * reloj), pero se avisa de que llega tarde segun la politica del negocio.
 */
export function anular(db, config, { citaId, motivo = '', porQuien = 'panel', ahora = Date.now() }) {
  const cita = porId(db, citaId);
  if (!cita) return { ok: false, motivo: 'cita-desconocida' };
  if (cita.estado === 'anulada') return { ok: true, cita, yaEstaba: true, tarde: false };
  const margen = (config.reglas.cancelacionMinimaHoras ?? 0) * 3600000;
  const tarde = cita.inicio - ahora < margen;
  db.ejecutar(
    `UPDATE citas SET estado = 'anulada', notas = TRIM($notas || CASE WHEN notas = '' THEN '' ELSE ' · ' || notas END),
                      actualizada_en = $ahoraReal WHERE id = $citaId`,
    { citaId, notas: motivo ? `Anulada: ${motivo}` : 'Anulada', ahoraReal: Date.now() },
  );
  cancelarDeCita(db, citaId);
  db.apuntar('cita.anulada', citaId, { motivo, porQuien, tarde });
  return { ok: true, cita: porId(db, citaId), tarde };
}

/** Cierra el circulo: vino, no vino, o confirmada tras el recordatorio. */
export function marcar(db, config, { citaId, estado, precio = undefined, ahora = Date.now() }) {
  if (!ESTADOS.includes(estado)) return { ok: false, motivo: 'estado-desconocido' };
  const cita = porId(db, citaId);
  if (!cita) return { ok: false, motivo: 'cita-desconocida' };
  const params = { citaId, estado, ahoraReal: Date.now() };
  let sql = 'UPDATE citas SET estado = $estado, actualizada_en = $ahoraReal';
  if (precio !== undefined) {
    sql += ', precio_centimos = $precio';
    params.precio = centimos(precio);
  }
  db.ejecutar(`${sql} WHERE id = $citaId`, params);
  if (estado === 'anulada' || estado === 'no_vino') cancelarDeCita(db, citaId);
  const actualizada = porId(db, citaId);
  if (estado === 'no_vino') programarNoVino(db, config, actualizada, { ahora });
  db.apuntar(`cita.${estado}`, citaId, {});
  return { ok: true, cita: actualizada };
}

export function notas(db, citaId, texto) {
  db.ejecutar('UPDATE citas SET notas = $texto, actualizada_en = $ahora WHERE id = $citaId',
    { citaId, texto: String(texto ?? ''), ahora: Date.now() });
  return porId(db, citaId);
}

/** Las de hoy que ya pasaron y siguen sin cerrar: la lista de "quien vino". */
export function pendientesDeCerrar(db, { ahora = Date.now(), desde = null } = {}) {
  return db.filas(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono
     FROM citas c JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.estado IN ('reservada','confirmada') AND c.fin_visible < $ahora
       AND ($desde IS NULL OR c.inicio >= $desde)
     ORDER BY c.inicio`,
    { ahora, desde },
  );
}
