import test from 'node:test';
import assert from 'node:assert/strict';
import { celda, csv, clientesCsv, citasCsv, conversacionesCsv, todoDeUnCliente } from '../nucleo/exportar.js';
import * as clientes from '../nucleo/clientes.js';
import * as citas from '../nucleo/citas.js';
import * as bandeja from '../nucleo/bandeja.js';
import { montar, instante, LUNES } from './ayuda.js';

test('una celda normal va tal cual', () => {
  assert.equal(celda('Rocío'), 'Rocío');
  assert.equal(celda(42), '42');
  assert.equal(celda(null), '');
  assert.equal(celda(undefined), '');
});

test('una celda con punto y coma, comillas o salto de línea se protege', () => {
  assert.equal(celda('uno;dos'), '"uno;dos"');
  assert.equal(celda('dice "hola"'), '"dice ""hola"""');
  assert.equal(celda('dos\nlíneas'), '"dos\nlíneas"');
});

test('el CSV lleva marca de UTF-8 y separa por punto y coma', () => {
  const texto = csv(['a', 'b'], [[1, 2]]);
  assert.ok(texto.startsWith('﻿'));
  assert.match(texto, /a;b\r\n1;2\r\n$/);
});

test('un nombre con comillas no rompe el fichero', () => {
  const { db, config } = montar();
  clientes.buscarOCrear(db, { telefono: '+34600111222', nombre: 'Ana "la peluquera"; S.L.' });
  const texto = clientesCsv(db, config);
  const filas = texto.trimEnd().split('\r\n');
  assert.equal(filas.length, 2);
  assert.match(filas[1], /"Ana ""la peluquera""; S\.L\."/);
});

test('el listado de clientes cuenta visitas, ausencias y gasto', () => {
  const { db, config, ahora } = montar();
  const quien = clientes.buscarOCrear(db, { telefono: '+34600111222', nombre: 'Rocío' });
  const una = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  const otra = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 11), clienteId: quien.id, ahora });
  citas.marcar(db, config, { citaId: una.cita.id, estado: 'atendida' });
  citas.marcar(db, config, { citaId: otra.cita.id, estado: 'no_vino' });
  const fila = clientesCsv(db, config).trimEnd().split('\r\n')[1].split(';');
  assert.equal(fila[6], '1');        // visitas
  assert.equal(fila[7], '1');        // ausencias
  assert.equal(fila[8], '20,00');    // gastado, con coma decimal
});

test('las citas salen con día, hora y estado legibles', () => {
  const { db, config, ahora } = montar();
  const quien = clientes.buscarOCrear(db, { telefono: '+34600111222', nombre: 'Rocío' });
  const una = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  citas.marcar(db, config, { citaId: una.cita.id, estado: 'no_vino' });
  const [cabecera, fila] = citasCsv(db, config).trimEnd().split('\r\n');
  assert.match(cabecera, /dia;hora;cliente/);
  const campos = fila.split(';');
  assert.equal(campos[1], LUNES);
  assert.equal(campos[2], '10:00');
  assert.equal(campos[7], 'no vino');
});

test('se puede exportar solo desde una fecha', () => {
  const { db, config, ahora } = montar();
  const quien = clientes.buscarOCrear(db, { telefono: '+34600111222' });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  const despues = citasCsv(db, config, { desde: instante('2026-08-25', 0) });
  assert.equal(despues.trimEnd().split('\r\n').length, 1);   // solo la cabecera
});

test('los mensajes se exportan con quién dijo qué', () => {
  const { db, config } = montar();
  const conversacion = bandeja.abrir(db, { canal: 'whatsapp', externo: '+34600111222' });
  bandeja.entrante(db, conversacion.id, 'hola');
  bandeja.saliente(db, conversacion.id, 'buenas');
  const filas = conversacionesCsv(db, config).trimEnd().split('\r\n');
  assert.equal(filas.length, 3);
  assert.match(filas[1], /whatsapp;\+34600111222;;cliente;hola/);
});

test('lo de una persona son solo sus datos', () => {
  const { db, config, ahora } = montar();
  const suyo = clientes.buscarOCrear(db, { telefono: '+34600111222', nombre: 'Rocío' });
  const ajeno = clientes.buscarOCrear(db, { telefono: '+34600999888', nombre: 'Otro' });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: suyo.id, ahora });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 11), clienteId: ajeno.id, ahora });
  const ficheros = todoDeUnCliente(db, config, suyo.id);
  assert.deepEqual(Object.keys(ficheros), ['ficha.csv', 'citas.csv', 'mensajes.csv']);
  assert.match(ficheros['ficha.csv'], /Rocío/);
  assert.ok(!ficheros['ficha.csv'].includes('Otro'));
  assert.equal(ficheros['citas.csv'].trimEnd().split('\r\n').length, 2);
});
