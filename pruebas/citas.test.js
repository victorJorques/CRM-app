import test from 'node:test';
import assert from 'node:assert/strict';
import * as citas from '../nucleo/citas.js';
import * as recordatorios from '../nucleo/recordatorios.js';
import { buscarOCrear, ficha } from '../nucleo/clientes.js';
import { montar, negocioDePrueba, instante, LUNES, MARTES, DOMINGO } from './ayuda.js';

function cliente(db, sufijo = '001') {
  return buscarOCrear(db, { telefono: `+346001110${sufijo}`, nombre: `Cliente ${sufijo}` });
}

test('reservar deja la cita con todos sus datos', () => {
  const { db, config, ahora } = montar();
  const quien = cliente(db);
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  assert.ok(r.ok);
  assert.equal(r.cita.servicio_nombre, 'Corte');
  assert.equal(r.cita.estado, 'reservada');
  assert.equal(r.cita.precio_centimos, 2000);
  assert.equal(r.cita.fin_visible - r.cita.inicio, 30 * 60000);
});

test('reservar crea la ficha del cliente si no la había', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, {
    servicioId: 'corte', inicio: instante(LUNES, 10), cliente: { telefono: '600222333', nombre: 'Nuevo' }, ahora,
  });
  assert.ok(r.ok);
  assert.equal(ficha(db, r.cita.cliente_id).telefono, '+34600222333');
});

test('dos personas no caben en el mismo hueco con una sola silla', () => {
  const { db, config, ahora } = montar();
  const primera = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db, '001').id, ahora });
  const segunda = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db, '002').id, ahora });
  assert.ok(primera.ok);
  assert.ok(!segunda.ok);
  assert.equal(segunda.motivo, 'ocupado');
  assert.ok(segunda.alternativas.length > 0);
});

test('una hora que no existe en el horario no se reserva', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 15), clienteId: cliente(db).id, ahora });
  assert.ok(!r.ok);
  assert.equal(r.motivo, 'fuera-de-horario');
});

test('un domingo no se reserva', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(DOMINGO, 10), clienteId: cliente(db).id, ahora });
  assert.ok(!r.ok);
});

test('un servicio que no existe no se reserva', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'masaje-lunar', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  assert.equal(r.motivo, 'servicio-desconocido');
});

test('reservar guarda por qué canal entró', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, canal: 'whatsapp', ahora });
  assert.equal(r.cita.canal, 'whatsapp');
});

test('reservar programa el recordatorio de la víspera', () => {
  const { db, config, ahora } = montar();
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  const pendientes = recordatorios.listar(db, { estado: 'pendiente' });
  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].tipo, 'vispera');
});

test('mover cambia la hora y deja libre la anterior', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db).id, ahora });
  const movida = citas.mover(db, config, { citaId: r.cita.id, nuevoInicio: instante(LUNES, 12), ahora });
  assert.ok(movida.ok);
  assert.equal(movida.cita.inicio, instante(LUNES, 12));
  const otra = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db, '002').id, ahora });
  assert.ok(otra.ok);
});

test('mover a una hora ocupada no rompe la cita original', () => {
  const { db, config, ahora } = montar();
  const uno = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db, '001').id, ahora });
  const dos = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 11), recursoId: 'ana', clienteId: cliente(db, '002').id, ahora });
  const movida = citas.mover(db, config, { citaId: dos.cita.id, nuevoInicio: instante(LUNES, 10), recursoId: 'ana', ahora });
  assert.ok(!movida.ok);
  assert.equal(citas.porId(db, dos.cita.id).inicio, instante(LUNES, 11));
});

test('mover a su propia hora no se estorba a sí misma', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db).id, ahora });
  const movida = citas.mover(db, config, { citaId: r.cita.id, nuevoInicio: instante(LUNES, 10), recursoId: 'ana', ahora });
  assert.ok(movida.ok);
});

test('mover reprograma el recordatorio', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  citas.mover(db, config, { citaId: r.cita.id, nuevoInicio: instante(MARTES, 10), ahora });
  const pendientes = recordatorios.listar(db, { estado: 'pendiente' });
  assert.equal(pendientes.length, 1);
  assert.equal(new Date(pendientes[0].cuando).getUTCDate(), 24);
});

test('anular deja rastro y cancela el recordatorio', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  const anulada = citas.anular(db, config, { citaId: r.cita.id, motivo: 'me surgió algo', ahora });
  assert.ok(anulada.ok);
  assert.equal(anulada.cita.estado, 'anulada');
  assert.match(anulada.cita.notas, /me surgió algo/);
  assert.equal(recordatorios.listar(db, { estado: 'pendiente' }).length, 0);
});

