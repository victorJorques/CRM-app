#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Una semana de citas de ejemplo para ver el panel con algo dentro.
// Con --borrar vacía antes lo que haya. Nunca toca la configuración.
// ---------------------------------------------------------------------------

import { cargarEntorno } from './nucleo/entorno.js';
import { cargarConfig } from './nucleo/config-fichero.js';
import { abrirBase } from './datos/db.js';
import * as clientes from './nucleo/clientes.js';
import * as citas from './nucleo/citas.js';
import * as bandeja from './nucleo/bandeja.js';
import { buscarHuecos } from './nucleo/agenda.js';
import { claveDia, sumarDias, diaSemana, instanteDe } from './nucleo/tiempo.js';

const NOMBRES = [
  ['Rocío Márquez', '+34600111222'], ['Javier Peña', '+34600111223'],
  ['Marta Ibáñez', '+34600111224'], ['Luis Cabrera', '+34600111225'],
  ['Nuria Salas', '+34600111226'], ['Óscar Ferrer', '+34600111227'],
  ['Elena Prado', '+34600111228'], ['Diego Rivas', '+34600111229'],
  ['Carmen Ortiz', '+34600111230'], ['Toni Bou', '+34600111231'],
];

cargarEntorno();
const { config } = cargarConfig('conserje.config.json');
const db = abrirBase(process.env.CONSERJE_BASE ?? 'datos/conserje.db');
const zona = config.negocio.zonaHoraria;
const ahora = Date.now();

if (process.argv.includes('--borrar')) {
  for (const tabla of ['mensajes', 'conversaciones', 'recordatorios', 'citas', 'clientes', 'eventos']) {
    db.ejecutar(`DELETE FROM ${tabla}`);
  }
  console.log('Vaciado lo que había.');
}

/**
 * A quién le toca la siguiente cita. Reparte de verdad: siempre a quien menos
 * tenga, y nunca más de dos por semana a la misma persona. Antes rotaba con
 * una cuenta y podía darle cuatro citas seguidas al mismo, que en un dentista
 * no se lo cree nadie y encima parece que se mezclen las fichas.
 */
function aQuienLeToca(fichas, cuenta, tope = 2) {
  const libres = fichas.filter((f) => (cuenta.get(f.id) ?? 0) < tope);
  if (libres.length === 0) return null;
  return libres.reduce((menos, f) => (
    (cuenta.get(f.id) ?? 0) < (cuenta.get(menos.id) ?? 0) ? f : menos
  ), libres[0]);
}

/**
 * Una escena a propósito: tres personas con cita a la misma hora el lunes que
 * viene a mediodía. Sirve para ver dos cosas de un vistazo: que la agenda
 * enseña los tres nombres juntos, y que a la cuarta persona ya no se le da esa
 * hora, porque el tope son tres.
 */
function tresALaMismaHora(db, config, fichas, ahora) {
  const zona = config.negocio.zonaHoraria;
  const tope = config.reglas.maxPorHora ?? 3;
  let clave = claveDia(zona, ahora);
  for (let i = 1; i <= 14; i += 1) {          // el próximo lunes
    clave = sumarDias(claveDia(zona, ahora), i);
    if (diaSemana(zona, clave) === 'lunes') break;
  }
  const servicio = config.servicios.find((s) => s.activo) ?? config.servicios[0];
  const puestas = [];
  for (const ficha of fichas) {
    if (puestas.length >= tope) break;
    const inicio = instanteDe(zona, clave, 12 * 60);
    if (inicio === null) break;
    const r = citas.reservar(db, config, {
      servicioId: servicio.id, inicio, clienteId: ficha.id, canal: 'whatsapp', ahora,
    });
    if (r.ok) puestas.push(ficha.nombre);
  }
  return { clave, puestas };
}

const fichas = NOMBRES.map(([nombre, telefono]) => clientes.buscarOCrear(db, { nombre, telefono }));
let puestas = 0;
let pasadas = 0;

// Historial: tres semanas hacia atrás, para que las fichas tengan algo que contar.
for (let dia = 21; dia >= 1; dia -= 1) {
  const clave = sumarDias(claveDia(zona, ahora), -dia);
  for (const servicio of config.servicios.slice(0, 3)) {
    const { huecos } = buscarHuecos(db, config, {
      servicioId: servicio.id, desde: clave, dias: 1, limite: 12,
      ahora: Date.parse(`${clave}T00:00:00Z`) - 86400000,
    });
    for (const hueco of huecos.filter((_, i) => i % 4 === 0).slice(0, 2)) {
      const ficha = fichas[(puestas + pasadas) % fichas.length];
      const reserva = citas.reservar(db, config, {
        servicioId: servicio.id, inicio: hueco.inicio, recursoId: hueco.recursoId,
        clienteId: ficha.id, canal: ['whatsapp', 'panel', 'llamada'][pasadas % 3],
        ahora: hueco.inicio - 3 * 86400000,
      });
      if (!reserva.ok) continue;
      citas.marcar(db, config, { citaId: reserva.cita.id, estado: pasadas % 9 === 0 ? 'no_vino' : 'atendida' });
      pasadas += 1;
    }
  }
}

// La semana que viene: lo que se ve al abrir el panel.
const porVenir = new Map();
for (let dia = 0; dia < 7; dia += 1) {
  const clave = sumarDias(claveDia(zona, ahora), dia);
  for (const servicio of config.servicios) {
    const { huecos } = buscarHuecos(db, config, { servicioId: servicio.id, desde: clave, dias: 1, limite: 10, ahora });
    for (const hueco of huecos.filter((_, i) => i % 3 === 0).slice(0, 2)) {
      const ficha = aQuienLeToca(fichas, porVenir);
      if (!ficha) continue;
      const reserva = citas.reservar(db, config, {
        servicioId: servicio.id, inicio: hueco.inicio, recursoId: hueco.recursoId,
        clienteId: ficha.id, canal: ['whatsapp', 'panel', 'correo'][puestas % 3], ahora,
      });
      if (!reserva.ok) continue;
      porVenir.set(ficha.id, (porVenir.get(ficha.id) ?? 0) + 1);
      puestas += 1;
    }
  }
}

// Tres a la misma hora, para ver el tope y los nombres juntos en la agenda.
const luisCabrera = fichas.find((f) => f.nombre.startsWith('Luis')) ?? fichas[3];
const escena = tresALaMismaHora(db, config, [luisCabrera, fichas[4], fichas[7]], ahora);
if (escena.puestas.length) {
  console.log(`El ${escena.clave} a las 12:00: ${escena.puestas.join(', ')}.`);
}

// Un par de conversaciones para que la bandeja no esté vacía.
const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: fichas[0].telefono, clienteId: fichas[0].id });
bandeja.entrante(db, conv.id, 'buenas, ¿tenéis hueco esta semana?');
bandeja.saliente(db, conv.id, 'Sí: mañana a las 10:00, 10:30 y 12:00. ¿Cuál te viene mejor?');
const conv2 = bandeja.abrir(db, { canal: 'correo', externo: 'nuria@ejemplo.com', clienteId: fichas[4].id });
bandeja.entrante(db, conv2.id, 'Quería cambiar la cita del jueves, si puede ser por la tarde.');

console.log(`Sembrado: ${fichas.length} fichas, ${pasadas} citas pasadas y ${puestas} por venir.`);
console.log('Arranca con: node arrancar.js');
db.cerrar();
