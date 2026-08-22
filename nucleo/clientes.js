// ---------------------------------------------------------------------------
// Fichas de cliente. Se crean solas: la primera vez que alguien escribe o
// pide cita ya tiene ficha, aunque solo sepamos su telefono.
// ---------------------------------------------------------------------------

import { nuevoId } from '../datos/db.js';
import { sinTildes } from './config.js';

/** Deja el telefono en formato +34600111222 cuando se puede reconocer. */
export function normalizarTelefono(valor, prefijoPais = '34') {
  if (!valor) return null;
  let t = String(valor).trim().replace(/[\s().-]/g, '');
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (!t.startsWith('+')) {
    const soloDigitos = t.replace(/\D/g, '');
    if (soloDigitos.length === 9) t = `+${prefijoPais}${soloDigitos}`;
    else if (soloDigitos.length > 9) t = `+${soloDigitos}`;
    else return null;
  }
  return /^\+\d{6,15}$/.test(t) ? t : null;
}

export function normalizarCorreo(valor) {
  if (!valor) return null;
  const c = String(valor).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) ? c : null;
}

function filaACliente(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono,
    correo: fila.correo,
    notas: fila.notas,
    etiquetas: fila.etiquetas ? fila.etiquetas.split(',').filter(Boolean) : [],
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

export function porId(db, id) {
  return filaACliente(db.fila('SELECT * FROM clientes WHERE id = $id', { id }));
}

export function porTelefono(db, telefono) {
  const t = normalizarTelefono(telefono);
  if (!t) return null;
  return filaACliente(db.fila('SELECT * FROM clientes WHERE telefono = $t', { t }));
}

export function porCorreo(db, correo) {
  const c = normalizarCorreo(correo);
  if (!c) return null;
  return filaACliente(db.fila('SELECT * FROM clientes WHERE correo = $c', { c }));
}

/**
 * Busca por telefono o correo y, si no hay nadie, crea la ficha. Si ya existe
 * y llega un dato nuevo (el nombre, el correo), lo completa sin pisar nada.
 */
export function buscarOCrear(db, { telefono, correo, nombre } = {}) {
  const t = normalizarTelefono(telefono);
  const c = normalizarCorreo(correo);
  const nombreLimpio = nombre ? String(nombre).trim().slice(0, 80) : '';
  const existente = (t && porTelefono(db, t)) || (c && porCorreo(db, c)) || null;
  const ahora = Date.now();

  if (existente) {
    const cambios = {};
    if (!existente.nombre && nombreLimpio) cambios.nombre = nombreLimpio;
    if (!existente.telefono && t) cambios.telefono = t;
    if (!existente.correo && c) cambios.correo = c;
    return Object.keys(cambios).length ? actualizar(db, existente.id, cambios) : existente;
  }

  const id = nuevoId('cli');
  db.ejecutar(
    `INSERT INTO clientes (id, nombre, telefono, correo, creado_en, actualizado_en)
     VALUES ($id, $nombre, $telefono, $correo, $ahora, $ahora)`,
    { id, nombre: nombreLimpio, telefono: t, correo: c, ahora },
  );
  db.apuntar('cliente.creado', id, { telefono: t, correo: c });
  return porId(db, id);
}

export function actualizar(db, id, cambios) {
  const actual = porId(db, id);
  if (!actual) return null;
  const campos = [];
  const params = { id, ahora: Date.now() };
  const permitidos = { nombre: 'nombre', telefono: 'telefono', correo: 'correo', notas: 'notas' };
  for (const [clave, columna] of Object.entries(permitidos)) {
    if (cambios[clave] === undefined) continue;
    let valor = cambios[clave];
    if (clave === 'telefono') valor = normalizarTelefono(valor);
    if (clave === 'correo') valor = normalizarCorreo(valor);
    if (clave === 'nombre') valor = String(valor).trim().slice(0, 80);
    campos.push(`${columna} = $${clave}`);
    params[clave] = valor ?? null;
  }
  if (cambios.etiquetas !== undefined) {
    campos.push('etiquetas = $etiquetas');
    params.etiquetas = (Array.isArray(cambios.etiquetas) ? cambios.etiquetas : []).join(',');
  }
  if (campos.length === 0) return actual;
  db.ejecutar(`UPDATE clientes SET ${campos.join(', ')}, actualizado_en = $ahora WHERE id = $id`, params);
  return porId(db, id);
}

/** Ficha completa: quien es, que ha gastado, cuantas veces no vino y su historial. */
export function ficha(db, id, { limiteCitas = 50 } = {}) {
  const cliente = porId(db, id);
  if (!cliente) return null;
  const citas = db.filas(
    'SELECT * FROM citas WHERE cliente_id = $id ORDER BY inicio DESC LIMIT $limite',
    { id, limite: limiteCitas },
  );
  const totales = db.fila(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN estado = 'atendida' THEN 1 ELSE 0 END) AS atendidas,
       SUM(CASE WHEN estado = 'no_vino'  THEN 1 ELSE 0 END) AS noVino,
       SUM(CASE WHEN estado = 'anulada'  THEN 1 ELSE 0 END) AS anuladas,
       SUM(CASE WHEN estado = 'atendida' THEN COALESCE(precio_centimos, 0) ELSE 0 END) AS gastoCentimos,
       MAX(CASE WHEN estado = 'atendida' THEN inicio END) AS ultimaVisita
     FROM citas WHERE cliente_id = $id`,
    { id },
  );
  const proxima = db.fila(
    `SELECT * FROM citas WHERE cliente_id = $id AND estado IN ('reservada','confirmada') AND inicio >= $ahora
     ORDER BY inicio LIMIT 1`,
    { id, ahora: Date.now() },
  );
  return {
    ...cliente,
    citas,
    proxima,
    total: totales.total ?? 0,
    atendidas: totales.atendidas ?? 0,
    noVino: totales.noVino ?? 0,
    anuladas: totales.anuladas ?? 0,
    gastoCentimos: totales.gastoCentimos ?? 0,
    ultimaVisita: totales.ultimaVisita ?? null,
  };
}

/** Listado del panel, con busqueda por nombre o telefono. */
export function listar(db, { busqueda = '', limite = 100, desplazamiento = 0 } = {}) {
  const texto = sinTildes(busqueda).trim();
  const filas = db.filas(
    `SELECT c.*,
            (SELECT COUNT(*) FROM citas WHERE cliente_id = c.id) AS citas,
            (SELECT MAX(inicio) FROM citas WHERE cliente_id = c.id AND estado = 'atendida') AS ultimaVisita
     FROM clientes c
     ORDER BY c.actualizado_en DESC
     LIMIT $limite OFFSET $desplazamiento`,
    { limite: 500, desplazamiento: 0 },
  );
  const filtradas = texto
    ? filas.filter((f) => sinTildes(f.nombre).includes(texto)
      || (f.telefono ?? '').includes(texto)
      || sinTildes(f.correo ?? '').includes(texto))
    : filas;
  return filtradas.slice(desplazamiento, desplazamiento + limite).map((f) => ({
    ...filaACliente(f), citas: f.citas, ultimaVisita: f.ultimaVisita,
  }));
}

/** Quien lleva mucho sin aparecer: la lista para escribirles. */
export function inactivos(db, { dias, limite = 50, ahora = Date.now() } = {}) {
  const corte = ahora - dias * 86400000;
  return db.filas(
    `SELECT c.*, MAX(ci.inicio) AS ultimaVisita
     FROM clientes c
     JOIN citas ci ON ci.cliente_id = c.id AND ci.estado = 'atendida'
     WHERE c.id NOT IN (
       SELECT cliente_id FROM citas WHERE estado IN ('reservada','confirmada') AND inicio >= $ahora
     )
     GROUP BY c.id
     HAVING ultimaVisita < $corte
     ORDER BY ultimaVisita ASC
     LIMIT $limite`,
    { corte, ahora, limite },
  ).map((f) => ({ ...filaACliente(f), ultimaVisita: f.ultimaVisita }));
}
