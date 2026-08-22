// ---------------------------------------------------------------------------
// Sacar los datos. Dos motivos, los dos serios:
//   · que el negocio pueda irse con lo suyo cuando quiera, sin pedir permiso;
//   · que un cliente pida "dime qué tienes mío" y se le pueda contestar.
//
// Aquí solo se arman los textos. Escribirlos en disco es cosa de exportar.js.
// ---------------------------------------------------------------------------

import { fechaYHora, claveDia } from './tiempo.js';

/** Una celda de CSV, con las comillas y los saltos de línea bien puestos. */
export function celda(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (!/[";\n\r]/.test(texto)) return texto;
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * CSV separado por punto y coma, que es lo que espera un Excel en español, y
 * con marca de UTF-8 para que los acentos no salgan rotos al abrirlo.
 */
export function csv(cabeceras, filas, { conMarcaUtf8 = true } = {}) {
  const lineas = [cabeceras.map(celda).join(';')];
  for (const fila of filas) lineas.push(fila.map(celda).join(';'));
  return `${conMarcaUtf8 ? '﻿' : ''}${lineas.join('\r\n')}\r\n`;
}

const euros = (centimos) => (centimos === null || centimos === undefined ? '' : (centimos / 100).toFixed(2).replace('.', ','));

export function clientesCsv(db, config, { clienteId = null } = {}) {
  const filas = db.filas(
    `SELECT c.*,
            (SELECT COUNT(*) FROM citas WHERE cliente_id = c.id AND estado = 'atendida') AS atendidas,
            (SELECT COUNT(*) FROM citas WHERE cliente_id = c.id AND estado = 'no_vino') AS ausencias,
            (SELECT SUM(COALESCE(precio_centimos, 0)) FROM citas WHERE cliente_id = c.id AND estado = 'atendida') AS gasto,
            (SELECT MAX(inicio) FROM citas WHERE cliente_id = c.id AND estado = 'atendida') AS ultima
     FROM clientes c
     WHERE ($clienteId IS NULL OR c.id = $clienteId)
     ORDER BY c.nombre`,
    { clienteId },
  );
  const zona = config.negocio.zonaHoraria;
  return csv(
    ['id', 'nombre', 'telefono', 'correo', 'notas', 'etiquetas', 'visitas', 'ausencias', 'gastado', 'ultima visita', 'alta'],
    filas.map((f) => [
      f.id, f.nombre, f.telefono, f.correo, f.notas, f.etiquetas,
      f.atendidas ?? 0, f.ausencias ?? 0, euros(f.gasto),
      f.ultima ? claveDia(zona, f.ultima) : '',
      claveDia(zona, f.creado_en),
    ]),
  );
}

export function citasCsv(db, config, { desde = null, clienteId = null } = {}) {
  const filas = db.filas(
    `SELECT ci.*, cl.nombre AS cliente, cl.telefono
     FROM citas ci JOIN clientes cl ON cl.id = ci.cliente_id
     WHERE ($desde IS NULL OR ci.inicio >= $desde)
       AND ($clienteId IS NULL OR ci.cliente_id = $clienteId)
     ORDER BY ci.inicio`,
    { desde, clienteId },
  );
  const zona = config.negocio.zonaHoraria;
  return csv(
    ['id', 'dia', 'hora', 'cliente', 'telefono', 'servicio', config.vocabulario.recurso, 'estado', 'precio', 'canal', 'notas'],
    filas.map((f) => [
      f.id,
      claveDia(zona, f.inicio),
      fechaYHora(zona, f.inicio).split(' a las ')[1],
      f.cliente, f.telefono, f.servicio_nombre, f.recurso_nombre,
      f.estado.replace('_', ' '), euros(f.precio_centimos), f.canal, f.notas,
    ]),
  );
}

export function conversacionesCsv(db, config, { clienteId = null } = {}) {
  const filas = db.filas(
    `SELECT m.creado_en, m.direccion, m.autor, m.texto, c.canal, c.externo, cl.nombre AS cliente
     FROM mensajes m
     JOIN conversaciones c ON c.id = m.conversacion_id
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     WHERE ($clienteId IS NULL OR c.cliente_id = $clienteId)
     ORDER BY m.creado_en`,
    { clienteId },
  );
  const zona = config.negocio.zonaHoraria;
  return csv(
    ['cuando', 'canal', 'contacto', 'cliente', 'quien', 'mensaje'],
    filas.map((f) => [
      fechaYHora(zona, f.creado_en, { conAnio: true }),
      f.canal, f.externo, f.cliente, f.autor, f.texto,
    ]),
  );
}

/** Todo lo que hay de una persona, para cuando lo pide. */
export function todoDeUnCliente(db, config, clienteId) {
  return {
    'ficha.csv': clientesCsv(db, config, { clienteId }),
    'citas.csv': citasCsv(db, config, { clienteId }),
    'mensajes.csv': conversacionesCsv(db, config, { clienteId }),
  };
}

export function todo(db, config, { desde = null } = {}) {
  return {
    'clientes.csv': clientesCsv(db, config),
    'citas.csv': citasCsv(db, config, { desde }),
    'mensajes.csv': conversacionesCsv(db, config),
  };
}
