// ---------------------------------------------------------------------------
// El esquema, en un fichero aparte porque lo usan dos sitios: la base de
// verdad (datos/db.js) y la de la demostración web (demo-web/db-web.js).
//
// Para cambiar el esquema, añade un elemento nuevo AL FINAL de la lista y no
// toques los anteriores: `PRAGMA user_version` lleva la cuenta de por dónde va
// cada base instalada.
// ---------------------------------------------------------------------------

export const ESQUEMA = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS clientes (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL DEFAULT '',
    telefono       TEXT,
    correo         TEXT,
    notas          TEXT NOT NULL DEFAULT '',
    etiquetas      TEXT NOT NULL DEFAULT '',
    creado_en      INTEGER NOT NULL,
    actualizado_en INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS clientes_telefono ON clientes(telefono) WHERE telefono IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS clientes_correo ON clientes(correo) WHERE correo IS NOT NULL;

  CREATE TABLE IF NOT EXISTS citas (
    id               TEXT PRIMARY KEY,
    cliente_id       TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    servicio_id      TEXT NOT NULL,
    servicio_nombre  TEXT NOT NULL,
    recurso_id       TEXT NOT NULL,
    recurso_nombre   TEXT NOT NULL,
    inicio           INTEGER NOT NULL,
    fin              INTEGER NOT NULL,
    fin_visible      INTEGER NOT NULL,
    estado           TEXT NOT NULL DEFAULT 'reservada',
    precio_centimos  INTEGER,
    canal            TEXT NOT NULL DEFAULT 'panel',
    notas            TEXT NOT NULL DEFAULT '',
    creada_en        INTEGER NOT NULL,
    actualizada_en   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS citas_por_inicio ON citas(inicio);
  CREATE INDEX IF NOT EXISTS citas_por_recurso ON citas(recurso_id, inicio);
  CREATE INDEX IF NOT EXISTS citas_por_cliente ON citas(cliente_id, inicio);

  CREATE TABLE IF NOT EXISTS conversaciones (
    id          TEXT PRIMARY KEY,
    cliente_id  TEXT REFERENCES clientes(id) ON DELETE SET NULL,
    canal       TEXT NOT NULL,
    externo     TEXT NOT NULL,
    estado      TEXT NOT NULL DEFAULT 'bot',
    asunto      TEXT NOT NULL DEFAULT '',
    memoria     TEXT NOT NULL DEFAULT '{}',
    sin_leer    INTEGER NOT NULL DEFAULT 0,
    ultimo_en   INTEGER NOT NULL,
    creada_en   INTEGER NOT NULL,
    UNIQUE(canal, externo)
  );

  CREATE TABLE IF NOT EXISTS mensajes (
    id              TEXT PRIMARY KEY,
    conversacion_id TEXT NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
    direccion       TEXT NOT NULL,
    autor           TEXT NOT NULL,
    texto           TEXT NOT NULL,
    datos           TEXT NOT NULL DEFAULT '{}',
    creado_en       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mensajes_por_conversacion ON mensajes(conversacion_id, creado_en);

  CREATE TABLE IF NOT EXISTS recordatorios (
    id         TEXT PRIMARY KEY,
    cita_id    TEXT REFERENCES citas(id) ON DELETE CASCADE,
    cliente_id TEXT NOT NULL,
    tipo       TEXT NOT NULL,
    cuando     INTEGER NOT NULL,
    estado     TEXT NOT NULL DEFAULT 'pendiente',
    canal      TEXT,
    enviado_en INTEGER,
    detalle    TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS recordatorios_unicos ON recordatorios(cita_id, tipo) WHERE cita_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS recordatorios_pendientes ON recordatorios(estado, cuando);

  CREATE TABLE IF NOT EXISTS eventos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo       TEXT NOT NULL,
    referencia TEXT,
    datos      TEXT NOT NULL DEFAULT '{}',
    creado_en  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS eventos_por_fecha ON eventos(creado_en);

  CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );
  `,
];
