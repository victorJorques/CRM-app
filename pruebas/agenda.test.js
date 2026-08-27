import test from 'node:test';
import assert from 'node:assert/strict';
import * as agenda from '../nucleo/agenda.js';
import * as citas from '../nucleo/citas.js';
import { buscarOCrear } from '../nucleo/clientes.js';
import { montar, instante, LUNES, MARTES, DOMINGO, AHORA, ZONA } from './ayuda.js';
import { negocioDePrueba } from './ayuda.js';
import { claveDia } from '../nucleo/tiempo.js';

function conCita(entorno, { servicioId = 'corte', clave = LUNES, hora = 10, minuto = 0, recursoId = null } = {}) {
  const cliente = buscarOCrear(entorno.db, { telefono: `+3460011${Math.floor(Math.random() * 9000) + 1000}` });
  return citas.reservar(entorno.db, entorno.config, {
    servicioId, inicio: instante(clave, hora, minuto), recursoId, clienteId: cliente.id, ahora: entorno.ahora,
  });
}

test('ofrece huecos desde que abre', () => {
  const { db, config, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, ahora });
  assert.equal(huecos[0].hora, '09:00');
});

test('respeta la granularidad configurada', () => {
  const { db, config, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, ahora });
  assert.deepEqual(huecos.slice(0, 3).map((h) => h.hora), ['09:00', '09:30', '10:00']);
});

test('no ofrece nada un día cerrado', () => {
  const { db, config, ahora } = montar();
  assert.equal(agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: DOMINGO, ahora }).length, 0);
});

test('no ofrece nada un festivo', () => {
  const config = negocioDePrueba({ festivos: [LUNES] });
  const { db, ahora } = montar();
  assert.equal(agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, ahora }).length, 0);
});

test('no ofrece nada durante un cierre por vacaciones', () => {
  const config = negocioDePrueba({ cierres: [{ desde: LUNES, hasta: MARTES, motivo: 'vacaciones' }] });
  const { db, ahora } = montar();
  assert.equal(agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: MARTES, ahora }).length, 0);
});

test('salta el hueco de comer de un horario partido', () => {
  const { db, config, ahora } = montar();
  const horas = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, ahora }).map((h) => h.hora);
  assert.ok(horas.includes('13:30'));
  assert.ok(!horas.includes('14:00'));
  assert.ok(!horas.includes('15:30'));
  assert.ok(horas.includes('16:00'));
});

test('el último hueco deja tiempo para terminar antes de cerrar', () => {
  const { db, config, ahora } = montar();
  const horas = agenda.huecosDelDia(db, config, { servicioId: 'tinte', clave: LUNES, ahora }).map((h) => h.hora);
  assert.ok(horas.includes('13:00'));
  assert.ok(!horas.includes('13:30'));
});

test('un servicio ocupa su duración entera', () => {
  const entorno = montar();
  const reserva = conCita(entorno, { servicioId: 'tinte', hora: 10 });
  assert.ok(reserva.ok);
  const horas = agenda.huecosDelDia(entorno.db, entorno.config, { servicioId: 'corte', clave: LUNES, recursoId: 'ana', ahora: entorno.ahora }).map((h) => h.hora);
  assert.ok(!horas.includes('10:00'));
  assert.ok(!horas.includes('10:30'));
  assert.ok(horas.includes('11:00'));
});

test('el margen entre citas también bloquea', () => {
  const config = negocioDePrueba({ reglas: { granularidadMinutos: 30, margenEntreCitasMinutos: 30, antelacionMinimaHoras: 2 } });
  const entorno = { ...montar(), config };
  const reserva = conCita(entorno, { hora: 10, recursoId: 'ana' });
  assert.ok(reserva.ok);
  const horas = agenda.huecosDelDia(entorno.db, config, { servicioId: 'corte', clave: LUNES, recursoId: 'ana', ahora: entorno.ahora }).map((h) => h.hora);
  assert.ok(!horas.includes('10:30'));
  assert.ok(horas.includes('11:00'));
});

test('la franja de la mañana solo trae mañanas', () => {
  const { db, config, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, franja: 'manana', ahora });
  assert.ok(huecos.every((h) => h.minuto < 14 * 60));
});

test('la franja de la tarde solo trae tardes', () => {
  const { db, config, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, franja: 'tarde', ahora });
  assert.ok(huecos.length > 0);
  assert.ok(huecos.every((h) => h.minuto >= 14 * 60));
});

