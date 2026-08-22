import test from 'node:test';
import assert from 'node:assert/strict';
import * as e from '../cerebro/entender.js';
import { negocioDePrueba, ZONA, AHORA, LUNES, MARTES } from './ayuda.js';

const opciones = { zona: ZONA, ahora: AHORA }; // viernes 21 de agosto de 2026

test('entiende hoy, mañana y pasado mañana', () => {
  assert.equal(e.resolverDia('hoy', opciones), '2026-08-21');
  assert.equal(e.resolverDia('mañana', opciones), '2026-08-22');
  assert.equal(e.resolverDia('pasado mañana', opciones), '2026-08-23');
});

test('"el lunes por la mañana" es el lunes, no mañana', () => {
  assert.equal(e.resolverDia('el lunes por la mañana', opciones), LUNES);
});

test('"esta tarde" y "esta mañana" son hoy', () => {
  assert.equal(e.resolverDia('esta tarde', opciones), '2026-08-21');
  assert.equal(e.resolverDia('esta mañana', opciones), '2026-08-21');
});

test('entiende los días de la semana y coge el siguiente', () => {
  assert.equal(e.resolverDia('el martes', opciones), MARTES);
  assert.equal(e.resolverDia('el viernes', opciones), '2026-08-28');
  assert.equal(e.resolverDia('el miércoles que viene', opciones), '2026-08-26');
});

test('entiende fechas escritas de varias formas', () => {
  assert.equal(e.resolverDia('el 24 de agosto', opciones), LUNES);
  assert.equal(e.resolverDia('24/08', opciones), LUNES);
  assert.equal(e.resolverDia('24-08-2026', opciones), LUNES);
  assert.equal(e.resolverDia('2026-08-24', opciones), LUNES);
  assert.equal(e.resolverDia('quiero cita el 2026-08-24 si puede ser', opciones), LUNES);
});

test('una fecha que ya pasó se entiende como la del año que viene', () => {
  assert.equal(e.resolverDia('el 3 de febrero', opciones), '2027-02-03');
});

test('no se inventa un día cuando no lo hay', () => {
  assert.equal(e.resolverDia('quiero cita', opciones), null);
  assert.equal(e.resolverDia('', opciones), null);
});

test('entiende horas con minutos', () => {
  assert.equal(e.resolverHora('a las 10:30'), 630);
  assert.equal(e.resolverHora('10:30'), 630);
  assert.equal(e.resolverHora('10.30'), 630);
});

test('entiende horas en letra y con cuartos', () => {
  assert.equal(e.resolverHora('a las diez y media'), 630);
  assert.equal(e.resolverHora('a las diez y cuarto'), 615);
  assert.equal(e.resolverHora('a las once menos cuarto'), 645);
});

test('"de la tarde" pasa la hora a la tarde', () => {
  assert.equal(e.resolverHora('a las 5 de la tarde'), 1020);
  assert.equal(e.resolverHora('a las 8 de la mañana'), 480);
});

test('no se inventa una hora cuando no la hay', () => {
  assert.equal(e.resolverHora('cuando puedas'), null);
});

test('una hora suelta se ajusta al horario del negocio', () => {
  const config = negocioDePrueba();
  assert.equal(e.desambiguarConHorario(config, 5 * 60, LUNES), 17 * 60);
  assert.equal(e.desambiguarConHorario(config, 10 * 60, LUNES), 10 * 60);
});

test('una hora escrita entera se respeta tal cual', () => {
  const config = negocioDePrueba();
  assert.ok(e.horaEsExplicita('04:00'));
  assert.ok(!e.horaEsExplicita('a las 4'));
  assert.equal(e.desambiguarConHorario(config, 4 * 60, LUNES, { explicita: true }), 4 * 60);
});

test('entiende las franjas del día', () => {
  assert.equal(e.resolverFranja('el lunes por la mañana'), 'manana');
  assert.equal(e.resolverFranja('por la tarde'), 'tarde');
  assert.equal(e.resolverFranja('a primera hora'), 'temprano');
  assert.equal(e.resolverFranja('a mediodía'), 'mediodia');
  assert.equal(e.resolverFranja('cuando sea'), null);
});

