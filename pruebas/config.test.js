import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
  revisarConfig, servicioPorId, recursoPorId, recursosDe, horarioDe, esFestivo, motivoCierre, aClave,
} from '../nucleo/config.js';
import { negocioDePrueba, plantilla, ZONA } from './ayuda.js';

const base = {
  negocio: { nombre: 'Sitio', zonaHoraria: ZONA },
  horario: { lunes: [['09:00', '14:00']] },
  servicios: [{ nombre: 'Corte', duracionMinutos: 30, precio: 20 }],
};

test('una configuración mínima vale', () => {
  const r = revisarConfig(base);
  assert.ok(r.ok, r.errores.join(' | '));
});

test('sin nombre de negocio se queja en castellano', () => {
  const r = revisarConfig({ ...base, negocio: { zonaHoraria: ZONA } });
  assert.ok(!r.ok);
  assert.match(r.errores.join(' '), /nombre del negocio/i);
});

test('sin ningún día abierto se queja', () => {
  const r = revisarConfig({ ...base, horario: { lunes: [] } });
  assert.match(r.errores.join(' '), /ni un solo día abierto/i);
});

test('sin servicios se queja', () => {
  const r = revisarConfig({ ...base, servicios: [] });
  assert.match(r.errores.join(' '), /al menos uno/i);
});

test('un tramo al revés se detecta', () => {
  const r = revisarConfig({ ...base, horario: { lunes: [['20:00', '09:00']] } });
  assert.match(r.errores.join(' '), /termina antes de empezar/i);
});

test('dos tramos que se pisan se detectan', () => {
  const r = revisarConfig({ ...base, horario: { lunes: [['09:00', '14:00'], ['13:00', '18:00']] } });
  assert.match(r.errores.join(' '), /se pisan/i);
});

test('una hora mal escrita se detecta', () => {
  const r = revisarConfig({ ...base, horario: { lunes: [['9am', '2pm']] } });
  assert.match(r.errores.join(' '), /no son horas válidas/i);
});

test('un día que no existe se detecta', () => {
  const r = revisarConfig({ ...base, horario: { lunes: [['09:00', '14:00']], lunez: [['09:00', '10:00']] } });
  assert.match(r.errores.join(' '), /no es un día de la semana/i);
});

test('los días con tilde también valen', () => {
  const r = revisarConfig({ ...base, horario: { miércoles: [['09:00', '14:00']] } });
  assert.ok(r.ok, r.errores.join(' | '));
  assert.equal(r.config.horario.miercoles.length, 1);
});

test('una duración que no es número se detecta', () => {
  const r = revisarConfig({ ...base, servicios: [{ nombre: 'Corte', duracionMinutos: 'media hora' }] });
  assert.match(r.errores.join(' '), /minutos mayor que cero/i);
});

test('un servicio que apunta a alguien que no existe se detecta', () => {
  const r = revisarConfig({ ...base, servicios: [{ nombre: 'Tinte', duracionMinutos: 60, recursos: ['pepa'] }], recursos: [{ nombre: 'Ana' }] });
  assert.match(r.errores.join(' '), /no está en la lista de recursos/i);
});

test('dos recursos con el mismo identificador se detectan', () => {
  const r = revisarConfig({ ...base, recursos: [{ nombre: 'Ana' }, { nombre: 'ana' }] });
  assert.match(r.errores.join(' '), /mismo identificador/i);
});

test('una zona horaria inventada se detecta', () => {
  const r = revisarConfig({ ...base, negocio: { nombre: 'X', zonaHoraria: 'Europe/Atlantida' } });
  assert.match(r.errores.join(' '), /no existe/i);
});

test('un festivo mal escrito se detecta', () => {
  const r = revisarConfig({ ...base, festivos: ['25 de diciembre'] });
  assert.match(r.errores.join(' '), /formato 2026-12-25/i);
});

test('un cierre al revés se detecta', () => {
  const r = revisarConfig({ ...base, cierres: [{ desde: '2026-08-15', hasta: '2026-08-01' }] });
  assert.match(r.errores.join(' '), /termina antes/i);
});

test('sin recursos se inventa uno y avisa', () => {
  const r = revisarConfig(base);
  assert.equal(r.config.recursos.length, 1);
  assert.match(r.avisos.join(' '), /No hay recursos declarados/i);
});

test('el identificador sale del nombre, sin tildes ni signos', () => {
  assert.equal(aClave('Dra. Gómez'), 'dra-gomez');
  assert.equal(aClave('Elevador 2'), 'elevador-2');
});

test('los valores por defecto están puestos', () => {
  const { config } = revisarConfig(base);
  assert.equal(config.reglas.granularidadMinutos, 15);
  assert.equal(config.vocabulario.cita, 'cita');
  assert.equal(config.modelo.nombre, 'claude-opus-5');
  assert.equal(config.negocio.moneda, 'EUR');
});

test('el vocabulario se puede cambiar entero', () => {
  const { config } = revisarConfig({ ...base, vocabulario: { cita: 'visita', cliente: 'paciente' } });
  assert.equal(config.vocabulario.cita, 'visita');
  assert.equal(config.vocabulario.cliente, 'paciente');
  assert.equal(config.vocabulario.servicio, 'servicio');
});

test('un recurso sin horario propio hereda el del negocio', () => {
  const config = negocioDePrueba();
  const ana = recursoPorId(config, 'ana');
  assert.deepEqual(horarioDe(config, ana, 'lunes'), config.horario.lunes);
});

test('un recurso con horario propio manda sobre el del negocio', () => {
  const config = negocioDePrueba();
  assert.deepEqual(horarioDe(config, recursoPorId(config, 'luis'), 'lunes'), []);
});

test('un servicio sin lista de recursos lo hace todo el mundo', () => {
  const config = negocioDePrueba();
  assert.equal(recursosDe(config, servicioPorId(config, 'corte')).length, 2);
});

test('un servicio con lista solo lo hace quien está en ella', () => {
  const config = negocioDePrueba();
  const quienes = recursosDe(config, servicioPorId(config, 'tinte'));
  assert.deepEqual(quienes.map((r) => r.id), ['ana']);
});

test('los festivos y los cierres cierran', () => {
  const config = negocioDePrueba({
    festivos: ['2026-12-25'],
    cierres: [{ desde: '2026-08-01', hasta: '2026-08-15', motivo: 'vacaciones' }],
  });
  assert.ok(esFestivo(config, '2026-12-25'));
  assert.ok(esFestivo(config, '2026-08-07'));
  assert.ok(!esFestivo(config, '2026-08-20'));
  assert.equal(motivoCierre(config, '2026-08-07'), 'vacaciones');
  assert.equal(motivoCierre(config, '2026-12-25'), 'festivo');
});

test('todas las plantillas que se reparten son válidas', () => {
  const nombres = readdirSync(new URL('../plantillas', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.ok(nombres.length >= 5);
  for (const nombre of nombres) {
    const r = revisarConfig(plantilla(nombre.replace('.json', '')));
    assert.ok(r.ok, `${nombre}: ${r.errores.join(' | ')}`);
  }
});

test('la plantilla de clínica habla de visitas y pacientes', () => {
  const { config } = revisarConfig(plantilla('dentista'));
  assert.equal(config.vocabulario.cita, 'visita');
  assert.equal(config.vocabulario.cliente, 'paciente');
});

test('la plantilla de taller usa elevadores como recursos', () => {
  const { config } = revisarConfig(plantilla('taller'));
  assert.equal(config.vocabulario.recurso, 'elevador');
  assert.ok(config.recursos.length >= 2);
});