test('entiende la franja escrita como se habla', () => {
  assert.deepEqual(agenda.franjaEnMinutos('por la mañana'), [0, 840]);
  assert.deepEqual(agenda.franjaEnMinutos('tarde'), [840, 1200]);
  assert.equal(agenda.franjaEnMinutos('a la hora de la siesta'), null);
});

test('no ofrece horas que no cumplen la antelación mínima', () => {
  const { db, config } = montar();
  const hoy = claveDia(ZONA, AHORA);
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: hoy, ahora: AHORA });
  assert.ok(huecos.every((h) => h.inicio >= AHORA + 2 * 3600000));
});

test('no busca más allá de la antelación máxima', () => {
  const config = negocioDePrueba({ reglas: { granularidadMinutos: 30, antelacionMaximaDias: 2, antelacionMinimaHoras: 2 } });
  const { db } = montar();
  const { huecos } = agenda.buscarHuecos(db, config, { servicioId: 'corte', desde: '2026-09-30', ahora: AHORA });
  assert.equal(huecos.length, 0);
});

test('reparte hacia quien tiene menos trabajo ese día', () => {
  const entorno = montar();
  // Martes: trabajan Ana y Luis. Le cargamos la mañana a Ana.
  for (const hora of [9, 10, 11]) conCita(entorno, { clave: MARTES, hora, recursoId: 'ana' });
  const huecos = agenda.huecosDelDia(entorno.db, entorno.config, { servicioId: 'corte', clave: MARTES, ahora: entorno.ahora });
  assert.equal(huecos[0].recursoId, 'luis');
});

test('ofrece cada hora una sola vez aunque puedan dos personas', () => {
  const { db, config, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: MARTES, ahora });
  const horas = huecos.map((h) => h.hora);
  assert.equal(new Set(horas).size, horas.length);
  assert.ok(huecos[0].alternativas.length >= 1);
});

test('si se pide una persona concreta, solo se mira su agenda', () => {
  const { db, config, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: MARTES, recursoId: 'luis', ahora });
  assert.ok(huecos.every((h) => h.recursoId === 'luis'));
  assert.ok(huecos.every((h) => h.minuto < 14 * 60));   // Luis solo trabaja por la mañana
});

test('una persona con capacidad para varios a la vez admite solapes', () => {
  const config = negocioDePrueba({
    recursos: [{ nombre: 'Sala', capacidad: 2 }],
    servicios: [{ nombre: 'Corte', duracionMinutos: 30, precio: 20 }],
  });
  const entorno = { ...montar(), config };
  assert.ok(conCita(entorno, { hora: 10 }).ok);
  assert.ok(conCita(entorno, { hora: 10 }).ok);
  assert.ok(!conCita(entorno, { hora: 10 }).ok);
});

test('buscarHuecos salta los días cerrados hasta encontrar sitio', () => {
  const { db, config, ahora } = montar();
  const { huecos } = agenda.buscarHuecos(db, config, { servicioId: 'corte', desde: DOMINGO, ahora, limite: 2 });
  assert.equal(huecos.length, 2);
  assert.equal(huecos[0].dia, LUNES);
});

test('comprobarHora dice que sí cuando está libre', () => {
  const { db, config, ahora } = montar();
  const r = agenda.comprobarHora(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), ahora });
  assert.ok(r.libre);
  assert.equal(r.hueco.hora, '10:00');
});

test('comprobarHora dice que está cogida y ofrece alternativas', () => {
  const entorno = montar();
  conCita(entorno, { hora: 10, recursoId: 'ana' });
  conCita(entorno, { hora: 10, recursoId: 'luis' });
  const r = agenda.comprobarHora(entorno.db, entorno.config, { servicioId: 'corte', inicio: instante(LUNES, 10), ahora: entorno.ahora });
  assert.ok(!r.libre);
  assert.equal(r.motivo, 'ocupado');
  assert.ok(r.alternativas.length > 0);
});

test('comprobarHora rechaza una hora fuera de horario', () => {
  const { db, config, ahora } = montar();
  const r = agenda.comprobarHora(db, config, { servicioId: 'corte', inicio: instante(LUNES, 15), ahora });
  assert.equal(r.motivo, 'fuera-de-horario');
});

test('comprobarHora rechaza un día cerrado', () => {
  const { db, config, ahora } = montar();
  const r = agenda.comprobarHora(db, config, { servicioId: 'corte', inicio: instante(DOMINGO, 10), ahora });
  assert.equal(r.motivo, 'fuera-de-horario');
});

