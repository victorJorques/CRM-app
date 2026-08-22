import test from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../nucleo/redaccion.js';
import { negocioDePrueba, plantilla, instante, LUNES, AHORA, ZONA } from './ayuda.js';
import { revisarConfig } from '../nucleo/config.js';

const config = negocioDePrueba();

test('enumera como se habla', () => {
  assert.equal(r.enumerar(['10:00']), '10:00');
  assert.equal(r.enumerar(['10:00', '10:30']), '10:00 y 10:30');
  assert.equal(r.enumerar(['10:00', '10:30', '11:00']), '10:00, 10:30 y 11:00');
  assert.equal(r.enumerar(['a', 'b'], 'o'), 'a o b');
});

test('escribe el dinero en euros y sin decimales de más', () => {
  assert.equal(r.dinero(config, 2000), '20 €');
  assert.equal(r.dinero(config, 2550), '25,50 €');
  assert.equal(r.dinero(config, null), '');
});

test('un servicio gratis se dice gratis', () => {
  const { config: clinica } = revisarConfig(plantilla('dentista'));
  const primera = clinica.servicios.find((s) => s.id === 'primera-visita');
  assert.equal(r.precioServicio(clinica, primera), 'gratis');
});

test('dice hoy y mañana en vez de la fecha', () => {
  assert.equal(r.cuandoRelativo(config, instante('2026-08-21', 12), AHORA), 'hoy');
  assert.equal(r.cuandoRelativo(config, instante('2026-08-22', 12), AHORA), 'mañana');
  assert.equal(r.cuandoRelativo(config, instante('2026-08-23', 12), AHORA), 'pasado mañana');
  assert.equal(r.cuandoRelativo(config, instante(LUNES, 12), AHORA), 'el lunes 24 de agosto');
});

test('ofrece las horas agrupadas por día', () => {
  const huecos = [
    { dia: LUNES, hora: '10:00', inicio: instante(LUNES, 10) },
    { dia: LUNES, hora: '10:30', inicio: instante(LUNES, 10, 30) },
  ];
  const texto = r.ofertaDeHuecos(config, huecos, { ahora: AHORA });
  assert.match(texto, /El lunes 24 de agosto tengo 10:00 y 10:30/);
  assert.match(texto, /¿Cuál te viene mejor\?/);
});

test('sin huecos no se inventa una frase', () => {
  assert.equal(r.ofertaDeHuecos(config, [], { ahora: AHORA }), null);
});

test('la propuesta lleva servicio, cuándo y precio', () => {
  const servicio = config.servicios[0];
  const texto = r.propuesta(config, {
    servicio,
    hueco: { inicio: instante(LUNES, 10), recursoNombre: 'Ana' },
    ahora: AHORA,
  });
  assert.match(texto, /corte/);
  assert.match(texto, /el lunes 24 de agosto a las 10:00/);
  assert.match(texto, /20 €/);
  assert.match(texto, /¿Te la confirmo\?/);
});

test('la confirmación saluda por el nombre y avisa del recordatorio', () => {
  const texto = r.confirmacion(config, {
    servicio_nombre: 'Corte', recurso_nombre: 'Ana', inicio: instante(LUNES, 10),
  }, { nombre: 'Rocío Márquez' });
  assert.match(texto, /Hecho, Rocío:/);
  assert.match(texto, /lunes 24 de agosto a las 10:00/);
  assert.match(texto, /recordatorio el día de antes/);
});

test('el horario se escribe día por día', () => {
  const lineas = r.horarioTexto(config);
  assert.match(lineas[0], /lunes: 09:00 a 14:00 y 16:00 a 20:00/);
  assert.ok(!lineas.some((l) => l.startsWith('domingo')));
});

test('la lista de servicios lleva precio y duración', () => {
  const lista = r.listaServicios(config);
  assert.match(lista[0], /Corte \(20 €, 30 min\)/);
});

test('el recordatorio de la víspera dice la hora', () => {
  const texto = r.recordatorioVispera(config, {
    servicio_nombre: 'Corte', recurso_nombre: 'Ana', inicio: instante(LUNES, 10),
  });
  assert.match(texto, /mañana a las 10:00/);
  assert.match(texto, /lo cambiamos/);
});

test('la anulación avisa cuando llega tarde', () => {
  const cita = { servicio_nombre: 'Corte', inicio: instante(LUNES, 10) };
  const aTiempo = r.anulacionConfirmada(config, cita, { ahora: AHORA });
  const tarde = r.anulacionConfirmada(config, cita, { tarde: true, ahora: AHORA });
  assert.match(aTiempo, /Anulada la cita de Corte/);
  assert.ok(!/margen/.test(aTiempo));
  assert.match(tarde, /margen/);
});

test('el vocabulario del negocio se nota en lo que dice', () => {
  const { config: clinica } = revisarConfig(plantilla('dentista'));
  const texto = r.anulacionConfirmada(clinica, {
    servicio_nombre: 'Limpieza', inicio: instante(LUNES, 10),
  }, { ahora: AHORA });
  assert.match(texto, /Anulada la visita/);
});

test('el resumen de la ficha cabe en una línea', () => {
  const texto = r.fichaResumen(config, {
    nombre: 'Rocío', telefono: '+34600111222', atendidas: 3, gastoCentimos: 6000, noVino: 1,
  });
  assert.equal(texto, 'Rocío · +34600111222 · 3 visitas · 60 € en total · 1 ausencia');
});
