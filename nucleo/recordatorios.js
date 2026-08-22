// ---------------------------------------------------------------------------
// Recordatorios: el aviso de la vispera, el repesque de quien no vino y el
// "cuanto tiempo sin verte" de quien lleva meses sin aparecer. Se guardan
// programados en la base y alguien (el reloj del panel) los va soltando.
// ---------------------------------------------------------------------------

import { nuevoId } from '../datos/db.js';
import { claveDia, sumarDias, instanteDe, minutosDeHora } from './tiempo.js';

export const TIPOS = ['vispera', 'no_vino', 'seguimiento'];

function guardar(db, { citaId, clienteId, tipo, cuando, detalle = '' }) {
  const existente = citaId
    ? db.fila('SELECT * FROM recordatorios WHERE cita_id = $citaId AND tipo = $tipo', { citaId, tipo })
    : null;
  if (existente) {
    db.ejecutar(
      `UPDATE recordatorios SET cuando = $cuando, estado = 'pendiente', detalle = $detalle,
                                enviado_en = NULL, canal = NULL
       WHERE id = $id`,
      { id: existente.id, cuando, detalle },
    );
    return db.fila('SELECT * FROM recordatorios WHERE id = $id', { id: existente.id });
  }
  const id = nuevoId('rec');
  db.ejecutar(
    `INSERT INTO recordatorios (id, cita_id, cliente_id, tipo, cuando, estado, detalle)
     VALUES ($id, $citaId, $clienteId, $tipo, $cuando, 'pendiente', $detalle)`,
    { id, citaId: citaId ?? null, clienteId, tipo, cuando, detalle },
  );
  return db.fila('SELECT * FROM recordatorios WHERE id = $id', { id });
}

/** El aviso de la vispera, a la hora que diga la configuracion. */
export function programarDeCita(db, config, cita, { ahora = Date.now() } = {}) {
  if (!config.recordatorios.vispera || !cita) return null;
  const zona = config.negocio.zonaHoraria;
  const vispera = sumarDias(claveDia(zona, cita.inicio), -1);
  const minutos = minutosDeHora(config.recordatorios.visperaHora) ?? 18 * 60;
  const cuando = instanteDe(zona, vispera, minutos);
  if (cuando === null || cuando <= ahora || cuando >= cita.inicio) return null;
  return guardar(db, { citaId: cita.id, clienteId: cita.cliente_id, tipo: 'vispera', cuando });
}

/** Cuando alguien no aparece, queda apuntado para escribirle luego. */
export function programarNoVino(db, config, cita, { ahora = Date.now(), demoraHoras = 2 } = {}) {
  if (!config.recordatorios.avisoNoVino || !cita) return null;
  return guardar(db, {
    citaId: cita.id,
    clienteId: cita.cliente_id,
    tipo: 'no_vino',
    cuando: ahora + demoraHoras * 3600000,
  });
}

export function cancelarDeCita(db, citaId) {
  db.ejecutar(
    "UPDATE recordatorios SET estado = 'cancelado' WHERE cita_id = $citaId AND estado = 'pendiente'",
    { citaId },
  );
}

/** Los que ya toca mandar. */
export function pendientes(db, { hasta = Date.now(), limite = 100 } = {}) {
  return db.filas(
    `SELECT r.*, c.inicio AS cita_inicio, c.servicio_nombre, c.recurso_nombre, c.estado AS cita_estado,
            cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono, cl.correo AS cliente_correo
     FROM recordatorios r
     LEFT JOIN citas c ON c.id = r.cita_id
     JOIN clientes cl ON cl.id = r.cliente_id
     WHERE r.estado = 'pendiente' AND r.cuando <= $hasta
     ORDER BY r.cuando LIMIT $limite`,
    { hasta, limite },
  );
}

export function marcarEnviado(db, id, canal) {
  db.ejecutar(
    "UPDATE recordatorios SET estado = 'enviado', canal = $canal, enviado_en = $ahora WHERE id = $id",
    { id, canal, ahora: Date.now() },
  );
}

export function marcarFallido(db, id, detalle) {
  db.ejecutar(
    "UPDATE recordatorios SET estado = 'fallido', detalle = $detalle WHERE id = $id",
    { id, detalle: String(detalle).slice(0, 300) },
  );
}

/**
 * Apunta un mensaje para quien lleva mucho sin venir. No manda nada: deja la
 * lista preparada para que el negocio decida.
 */
export function programarSeguimientos(db, config, { ahora = Date.now(), limite = 25 } = {}) {
  const dias = Number(config.recordatorios.seguimientoInactivosDias ?? 0);
  if (!dias) return [];
  const corte = ahora - dias * 86400000;
  const candidatos = db.filas(
    `SELECT cl.id, cl.nombre, MAX(c.inicio) AS ultima
     FROM clientes cl
     JOIN citas c ON c.cliente_id = cl.id AND c.estado = 'atendida'
     WHERE cl.id NOT IN (
       SELECT cliente_id FROM citas WHERE estado IN ('reservada','confirmada') AND inicio >= $ahora
     )
     AND cl.id NOT IN (
       SELECT cliente_id FROM recordatorios WHERE tipo = 'seguimiento' AND (estado = 'pendiente' OR cuando > $corteAviso)
     )
     GROUP BY cl.id
     HAVING ultima < $corte
     ORDER BY ultima ASC
     LIMIT $limite`,
    { ahora, corte, corteAviso: ahora - 180 * 86400000, limite },
  );
  return candidatos.map((c) => guardar(db, {
    citaId: null,
    clienteId: c.id,
    tipo: 'seguimiento',
    cuando: ahora,
    detalle: `Última visita: ${claveDia(config.negocio.zonaHoraria, c.ultima)}`,
  }));
}

export function listar(db, { estado = null, limite = 100 } = {}) {
  return db.filas(
    `SELECT r.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono
     FROM recordatorios r JOIN clientes cl ON cl.id = r.cliente_id
     WHERE ($estado IS NULL OR r.estado = $estado)
     ORDER BY r.cuando DESC LIMIT $limite`,
    { estado, limite },
  );
}