test('anular avisa cuando llega tarde según la política', () => {
  const config = negocioDePrueba({ reglas: { granularidadMinutos: 30, antelacionMinimaHoras: 2, cancelacionMinimaHoras: 48 } });
  const { db, ahora } = montar();
  // La cita es hoy a mediodía y la política pide avisar con 48 h: llega tarde.
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante('2026-08-21', 12), clienteId: cliente(db).id, ahora });
  assert.ok(r.ok, r.motivo);
  const anulada = citas.anular(db, config, { citaId: r.cita.id, ahora });
  assert.ok(anulada.tarde);
});

test('anular a tiempo no marca retraso', () => {
  const config = negocioDePrueba({ reglas: { granularidadMinutos: 30, antelacionMinimaHoras: 2, cancelacionMinimaHoras: 24 } });
  const { db, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  assert.ok(!citas.anular(db, config, { citaId: r.cita.id, ahora }).tarde);
});

test('anular deja el hueco libre otra vez', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db, '001').id, ahora });
  citas.anular(db, config, { citaId: r.cita.id, ahora });
  const otra = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), recursoId: 'ana', clienteId: cliente(db, '002').id, ahora });
  assert.ok(otra.ok);
});

test('anular dos veces no se queja', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  citas.anular(db, config, { citaId: r.cita.id, ahora });
  const otra = citas.anular(db, config, { citaId: r.cita.id, ahora });
  assert.ok(otra.ok);
  assert.ok(otra.yaEstaba);
});

test('marcar atendida cierra el círculo y suma al gasto', () => {
  const { db, config, ahora } = montar();
  const quien = cliente(db);
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  citas.marcar(db, config, { citaId: r.cita.id, estado: 'atendida' });
  assert.equal(ficha(db, quien.id).gastoCentimos, 2000);
});

test('marcar atendida con otro precio manda el precio nuevo', () => {
  const { db, config, ahora } = montar();
  const quien = cliente(db);
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  citas.marcar(db, config, { citaId: r.cita.id, estado: 'atendida', precio: 25.5 });
  assert.equal(ficha(db, quien.id).gastoCentimos, 2550);
});

test('marcar que no vino lo apunta en su ficha', () => {
  const { db, config, ahora } = montar();
  const quien = cliente(db);
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  citas.marcar(db, config, { citaId: r.cita.id, estado: 'no_vino' });
  assert.equal(ficha(db, quien.id).noVino, 1);
});

test('quien no vino queda apuntado para escribirle', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  citas.marcar(db, config, { citaId: r.cita.id, estado: 'no_vino' });
  const tipos = recordatorios.listar(db, {}).map((r2) => `${r2.tipo}:${r2.estado}`);
  assert.ok(tipos.includes('no_vino:pendiente'));
});

test('un estado que no existe se rechaza', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  assert.equal(citas.marcar(db, config, { citaId: r.cita.id, estado: 'regular' }).motivo, 'estado-desconocido');
});

test('las citas del cliente salen ordenadas y las próximas se filtran', () => {
  const { db, config, ahora } = montar();
  const quien = cliente(db);
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora });
  citas.reservar(db, config, { servicioId: 'corte', inicio: instante(MARTES, 10), clienteId: quien.id, ahora });
  const proximas = citas.deCliente(db, quien.id, { soloProximas: true, ahora });
  assert.equal(proximas.length, 2);
  assert.ok(proximas[0].inicio < proximas[1].inicio);
});

test('las citas pasadas sin cerrar salen en la lista de por cerrar', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  assert.equal(citas.pendientesDeCerrar(db, { ahora }).length, 0);
  const despues = instante(LUNES, 12);
  const lista = citas.pendientesDeCerrar(db, { ahora: despues });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, r.cita.id);
});

test('una cita cerrada ya no sale como pendiente', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  citas.marcar(db, config, { citaId: r.cita.id, estado: 'atendida' });
  assert.equal(citas.pendientesDeCerrar(db, { ahora: instante(LUNES, 12) }).length, 0);
});

test('las notas de la cita se guardan', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  assert.equal(citas.notas(db, r.cita.id, 'viene con su hija').notas, 'viene con su hija');
});

test('cada movimiento queda en el registro de eventos', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: cliente(db).id, ahora });
  citas.anular(db, config, { citaId: r.cita.id, ahora });
  const tipos = db.filas('SELECT tipo FROM eventos').map((e) => e.tipo);
  assert.ok(tipos.includes('cita.reservada'));
  assert.ok(tipos.includes('cita.anulada'));
});

test('una cita sin ningún dato del cliente no se guarda', () => {
  const { db, config, ahora } = montar();
  const r = citas.reservar(db, config, {
    servicioId: 'corte', inicio: instante(LUNES, 10), cliente: { telefono: '', nombre: '' }, ahora,
  });
  assert.ok(!r.ok);
  assert.equal(r.motivo, 'sin-contacto');
  assert.equal(db.valor('SELECT COUNT(*) FROM citas'), 0);
  assert.equal(db.valor('SELECT COUNT(*) FROM clientes'), 0);
});