test('comprobarHora rechaza lo que ya pasó', () => {
  const { db, config, ahora } = montar();
  const r = agenda.comprobarHora(db, config, { servicioId: 'corte', inicio: instante('2026-08-20', 10), ahora });
  assert.equal(r.motivo, 'ya-paso');
});

test('comprobarHora rechaza lo que es demasiado justo', () => {
  const { db, config } = montar();
  const hoy = claveDia(ZONA, AHORA);
  const r = agenda.comprobarHora(db, config, { servicioId: 'corte', inicio: instante(hoy, 10), ahora: AHORA });
  assert.equal(r.motivo, 'demasiado-justo');
});

test('comprobarHora rechaza lo que cae demasiado lejos', () => {
  const config = negocioDePrueba({ reglas: { granularidadMinutos: 30, antelacionMaximaDias: 7, antelacionMinimaHoras: 2 } });
  const { db } = montar();
  const r = agenda.comprobarHora(db, config, { servicioId: 'corte', inicio: instante('2026-10-05', 10), ahora: AHORA });
  assert.equal(r.motivo, 'demasiado-lejos');
});

test('comprobarHora rechaza a quien no hace ese servicio', () => {
  const { db, config, ahora } = montar();
  const r = agenda.comprobarHora(db, config, { servicioId: 'tinte', inicio: instante(MARTES, 10), recursoId: 'luis', ahora });
  assert.equal(r.motivo, 'recurso-no-hace-servicio');
});

test('explica por qué no hay huecos: cerrado, libra, o no lo hace', () => {
  const config = negocioDePrueba({ festivos: ['2026-08-26'] });
  const servicio = config.servicios.find((s) => s.id === 'corte');
  const tinte = config.servicios.find((s) => s.id === 'tinte');
  const luis = config.recursos.find((r) => r.id === 'luis');
  assert.equal(agenda.porQueNoHayHuecos(config, { clave: '2026-08-26', servicio }).motivo, 'festivo');
  assert.equal(agenda.porQueNoHayHuecos(config, { clave: DOMINGO, servicio }).motivo, 'cerrado');
  assert.equal(agenda.porQueNoHayHuecos(config, { clave: LUNES, servicio, recurso: luis }).motivo, 'recurso-libra');
  assert.equal(agenda.porQueNoHayHuecos(config, { clave: MARTES, servicio: tinte, recurso: luis }).motivo, 'recurso-no-hace');
  assert.equal(agenda.porQueNoHayHuecos(config, { clave: LUNES, servicio }).motivo, 'lleno');
});

test('el resumen del día trae las citas, los tramos y el dinero', () => {
  const entorno = montar();
  const reserva = conCita(entorno, { hora: 10, recursoId: 'ana' });
  citas.marcar(entorno.db, entorno.config, { citaId: reserva.cita.id, estado: 'atendida' });
  const dia = agenda.resumenDia(entorno.db, entorno.config, LUNES);
  assert.equal(dia.citas.length, 1);
  assert.equal(dia.ingresosCentimos, 2000);
  assert.ok(dia.abierto);
  assert.equal(dia.recursos.find((r) => r.id === 'ana').tramos.length, 2);
});

test('el día del cambio de hora no ofrece horas que no existen', () => {
  const config = negocioDePrueba({
    horario: { domingo: [['00:00', '06:00']], lunes: [], martes: [], miercoles: [], jueves: [], viernes: [], sabado: [] },
    reglas: { granularidadMinutos: 30, antelacionMinimaHoras: 0, antelacionMaximaDias: 400 },
  });
  const { db } = montar();
  const huecos = agenda.huecosDelDia(db, config, {
    servicioId: 'corte', clave: '2026-03-29', ahora: Date.parse('2026-03-01T00:00:00Z'),
  });
  const horas = huecos.map((h) => h.hora);
  assert.ok(horas.includes('01:30'));
  assert.ok(!horas.includes('02:00'));
  assert.ok(!horas.includes('02:30'));
  assert.ok(horas.includes('03:00'));
});

// --- Vacaciones y bajas de una sola persona --------------------------------

test('quien está de vacaciones no da huecos, y el resto sigue', () => {
  const config = negocioDePrueba({
    recursos: [
      { nombre: 'Ana', ausencias: [{ desde: LUNES, hasta: MARTES, motivo: 'vacaciones' }] },
      { nombre: 'Luis' },
    ],
    servicios: [{ nombre: 'Corte', duracionMinutos: 30, precio: 20 }],
  });
  const { db, ahora } = montar();
  const huecos = agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, ahora });
  assert.ok(huecos.length > 0);
  assert.ok(huecos.every((h) => h.recursoId === 'luis'));
  assert.equal(agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, recursoId: 'ana', ahora }).length, 0);
});

