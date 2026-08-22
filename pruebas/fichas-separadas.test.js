// Cada cliente, su ficha. Este fichero existe para que quede escrito y
// comprobado: nadie puede ver, mover ni anular la cita de otro, ni por
// descuido del bot ni pidiéndolo a propósito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ejecutar } from '../cerebro/herramientas.js';
import { contestar } from '../cerebro/index.js';
import * as bandeja from '../nucleo/bandeja.js';
import * as clientes from '../nucleo/clientes.js';
import * as citas from '../nucleo/citas.js';
import { montar, instante, LUNES, MARTES } from './ayuda.js';

const CARMEN = '+34600111230';
const TONI = '+34600111231';

/** Dos clientes con cita cada uno, como en la clínica de la demostración. */
function dosClientes(entorno) {
  const carmen = clientes.buscarOCrear(entorno.db, { nombre: 'Carmen Ortiz', telefono: CARMEN });
  const toni = clientes.buscarOCrear(entorno.db, { nombre: 'Toni Bou', telefono: TONI });
  const suya = citas.reservar(entorno.db, entorno.config, {
    servicioId: 'corte', inicio: instante(LUNES, 9), clienteId: carmen.id, ahora: entorno.ahora,
  });
  const delOtro = citas.reservar(entorno.db, entorno.config, {
    servicioId: 'tinte', inicio: instante(MARTES, 10), clienteId: toni.id, ahora: entorno.ahora,
  });
  assert.ok(suya.ok && delOtro.ok);
  return { carmen, toni, deCarmen: suya.cita, deToni: delOtro.cita };
}

function contexto(entorno, telefono) {
  const cliente = clientes.porTelefono(entorno.db, telefono);
  const conversacion = bandeja.abrir(entorno.db, { canal: 'whatsapp', externo: telefono, clienteId: cliente?.id ?? null });
  return {
    db: entorno.db, config: entorno.config, conversacion,
    contacto: { telefono }, canal: 'whatsapp', ahora: entorno.ahora,
  };
}

test('cada uno ve solo sus citas', () => {
  const entorno = montar();
  const { deCarmen, deToni } = dosClientes(entorno);
  const suyas = ejecutar('mis_citas', {}, contexto(entorno, CARMEN));
  assert.deepEqual(suyas._citas.map((c) => c.id), [deCarmen.id]);
  const delOtro = ejecutar('mis_citas', {}, contexto(entorno, TONI));
  assert.deepEqual(delOtro._citas.map((c) => c.id), [deToni.id]);
});

test('el bot no nombra la cita de otro al contestar', async () => {
  const entorno = montar();
  dosClientes(entorno);
  const r = await contestar({
    db: entorno.db, config: entorno.config, canal: 'whatsapp', externo: CARMEN,
    texto: 'hola, tenía cita a las 9', contacto: { telefono: CARMEN },
    ahora: entorno.ahora, forzarCerebro: 'reglas',
  });
  assert.match(r.texto, /Corte/);
  assert.ok(!/Tinte/.test(r.texto), `nombra la cita de otro: ${r.texto}`);
  assert.ok(!/martes/.test(r.texto), `nombra el día de otro: ${r.texto}`);
});

test('pidiendo la cita de otro por su identificador, no se mueve', () => {
  const entorno = montar();
  const { deToni } = dosClientes(entorno);
  const r = ejecutar('mover_cita', {
    cita_id: deToni.id, dia: MARTES, hora: '12:00',
  }, contexto(entorno, CARMEN));
  assert.ok(!r.ok);
  assert.equal(citas.porId(entorno.db, deToni.id).inicio, instante(MARTES, 10));
});

test('pidiendo la cita de otro por su identificador, no se anula', () => {
  const entorno = montar();
  const { deToni } = dosClientes(entorno);
  const r = ejecutar('anular_cita', { cita_id: deToni.id }, contexto(entorno, CARMEN));
  assert.ok(!r.ok);
  assert.equal(citas.porId(entorno.db, deToni.id).estado, 'reservada');
});

test('reservar con la conversación de uno no apunta la cita al otro', () => {
  const entorno = montar();
  const { carmen } = dosClientes(entorno);
  const r = ejecutar('reservar', { servicio: 'corte', dia: MARTES, hora: '11:00' }, contexto(entorno, CARMEN));
  assert.ok(r.ok);
  assert.equal(r._cita.cliente_id, carmen.id);
});

