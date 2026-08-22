// ---------------------------------------------------------------------------
// La misma base de datos, pero dentro del navegador. Conserje habla con SQLite
// a través de un solo sitio (`abrirBase`), así que para llevarlo a una página
// web basta con reescribir ese sitio: el resto del programa no se entera.
//
// Aquí SQLite es sql.js (el propio SQLite compilado a WebAssembly) y la base
// vive en memoria: al recargar la página se empieza de cero, que es justo lo
// que se quiere en una demostración.
// ---------------------------------------------------------------------------

import { ESQUEMA } from '../datos/esquema.js';

export function nuevoId(prefijo) {
  const azar = crypto.getRandomValues(new Uint8Array(8));
  return `${prefijo}_${[...azar].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

let SQL = null;

/** Hay que llamarla una vez antes de abrir ninguna base. */
export async function prepararSql(cargar) {
  SQL = await cargar();
  return SQL;
}

function normalizar(params) {
  const limpios = {};
  for (const [clave, valor] of Object.entries(params ?? {})) {
    limpios[`$${clave}`] = valor === undefined ? null : valor;
  }
  return limpios;
}

export function abrirBase() {
  if (!SQL) throw new Error('Llama antes a prepararSql()');
  const db = new SQL.Database();
  for (const paso of ESQUEMA) db.run(paso);

  const consultar = (sql, params) => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(normalizar(params));
      const filas = [];
      while (stmt.step()) filas.push(stmt.getAsObject());
      return filas;
    } finally {
      stmt.free();
    }
  };

  return {
    bruta: db,
    ruta: ':memoria-del-navegador:',
    filas: (sql, params = {}) => consultar(sql, params),
    fila: (sql, params = {}) => consultar(sql, params)[0] ?? null,
    ejecutar(sql, params = {}) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(normalizar(params));
        stmt.step();
      } finally {
        stmt.free();
      }
      return { changes: db.getRowsModified() };
    },
    valor(sql, params = {}) {
      const fila = consultar(sql, params)[0];
      return fila ? Object.values(fila)[0] : null;
    },
    // Una sola pestaña, un solo hilo: no hay dos escrituras a la vez, pero se
    // mantiene la transacción para que el código sea el mismo que en el servidor.
    transaccion(fn) {
      db.run('BEGIN');
      try {
        const resultado = fn();
        db.run('COMMIT');
        return resultado;
      } catch (error) {
        try { db.run('ROLLBACK'); } catch { /* ya no estaba */ }
        throw error;
      }
    },
    ajuste(clave, valor) {
      if (valor === undefined) {
        const fila = consultar('SELECT valor FROM ajustes WHERE clave = $clave', { clave })[0];
        return fila ? fila.valor : null;
      }
      this.ejecutar(
        'INSERT INTO ajustes (clave, valor) VALUES ($clave, $valor) ON CONFLICT(clave) DO UPDATE SET valor = $valor',
        { clave, valor: String(valor) },
      );
      return String(valor);
    },
    apuntar(tipo, referencia, datos = {}) {
      this.ejecutar(
        'INSERT INTO eventos (tipo, referencia, datos, creado_en) VALUES ($tipo, $referencia, $datos, $creado)',
        { tipo, referencia: referencia ?? null, datos: JSON.stringify(datos), creado: Date.now() },
      );
    },
    cerrar() { db.close(); },
  };
}