test('las vacaciones terminan cuando dicen', () => {
  const config = negocioDePrueba({
    recursos: [{ nombre: 'Ana', ausencias: [{ desde: LUNES, hasta: LUNES, motivo: 'vacaciones' }] }],
    servicios: [{ nombre: 'Corte', duracionMinutos: 30, precio: 20 }],
  });
  const { db, ahora } = montar();
  assert.equal(agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: LUNES, ahora }).length, 0);
  assert.ok(agenda.huecosDelDia(db, config, { servicioId: 'corte', clave: MARTES, ahora }).length > 0);
});

test('el motivo de la ausencia se sabe y se dice', () => {
  const config = negocioDePrueba({
    recursos: [{ nombre: 'Ana', ausencias: [{ desde: LUNES, hasta: LUNES, motivo: 'de baja' }] }, { nombre: 'Luis' }],
    servicios: [{ nombre: 'Corte', duracionMinutos: 30, precio: 20 }],
  });
  const porQue = agenda.porQueNoHayHuecos(config, {
    clave: LUNES,
    servicio: config.servicios[0],
    recurso: config.recursos.find((r) => r.id === 'ana'),
  });
  assert.equal(porQue.motivo, 'recurso-ausente');
  assert.equal(porQue.razon, 'de baja');
  const { db } = montar();
  const dia = agenda.resumenDia(db, config, LUNES);
  assert.equal(dia.recursos.find((r) => r.id === 'ana').ausencia, 'de baja');
  assert.equal(dia.recursos.find((r) => r.id === 'luis').ausencia, null);
});

test('una cita ya puesta no desaparece porque luego pongan vacaciones', () => {
  const entorno = montar();
  const reserva = conCita(entorno, { hora: 10, recursoId: 'ana' });
  assert.ok(reserva.ok);
  const conVacaciones = negocioDePrueba({
    recursos: [{ nombre: 'Ana', ausencias: [{ desde: LUNES, hasta: LUNES, motivo: 'vacaciones' }] }, { nombre: 'Luis' }],
  });
  const dia = agenda.resumenDia(entorno.db, conVacaciones, LUNES);
  assert.equal(dia.citas.length, 1);   // sigue ahí para que alguien la mueva
  assert.equal(dia.recursos.find((r) => r.id === 'ana').ausencia, 'vacaciones');
});

// --- Tope de citas a la misma hora ----------------------------------------
// No se puede dar la misma hora del mismo día a más de tres clientes, aunque
// haya sillas libres: a la vez no se atiende bien a media docena de personas.

function conTresSillas(cambios = {}) {
  return negocioDePrueba({
    recursos: [{ nombre: 'Ana' }, { nombre: 'Luis' }, { nombre: 'Sara' }, { nombre: 'Iván' }],
    servicios: [{ nombre: 'Corte', duracionMinutos: 30, precio: 20 }],
    reglas: { granularidadMinutos: 30, antelacionMinimaHoras: 2, maxPorHora: 3 },
    ...cambios,
  });
}

test('a la misma hora caben tres, y el cuarto ya no', () => {
  const config = conTresSillas();
  const entorno = { ...montar(), config };
  const puestas = [];
  for (let i = 0; i < 4; i += 1) {
    const quien = buscarOCrear(entorno.db, { telefono: `+3460011122${i}`, nombre: `Cliente ${i}` });
    const r = citas.reservar(entorno.db, config, {
      servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora: entorno.ahora,
    });
    puestas.push(r.ok ? 'ok' : r.motivo);
  }
  assert.deepEqual(puestas, ['ok', 'ok', 'ok', 'hora-completa']);
  assert.equal(agenda.citasALaMismaHora(entorno.db, instante(LUNES, 10)), 3);
});

test('una hora al completo deja de ofrecerse', () => {
  const config = conTresSillas();
  const entorno = { ...montar(), config };
  for (let i = 0; i < 3; i += 1) {
    const quien = buscarOCrear(entorno.db, { telefono: `+3460011133${i}` });
    citas.reservar(entorno.db, config, {
      servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora: entorno.ahora,
    });
  }
  const horas = agenda.huecosDelDia(entorno.db, config, { servicioId: 'corte', clave: LUNES, ahora: entorno.ahora })
    .map((h) => h.hora);
  assert.ok(!horas.includes('10:00'), 'sigue ofreciendo una hora completa');
  assert.ok(horas.includes('10:30'));
});