test('dos conversaciones, dos fichas, y ninguna se lleva la del otro', () => {
  const entorno = montar();
  const { carmen, toni } = dosClientes(entorno);
  const unaConversacion = contexto(entorno, CARMEN).conversacion;
  const otraConversacion = contexto(entorno, TONI).conversacion;
  assert.notEqual(unaConversacion.id, otraConversacion.id);
  assert.equal(unaConversacion.cliente_id, carmen.id);
  assert.equal(otraConversacion.cliente_id, toni.id);
});

test('la ficha de uno no arrastra citas del otro', () => {
  const entorno = montar();
  const { carmen, deCarmen } = dosClientes(entorno);
  const ficha = clientes.ficha(entorno.db, carmen.id);
  assert.equal(ficha.citas.length, 1);
  assert.equal(ficha.citas[0].id, deCarmen.id);
  assert.equal(ficha.total, 1);
});

test('el mismo teléfono escrito de otra forma es la misma persona, no una nueva', () => {
  const entorno = montar();
  const { carmen } = dosClientes(entorno);
  const otraVez = clientes.buscarOCrear(entorno.db, { telefono: '600 111 230' });
  assert.equal(otraVez.id, carmen.id);
  assert.equal(entorno.db.valor('SELECT COUNT(*) FROM clientes'), 2);
});

test('dos personas distintas sin teléfono no se funden en una', () => {
  const { db } = montar();
  const una = clientes.buscarOCrear(db, { nombre: 'María' });
  const otra = clientes.buscarOCrear(db, { nombre: 'María' });
  assert.notEqual(una.id, otra.id);
});

test('quien escribe desde un número desconocido no hereda la ficha de nadie', () => {
  const entorno = montar();
  dosClientes(entorno);
  const r = ejecutar('mis_citas', {}, contexto(entorno, '+34600999000'));
  assert.deepEqual(r.citas, []);
});

test('cambiar de cliente en el simulador no arrastra la conversación anterior', async () => {
  const entorno = montar();
  dosClientes(entorno);
  const comoCarmen = await contestar({
    db: entorno.db, config: entorno.config, canal: 'simulador', externo: CARMEN,
    texto: '¿qué citas tengo?', contacto: { telefono: CARMEN }, ahora: entorno.ahora, forzarCerebro: 'reglas',
  });
  const comoToni = await contestar({
    db: entorno.db, config: entorno.config, canal: 'simulador', externo: TONI,
    texto: '¿qué citas tengo?', contacto: { telefono: TONI }, ahora: entorno.ahora, forzarCerebro: 'reglas',
  });
  assert.match(comoCarmen.texto, /Corte/);
  assert.ok(!/Tinte/.test(comoCarmen.texto));
  assert.match(comoToni.texto, /Tinte/);
  assert.ok(!/Corte/.test(comoToni.texto));
});

test('la alternativa que le ofrece a uno no es la cita de otro', () => {
  const entorno = montar();
  const { carmen, deToni } = dosClientes(entorno);
  const r = ejecutar('buscar_huecos', { servicio: 'corte' }, contexto(entorno, CARMEN));
  const chocan = (r._huecos ?? []).filter((h) => h.inicio === deToni.inicio && h.recursoId === deToni.recurso_id);
  assert.equal(chocan.length, 0, 'ofrece una hora que ya tiene otro cliente');
});

test('lo que se le ofrece a uno está libre de verdad para él', () => {
  const entorno = montar();
  const { carmen } = dosClientes(entorno);
  const r = ejecutar('buscar_huecos', { servicio: 'corte' }, contexto(entorno, CARMEN));
  for (const hueco of (r._huecos ?? []).slice(0, 3)) {
    const reserva = citas.reservar(entorno.db, entorno.config, {
      servicioId: 'corte', inicio: hueco.inicio, recursoId: hueco.recursoId,
      clienteId: carmen.id, ahora: entorno.ahora,
    });
    assert.ok(reserva.ok, `ofreció ${hueco.hora} y luego no se puede reservar: ${reserva.motivo}`);
  }
});
