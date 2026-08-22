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

import { ESQUEMA } from './esquema.js';

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