test('el tope se puede subir o bajar en la configuración', () => {
  const config = conTresSillas({ reglas: { granularidadMinutos: 30, antelacionMinimaHoras: 2, maxPorHora: 1 } });
  const entorno = { ...montar(), config };
  const uno = buscarOCrear(entorno.db, { telefono: '+34600111991' });
  const dos = buscarOCrear(entorno.db, { telefono: '+34600111992' });
  assert.ok(citas.reservar(entorno.db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: uno.id, ahora: entorno.ahora }).ok);
  const segunda = citas.reservar(entorno.db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: dos.id, ahora: entorno.ahora });
  assert.equal(segunda.motivo, 'hora-completa');
});

test('mover una cita a su propia hora no cuenta como una cuarta', () => {
  const config = conTresSillas();
  const entorno = { ...montar(), config };
  const puestas = [];
  for (let i = 0; i < 3; i += 1) {
    const quien = buscarOCrear(entorno.db, { telefono: `+3460011144${i}` });
    puestas.push(citas.reservar(entorno.db, config, {
      servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora: entorno.ahora,
    }).cita);
  }
  const movida = citas.mover(entorno.db, config, {
    citaId: puestas[0].id, nuevoInicio: instante(LUNES, 10), ahora: entorno.ahora,
  });
  assert.ok(movida.ok, movida.motivo);
});

test('el resumen del día dice qué horas están completas y quién las tiene', () => {
  const config = conTresSillas();
  const entorno = { ...montar(), config };
  const nombres = ['Luis Cabrera', 'Nuria Salas', 'Diego Rivas'];
  for (const [i, nombre] of nombres.entries()) {
    const quien = buscarOCrear(entorno.db, { telefono: `+3460011155${i}`, nombre });
    citas.reservar(entorno.db, config, {
      servicioId: 'corte', inicio: instante(LUNES, 12), clienteId: quien.id, ahora: entorno.ahora,
    });
  }
  const dia = agenda.resumenDia(entorno.db, config, LUNES);
  assert.equal(dia.horasCompletas.length, 1);
  assert.equal(dia.horasCompletas[0].hora, '12:00');
  assert.equal(dia.horasCompletas[0].total, 3);
  assert.deepEqual(dia.horasCompletas[0].clientes.map((c) => c.nombre).sort(), [...nombres].sort());
  // Y de cada uno, lo que se va a hacer: servicio, de cuándo a cuándo, y con quién
  const uno = dia.horasCompletas[0].clientes[0];
  assert.equal(uno.servicio, 'Corte');
  assert.equal(uno.desde, '12:00');
  assert.equal(uno.hasta, '12:30');
  assert.equal(uno.precioCentimos, 2000);
  assert.ok(uno.recurso);
  assert.deepEqual(uno.masEseDia, []);
});

test('si alguien tiene algo más ese día, sale al lado de su nombre', () => {
  const config = conTresSillas();
  const entorno = { ...montar(), config };
  const nombres = ['Luis Cabrera', 'Nuria Salas', 'Diego Rivas'];
  const fichas = nombres.map((nombre, i) => buscarOCrear(entorno.db, { telefono: `+3460011166${i}`, nombre }));
  for (const ficha of fichas) {
    citas.reservar(entorno.db, config, {
      servicioId: 'corte', inicio: instante(LUNES, 12), clienteId: ficha.id, ahora: entorno.ahora,
    });
  }
  // Luis, además, viene por la mañana
  citas.reservar(entorno.db, config, {
    servicioId: 'corte', inicio: instante(LUNES, 10, 30), clienteId: fichas[0].id, ahora: entorno.ahora,
  });
  const dia = agenda.resumenDia(entorno.db, config, LUNES);
  const luis = dia.horasCompletas.find((h) => h.hora === '12:00').clientes.find((c) => c.nombre === 'Luis Cabrera');
  assert.deepEqual(luis.masEseDia, [{ servicio: 'Corte', hora: '10:30' }]);
  const nuria = dia.horasCompletas.find((h) => h.hora === '12:00').clientes.find((c) => c.nombre === 'Nuria Salas');
  assert.deepEqual(nuria.masEseDia, []);
});
