#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Saca tus datos a CSV y hace una copia de la base.
//
//   node exportar.js                          todo, a copias/2026-08-22/
//   node exportar.js --desde 2026-01-01       solo citas de este año
//   node exportar.js --cliente +34600111222   todo lo de una persona
//
// Los CSV se abren con doble clic en Excel o en Numbers, con los acentos
// bien. La copia de la base es el fichero que hay que guardar de verdad: con
// ese solo, Conserje vuelve a arrancar tal como estaba.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cargarEntorno } from './nucleo/entorno.js';
import { cargarConfig } from './nucleo/config-fichero.js';
import { abrirBase } from './datos/db.js';
import * as clientes from './nucleo/clientes.js';
import { todo, todoDeUnCliente } from './nucleo/exportar.js';
import { claveDia } from './nucleo/tiempo.js';

const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const verde = (t) => `\x1b[32m${t}\x1b[0m`;

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : null;
}

cargarEntorno();
const { config } = cargarConfig('conserje.config.json');
const ruta = process.env.CONSERJE_BASE ?? 'datos/conserje.db';
if (!existsSync(ruta)) {
  console.error(`No encuentro la base en ${ruta}. ¿Has arrancado Conserje alguna vez?`);
  process.exit(1);
}
const db = abrirBase(ruta);

const zona = config.negocio.zonaHoraria;
const carpeta = argumento('carpeta') ?? join('copias', claveDia(zona, Date.now()));
mkdirSync(carpeta, { recursive: true });

const telefono = argumento('cliente');
let ficheros;
if (telefono) {
  const quien = clientes.porTelefono(db, telefono) ?? clientes.porCorreo(db, telefono);
  if (!quien) {
    console.error(`No tengo a nadie con ${telefono}.`);
    process.exit(1);
  }
  ficheros = todoDeUnCliente(db, config, quien.id);
  console.log(`\n  Todo lo de ${quien.nombre || quien.telefono}:`);
} else {
  ficheros = todo(db, config, { desde: argumento('desde') ? Date.parse(`${argumento('desde')}T00:00:00Z`) : null });
  console.log(`\n  ${config.negocio.nombre}:`);
}

for (const [nombre, contenido] of Object.entries(ficheros)) {
  const destino = join(carpeta, nombre);
  writeFileSync(destino, contenido, 'utf8');
  const lineas = contenido.trimEnd().split('\r\n').length - 1;
  console.log(`  ${verde('✓')} ${destino} ${gris(`(${lineas} ${lineas === 1 ? 'fila' : 'filas'})`)}`);
}

if (!telefono) {
  // La copia de la base va después de cerrar el diario, o se queda a medias.
  db.bruta.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const copia = join(carpeta, 'conserje.db');
  copyFileSync(ruta, copia);
  console.log(`  ${verde('✓')} ${copia} ${gris('(la base entera: esta es la copia que importa)')}`);
}

console.log(gris('\n  Guárdalo donde no esté este ordenador.\n'));
db.cerrar();
