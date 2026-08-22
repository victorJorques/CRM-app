import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../nucleo/tiempo.js';
import { ZONA } from './ayuda.js';

test('pasa una hora de verano a UTC', () => {
  assert.equal(new Date(t.aUtc(ZONA, { anio: 2026, mes: 8, dia: 24, hora: 10, minuto: 30 })).toISOString(),
    '2026-08-24T08:30:00.000Z');
});

test('pasa una hora de invierno a UTC', () => {
  assert.equal(new Date(t.aUtc(ZONA, { anio: 2026, mes: 1, dia: 12, hora: 10, minuto: 30 })).toISOString(),
    '2026-01-12T09:30:00.000Z');
});

test('la madrugada que se adelanta el reloj no existe', () => {
  assert.equal(t.aUtc(ZONA, { anio: 2026, mes: 3, dia: 29, hora: 2, minuto: 30 }), null);
});

test('la hora anterior al cambio sigue existiendo', () => {
  assert.ok(t.aUtc(ZONA, { anio: 2026, mes: 3, dia: 29, hora: 1, minuto: 30 }));
});

test('la madrugada que se atrasa el reloj se queda con la primera pasada', () => {
  const ms = t.aUtc(ZONA, { anio: 2026, mes: 10, dia: 25, hora: 2, minuto: 30 });
  assert.equal(new Date(ms).toISOString(), '2026-10-25T00:30:00.000Z');
});

test('el dia local no se descuadra de madrugada', () => {
  assert.equal(t.claveDia(ZONA, Date.parse('2026-08-23T23:30:00Z')), '2026-08-24');
  assert.equal(t.claveDia(ZONA, Date.parse('2026-01-23T23:30:00Z')), '2026-01-24');
});

test('sabe el dia de la semana', () => {
  assert.equal(t.diaSemana(ZONA, '2026-08-24'), 'lunes');
  assert.equal(t.diaSemana(ZONA, '2026-08-23'), 'domingo');
});

test('suma dias saltando de mes y de año', () => {
  assert.equal(t.sumarDias('2026-08-31', 1), '2026-09-01');
  assert.equal(t.sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(t.sumarDias('2026-03-01', -1), '2026-02-28');
});

test('cuenta dias entre fechas', () => {
  assert.equal(t.diasEntre('2026-08-21', '2026-08-24'), 3);
  assert.equal(t.diasEntre('2026-08-24', '2026-08-21'), -3);
  assert.equal(t.diasEntre('2026-03-28', '2026-03-30'), 2);
});

test('lee horas escritas de varias maneras', () => {
  assert.equal(t.minutosDeHora('10:30'), 630);
  assert.equal(t.minutosDeHora('9'), 540);
  assert.equal(t.minutosDeHora('09.05'), 545);
  assert.equal(t.minutosDeHora('25:00'), null);
  assert.equal(t.minutosDeHora('10:75'), null);
});

test('escribe horas con dos cifras', () => {
  assert.equal(t.horaDeMinutos(630), '10:30');
  assert.equal(t.horaDeMinutos(0), '00:00');
  assert.equal(t.horaDeMinutos(1439), '23:59');
});

test('escribe la fecha como se dice', () => {
  const ms = t.aUtc(ZONA, { anio: 2026, mes: 8, dia: 24, hora: 10, minuto: 30 });
  assert.equal(t.fechaLarga(ZONA, ms), 'lunes 24 de agosto');
  assert.equal(t.fechaYHora(ZONA, ms), 'lunes 24 de agosto a las 10:30');
  assert.equal(t.fechaLarga(ZONA, ms, { conAnio: true }), 'lunes 24 de agosto de 2026');
});

test('reconoce una clave de dia valida', () => {
  assert.ok(t.esClaveDia('2026-08-24'));
  assert.ok(!t.esClaveDia('24/08/2026'));
  assert.ok(!t.esClaveDia('2026-13-40'));
  assert.ok(!t.esClaveDia(''));
});

test('minutos del dia en hora local', () => {
  assert.equal(t.minutosDelDia(ZONA, t.aUtc(ZONA, { anio: 2026, mes: 8, dia: 24, hora: 16, minuto: 45 })), 1005);
});

test('instanteDe y claveDia son la ida y la vuelta', () => {
  const ms = t.instanteDe(ZONA, '2026-11-02', 570);
  assert.equal(t.claveDia(ZONA, ms), '2026-11-02');
  assert.equal(t.hora(ZONA, ms), '09:30');
});
