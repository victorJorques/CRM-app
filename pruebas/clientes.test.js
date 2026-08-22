import test from 'node:test';
import assert from 'node:assert/strict';
import * as clientes from '../nucleo/clientes.js';
import * as citas from '../nucleo/citas.js';
import { montar, instante, LUNES, MARTES } from './ayuda.js';

test('normaliza teléfonos españoles escritos de cualquier manera', () => {
  assert.equal(clientes.normalizarTelefono('600 11 12 22'), '+34600111222');
  assert.equal(clientes.normalizarTelefono('600-111-222'), '+34600111222');
  assert.equal(clientes.normalizarTelefono('(600) 111 222'), '+34600111222');
  assert.equal(clientes.normalizarTelefono('+34 600 111 222'), '+34600111222');
  assert.equal(clientes.normalizarTelefono('0034600111222'), '+34600111222');
});

test('un teléfono que no lo es se queda en nada', () => {
  assert.equal(clientes.normalizarTelefono('12345'), null);
  assert.equal(clientes.normalizarTelefono(''), null);
  assert.equal(clientes.normalizarTelefono(null), null);
});

test('normaliza correos y rechaza lo que no lo es', () => {
  assert.equal(clientes.normalizarCorreo('  Rocio@Mail.COM '), 'rocio@mail.com');
  assert.equal(clientes.normalizarCorreo('rocio(arroba)mail'), null);
});

test('la ficha se crea sola con solo el teléfono', () => {
  const { db } = montar();
  const ficha = clientes.buscarOCrear(db, { telefono: '600111222' });
  assert.equal(ficha.telefono, '+34600111222');
  assert.equal(ficha.nombre, '');
});

test('el mismo teléfono no crea dos fichas', () => {
  const { db } = montar();
  const uno = clientes.buscarOCrear(db, { telefono: '600111222' });
  const dos = clientes.buscarOCrear(db, { telefono: '+34 600 111 222' });
  assert.equal(uno.id, dos.id);
});

test('un dato nuevo completa la ficha sin pisar lo que ya había', () => {
  const { db } = montar();
  const uno = clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Rocío' });
  const dos = clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Otra', correo: 'rocio@mail.com' });
  assert.equal(dos.id, uno.id);
  assert.equal(dos.nombre, 'Rocío');
  assert.equal(dos.correo, 'rocio@mail.com');
});

test('el correo también identifica a quien ya está', () => {
  const { db } = montar();
  const uno = clientes.buscarOCrear(db, { correo: 'ana@mail.com' });
  const dos = clientes.buscarOCrear(db, { correo: 'ANA@mail.com', telefono: '600999888' });
  assert.equal(uno.id, dos.id);
  assert.equal(dos.telefono, '+34600999888');
});

test('actualizar cambia lo que se le pide y nada más', () => {
  const { db } = montar();
  const ficha = clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Rocío' });
  const nueva = clientes.actualizar(db, ficha.id, { notas: 'alérgica al amoniaco' });
  assert.equal(nueva.notas, 'alérgica al amoniaco');
  assert.equal(nueva.nombre, 'Rocío');
});

test('las etiquetas se guardan como lista', () => {
  const { db } = montar();
  const ficha = clientes.buscarOCrear(db, { telefono: '600111222' });
  const nueva = clientes.actualizar(db, ficha.id, { etiquetas: ['vip', 'tarde'] });
  assert.deepEqual(nueva.etiquetas, ['vip', 'tarde']);
});

test('la ficha cuenta visitas, gasto y ausencias', () => {
  const { db, config, ahora } = montar();
  const quien = clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Rocío' });
  const uno = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  const dos = citas.reservar(db, config, { servicioId: 'tinte', inicio: instante(MARTES, 10), clienteId: quien.id, ahora });
  citas.marcar(db, config, { citaId: uno.cita.id, estado: 'atendida' });
  citas.marcar(db, config, { citaId: dos.cita.id, estado: 'no_vino' });
  const ficha = clientes.ficha(db, quien.id);
  assert.equal(ficha.total, 2);
  assert.equal(ficha.atendidas, 1);
  assert.equal(ficha.noVino, 1);
  assert.equal(ficha.gastoCentimos, 2000);
});

test('la ficha enseña la próxima cita', () => {
  const { db, config, ahora } = montar();
  const quien = clientes.buscarOCrear(db, { telefono: '600111222' });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(MARTES, 10), clienteId: quien.id, ahora });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  assert.equal(clientes.ficha(db, quien.id).proxima.inicio, instante(LUNES, 10));
});

test('buscar por nombre no distingue tildes ni mayúsculas', () => {
  const { db } = montar();
  clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Rocío Márquez' });
  assert.equal(clientes.listar(db, { busqueda: 'rocio' }).length, 1);
  assert.equal(clientes.listar(db, { busqueda: 'MÁRQUEZ' }).length, 1);
  assert.equal(clientes.listar(db, { busqueda: 'javier' }).length, 0);
});

test('buscar por teléfono encuentra por el trozo final', () => {
  const { db } = montar();
  clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Rocío' });
  assert.equal(clientes.listar(db, { busqueda: '111222' }).length, 1);
});

test('quien lleva mucho sin venir sale en la lista de inactivos', () => {
  const { db, config } = montar();
  const viejo = clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Antiguo' });
  const nuevo = clientes.buscarOCrear(db, { telefono: '600111333', nombre: 'Reciente' });
  const haceMucho = Date.parse('2026-01-12T09:00:00Z');
  const r1 = citas.reservar(db, config, { servicioId: 'corte', inicio: instante('2026-01-12', 10), clienteId: viejo.id, ahora: haceMucho - 86400000 });
  const r2 = citas.reservar(db, config, { servicioId: 'corte', inicio: instante('2026-08-17', 10), clienteId: nuevo.id, ahora: Date.parse('2026-08-14T09:00:00Z') });
  citas.marcar(db, config, { citaId: r1.cita.id, estado: 'atendida' });
  citas.marcar(db, config, { citaId: r2.cita.id, estado: 'atendida' });
  const lista = clientes.inactivos(db, { dias: 120, ahora: Date.parse('2026-08-21T09:00:00Z') });
  assert.deepEqual(lista.map((c) => c.nombre), ['Antiguo']);
});

test('quien ya tiene cita pedida no sale como inactivo', () => {
  const { db, config, ahora } = montar();
  const quien = clientes.buscarOCrear(db, { telefono: '600111222', nombre: 'Antiguo' });
  const vieja = citas.reservar(db, config, { servicioId: 'corte', inicio: instante('2026-01-12', 10), clienteId: quien.id, ahora: Date.parse('2026-01-09T09:00:00Z') });
  citas.marcar(db, config, { citaId: vieja.cita.id, estado: 'atendida' });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  assert.equal(clientes.inactivos(db, { dias: 120, ahora }).length, 0);
});
