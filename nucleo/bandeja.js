// ---------------------------------------------------------------------------
// La bandeja: una sola lista con lo que llega por WhatsApp, correo, telefono
// y el propio panel. Si una persona entra a contestar, el bot se aparta y no
// vuelve a hablar en esa conversacion hasta que se lo digan.
// ---------------------------------------------------------------------------

import { nuevoId } from '../datos/db.js';

export const CANALES = ['whatsapp', 'correo', 'llamada', 'panel', 'simulador'];

export function conversacionPorId(db, id) {
  return db.fila('SELECT * FROM conversaciones WHERE id = $id', { id });
}

/** Encuentra la conversacion de ese canal y ese contacto, o la abre. */
export function abrir(db, { canal, externo, clienteId = null, asunto = '' }) {
  const existente = db.fila(
    'SELECT * FROM conversaciones WHERE canal = $canal AND externo = $externo',
    { canal, externo },
  );
  if (existente) {
    if (clienteId && !existente.cliente_id) {
      db.ejecutar('UPDATE conversaciones SET cliente_id = $clienteId WHERE id = $id',
        { clienteId, id: existente.id });
      return conversacionPorId(db, existente.id);
    }
    return existente;
  }
  const id = nuevoId('conv');
  const ahora = Date.now();
  db.ejecutar(
    `INSERT INTO conversaciones (id, cliente_id, canal, externo, estado, asunto, memoria, sin_leer, ultimo_en, creada_en)
     VALUES ($id, $clienteId, $canal, $externo, 'bot', $asunto, '{}', 0, $ahora, $ahora)`,
    { id, clienteId, canal, externo, asunto, ahora },
  );
  db.apuntar('conversacion.abierta', id, { canal, externo });
  return conversacionPorId(db, id);
}

function anotar(db, { conversacionId, direccion, autor, texto, datos = {} }) {
  const id = nuevoId('msg');
  const ahora = Date.now();
  db.ejecutar(
    `INSERT INTO mensajes (id, conversacion_id, direccion, autor, texto, datos, creado_en)
     VALUES ($id, $conversacionId, $direccion, $autor, $texto, $datos, $ahora)`,
    { id, conversacionId, direccion, autor, texto: String(texto ?? ''), datos: JSON.stringify(datos), ahora },
  );
  db.ejecutar(
    `UPDATE conversaciones SET ultimo_en = $ahora,
       sin_leer = CASE WHEN $direccion = 'entrante' THEN sin_leer + 1 ELSE sin_leer END
     WHERE id = $conversacionId`,
    { ahora, direccion, conversacionId },
  );
  return db.fila('SELECT * FROM mensajes WHERE id = $id', { id });
}

export function entrante(db, conversacionId, texto, datos = {}) {
  return anotar(db, { conversacionId, direccion: 'entrante', autor: 'cliente', texto, datos });
}

export function saliente(db, conversacionId, texto, { autor = 'bot', datos = {} } = {}) {
  return anotar(db, { conversacionId, direccion: 'saliente', autor, texto, datos });
}

export function nota(db, conversacionId, texto) {
  return anotar(db, { conversacionId, direccion: 'saliente', autor: 'sistema', texto, datos: {} });
}

export function mensajesDe(db, conversacionId, { limite = 50 } = {}) {
  return db.filas(
    'SELECT * FROM mensajes WHERE conversacion_id = $conversacionId ORDER BY creado_en DESC, rowid DESC LIMIT $limite',
    { conversacionId, limite },
  ).reverse();
}

/** Memoria del cerebro de reglas: en que punto de la conversacion vamos. */
export function memoria(db, conversacionId, nueva) {
  if (nueva === undefined) {
    const fila = db.fila('SELECT memoria FROM conversaciones WHERE id = $id', { id: conversacionId });
    try { return fila ? JSON.parse(fila.memoria) : {}; } catch { return {}; }
  }
  db.ejecutar('UPDATE conversaciones SET memoria = $memoria WHERE id = $id',
    { memoria: JSON.stringify(nueva ?? {}), id: conversacionId });
  return nueva;
}

/** Una persona entra a contestar: el bot se calla en esta conversacion. */
export function tomarElMando(db, conversacionId, quien = 'panel') {
  db.ejecutar("UPDATE conversaciones SET estado = 'humano' WHERE id = $id", { id: conversacionId });
  db.apuntar('conversacion.humano', conversacionId, { quien });
  return conversacionPorId(db, conversacionId);
}

export function devolverAlBot(db, conversacionId) {
  db.ejecutar("UPDATE conversaciones SET estado = 'bot' WHERE id = $id", { id: conversacionId });
  db.apuntar('conversacion.bot', conversacionId, {});
  return conversacionPorId(db, conversacionId);
}

export function marcarLeida(db, conversacionId) {
  db.ejecutar('UPDATE conversaciones SET sin_leer = 0 WHERE id = $id', { id: conversacionId });
  return conversacionPorId(db, conversacionId);
}

/** La bandeja tal cual se ve en el panel: lo ultimo arriba. */
export function listar(db, { estado = null, canal = null, limite = 50 } = {}) {
  return db.filas(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
            (SELECT texto FROM mensajes WHERE conversacion_id = c.id ORDER BY creado_en DESC, rowid DESC LIMIT 1) AS ultimo_texto,
            (SELECT autor FROM mensajes WHERE conversacion_id = c.id ORDER BY creado_en DESC, rowid DESC LIMIT 1) AS ultimo_autor
     FROM conversaciones c
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     WHERE ($estado IS NULL OR c.estado = $estado) AND ($canal IS NULL OR c.canal = $canal)
     ORDER BY c.ultimo_en DESC LIMIT $limite`,
    { estado, canal, limite },
  );
}

export function sinLeer(db) {
  return db.valor('SELECT COUNT(*) FROM conversaciones WHERE sin_leer > 0') ?? 0;
}