test('reconoce el servicio por su nombre y por sus apodos', () => {
  const config = negocioDePrueba();
  assert.equal(e.resolverServicio(config, 'quiero un corte')?.id, 'corte');
  assert.equal(e.resolverServicio(config, 'vengo a cortarme el pelo')?.id, 'corte');
  assert.equal(e.resolverServicio(config, 'un tinte, por favor')?.id, 'tinte');
});

test('no adivina el servicio cuando no lo dicen', () => {
  const config = negocioDePrueba();
  assert.equal(e.resolverServicio(config, 'hola buenas'), null);
});

test('reconoce a la persona por su nombre, pero no dentro de otra palabra', () => {
  const config = negocioDePrueba();
  assert.equal(e.resolverRecurso(config, 'con Ana si puede ser')?.id, 'ana');
  assert.equal(e.resolverRecurso(config, 'quiero cita mañana'), null);
  assert.equal(e.resolverRecurso(config, 'me da igual quién')?.id, undefined);
});

test('detecta lo que quiere el cliente', () => {
  assert.equal(e.detectarIntencion('quiero cita para el lunes'), 'reservar');
  assert.equal(e.detectarIntencion('anúlamela'), 'anular');
  assert.equal(e.detectarIntencion('cancelar la cita'), 'anular');
  assert.equal(e.detectarIntencion('¿podemos cambiarla?'), 'mover');
  assert.equal(e.detectarIntencion('¿cuándo tengo la cita?'), 'consultar');
  assert.equal(e.detectarIntencion('¿cuánto cuesta?'), 'precio');
  assert.equal(e.detectarIntencion('¿qué horario tenéis?'), 'horario');
  assert.equal(e.detectarIntencion('¿dónde estáis?'), 'direccion');
  assert.equal(e.detectarIntencion('hola buenas'), 'saludo');
});

test('detecta cuando hay que apartarse', () => {
  assert.equal(e.detectarIntencion('quiero poner una reclamación'), 'escalar');
  assert.equal(e.detectarIntencion('quiero hablar con una persona'), 'escalar');
  assert.equal(e.detectarIntencion('esto es una estafa'), 'escalar');
});

test('distingue un sí de un no', () => {
  assert.ok(e.esAfirmacion('sí, confirmo'));
  assert.ok(e.esAfirmacion('vale'));
  assert.ok(e.esAfirmacion('perfecto'));
  assert.ok(e.esAfirmacion('confírmamela'));
  assert.ok(e.esNegacion('no'));
  assert.ok(e.esNegacion('no me viene bien'));
  assert.ok(!e.esNegacion('sí'));
});

test('saca el nombre cuando lo dicen', () => {
  assert.equal(e.extraerNombre('me llamo Rocío Márquez'), 'Rocío Márquez');
  assert.equal(e.extraerNombre('soy javier'), 'Javier');
  assert.equal(e.extraerNombre('hola qué tal'), null);
});

test('acepta un nombre a secas solo si se lo hemos preguntado', () => {
  assert.equal(e.extraerNombre('Rocío', { esperandoNombre: true }), 'Rocío');
  assert.equal(e.extraerNombre('Rocío'), null);
});

test('elige de la lista de horas ofrecidas', () => {
  const huecos = [
    { hora: '10:00', minuto: 600 }, { hora: '10:30', minuto: 630 }, { hora: '11:00', minuto: 660 },
  ];
  assert.equal(e.elegirDeLaLista('la primera', huecos).hora, '10:00');
  assert.equal(e.elegirDeLaLista('la última', huecos).hora, '11:00');
  assert.equal(e.elegirDeLaLista('a las 10:30', huecos).hora, '10:30');
  assert.equal(e.elegirDeLaLista('a las 12:00', huecos), null);
});

test('elige una hora de tarde aunque la digan en corto', () => {
  const huecos = [{ hora: '16:00', minuto: 960 }, { hora: '17:00', minuto: 1020 }];
  assert.equal(e.elegirDeLaLista('a las 5', huecos).hora, '17:00');
});

test('saca el teléfono de un texto', () => {
  assert.equal(e.extraerTelefono('mi móvil es 600 111 222'), '600 111 222');
  assert.equal(e.extraerTelefono('sin número'), null);
});
