// ---------------------------------------------------------------------------
// La base de datos es un fichero SQLite. Cero dependencias: SQLite viene
// dentro de Node. Los instantes se guardan en milisegundos UTC y los precios
// en centimos, para no arrastrar decimales.
// ---------------------------------------------------------------------------

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// node:sqlite avisa de que es experimental cada vez que se carga. El aviso no
// aporta nada a quien usa Conserje, asi que lo silenciamos solo a el.
const avisarOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const texto = typeof aviso === 'string' ? aviso : (aviso?.message ?? '');
  if (texto.includes('SQLite is an experimental feature')) return undefined;
  return avisarOriginal.call(process, aviso, ...resto);
};
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = avisarOriginal;

const ESQUEMA = [
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

export function nuevoId(prefijo) {
  return `${prefijo}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * Abre (y si hace falta crea) la base. ':memory:' vale para las pruebas.
 */
export function abrirBase(ruta = 'datos/conserje.db') {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  const version = db.prepare('PRAGMA user_version').get().user_version ?? 0;
  for (let i = version; i < ESQUEMA.length; i += 1) db.exec(ESQUEMA[i]);
  if (version < ESQUEMA.length) db.exec(`PRAGMA user_version = ${ESQUEMA.length}`);

  const cache = new Map();
  const preparar = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };

  return {
    bruta: db,
    ruta,
    /** Todas las filas. */
    filas(sql, params = {}) { return preparar(sql).all(params); },
    /** La primera fila, o null. */
    fila(sql, params = {}) { return preparar(sql).get(params) ?? null; },
    /** INSERT/UPDATE/DELETE. */
    ejecutar(sql, params = {}) { return preparar(sql).run(params); },
    /** Un valor suelto. */
    valor(sql, params = {}) {
      const fila = preparar(sql).get(params);
      return fila ? Object.values(fila)[0] : null;
    },
    /**
     * Transaccion inmediata: coge el candado de escritura antes de leer, que
     * es lo que evita que dos reservas simultaneas vean el mismo hueco libre.
     */
    transaccion(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = fn();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* la transaccion ya no estaba */ }
        throw error;
      }
    },
    ajuste(clave, valor) {
      if (valor === undefined) {
        const fila = preparar('SELECT valor FROM ajustes WHERE clave = $clave').get({ clave });
        return fila ? fila.valor : null;
      }
      preparar('INSERT INTO ajustes (clave, valor) VALUES ($clave, $valor) ON CONFLICT(clave) DO UPDATE SET valor = $valor')
        .run({ clave, valor: String(valor) });
      return String(valor);
    },
    apuntar(tipo, referencia, datos = {}) {
      preparar('INSERT INTO eventos (tipo, referencia, datos, creado_en) VALUES ($tipo, $referencia, $datos, $creado_en)')
        .run({ tipo, referencia: referencia ?? null, datos: JSON.stringify(datos), creado_en: Date.now() });
    },
    cerrar() { db.close(); },
  };
}
