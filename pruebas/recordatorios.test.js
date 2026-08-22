import test from 'node:test';
import assert from 'node:assert/strict';
import * as recordatorios from '../nucleo/recordatorios.js';
import * as citas from '../nucleo/citas.js';
import * as clientes from '../nucleo/clientes.js';
import * as bandeja from '../nucleo/bandeja.js';
import { pasada } from '../nucleo/reloj.js';
import { montar, negocioDePrueba, instante, LUNES, MARTES, AHORA } from './ayuda.js';

function conCita(entorno, { clave = LUNES, hora = 10 } = {}) {
  const quien = clientes.buscarOCrear(entorno.db, { telefono: '+34600111222', nombre: 'Rocío' });
  return citas.reservar(entorno.db, entorno.config, {
    servicioId: 'corte', inicio: instante(clave, hora), clienteId: quien.id, ahora: entorno.ahora,
  }).cita;
}

test('el recordatorio se programa la víspera a la hora configurada', () => {
  const entorno = montar();
  const cita = conCita(entorno);
  const [recordatorio] = recordatorios.listar(entorno.db, {});
  assert.equal(recordatorio.tipo, 'vispera');
  assert.equal(new Date(recordatorio.cuando).toISOString(), '2026-08-23T16:00:00.000Z'); // 18:00 en Madrid
  assert.ok(recordatorio.cuando < cita.inicio);
});

test('sin recordatorios en la configuración no se programa nada', () => {
  const config = negocioDePrueba({ recordatorios: { vispera: false } });
  const entorno = { ...montar(), config };
  conCita(entorno);
  assert.equal(recordatorios.listar(entorno.db, {}).length, 0);
});

test('una cita para hoy no genera recordatorio de víspera', () => {
  const entorno = montar();
  conCita(entorno, { clave: '2026-08-21', hora: 12 });
  assert.equal(recordatorios.listar(entorno.db, {}).length, 0);
});

test('mover la cita mueve el recordatorio', () => {
  const entorno = montar();
  const cita = conCita(entorno);
  citas.mover(entorno.db, entorno.config, { citaId: cita.id, nuevoInicio: instante(MARTES, 10), ahora: entorno.ahora });
  const [recordatorio] = recordatorios.listar(entorno.db, { estado: 'pendiente' });
  assert.equal(new Date(recordatorio.cuando).toISOString(), '2026-08-24T16:00:00.000Z');
});

test('anular la cita cancela el recordatorio', () => {
  const entorno = montar();
  const cita = conCita(entorno);
  citas.anular(entorno.db, entorno.config, { citaId: cita.id, ahora: entorno.ahora });
  assert.equal(recordatorios.listar(entorno.db, { estado: 'pendiente' }).length, 0);
  assert.equal(recordatorios.listar(entorno.db, { estado: 'cancelado' }).length, 1);
});

test('solo salen como pendientes los que ya tocan', () => {
  const entorno = montar();
  conCita(entorno);
  assert.equal(recordatorios.pendientes(entorno.db, { hasta: AHORA }).length, 0);
  assert.equal(recordatorios.pendientes(entorno.db, { hasta: Date.parse('2026-08-23T17:00:00Z') }).length, 1);
});

test('el reloj manda lo que toca y lo apunta en la bandeja', async () => {
  const entorno = montar();
  conCita(entorno);
  const enviados = [];
  const hecho = await pasada(entorno.db, entorno.config, {
    ahora: Date.parse('2026-08-23T17:00:00Z'),
    enviar: async (destino, texto) => { enviados.push({ destino, texto }); return { ok: true, canal: 'whatsapp' }; },
  });
  assert.equal(hecho.enviados, 1);
  assert.match(enviados[0].texto, /mañana a las 10:00/);
  assert.equal(enviados[0].destino.telefono, '+34600111222');
  assert.equal(recordatorios.listar(entorno.db, { estado: 'enviado' }).length, 1);
  const conversacion = bandeja.listar(entorno.db)[0];
  assert.match(conversacion.ultimo_texto, /Recordatorio/);
});

test('sin canal para mandarlo, queda como tarea del panel', async () => {
  const entorno = montar();
  conCita(entorno);
  const hecho = await pasada(entorno.db, entorno.config, {
    ahora: Date.parse('2026-08-23T17:00:00Z'),
    enviar: async () => ({ ok: false, motivo: 'sin-canal' }),
  });
  assert.equal(hecho.aMano, 1);
  const [recordatorio] = recordatorios.listar(entorno.db, { estado: 'a_mano' });
  assert.match(recordatorio.detalle, /sin-canal/);
});

test('el reloj no manda el recordatorio de una cita anulada', async () => {
  const entorno = montar();
  const cita = conCita(entorno);
  // Se anula sin pasar por anular(), como si lo hubiera hecho otro sitio.
  entorno.db.ejecutar("UPDATE citas SET estado = 'anulada' WHERE id = $id", { id: cita.id });
  const hecho = await pasada(entorno.db, entorno.config, {
    ahora: Date.parse('2026-08-23T17:00:00Z'),
    enviar: async () => ({ ok: true, canal: 'whatsapp' }),
  });
  assert.equal(hecho.enviados, 0);
  assert.equal(hecho.cancelados, 1);
});

test('quien no vino genera un mensaje de repesca', async () => {
  const entorno = montar();
  const cita = conCita(entorno);
  citas.marcar(entorno.db, entorno.config, { citaId: cita.id, estado: 'no_vino' });
  const enviados = [];
  await pasada(entorno.db, entorno.config, {
    ahora: Date.now() + 3 * 3600000,
    enviar: async (destino, texto) => { enviados.push(texto); return { ok: true, canal: 'whatsapp' }; },
  });
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], /Te esperábamos/);
});

test('el seguimiento de inactivos se apunta solo si está configurado', async () => {
  const config = negocioDePrueba({ recordatorios: { vispera: true, seguimientoInactivosDias: 60 } });
  const entorno = { ...montar(), config };
  const quien = clientes.buscarOCrear(entorno.db, { telefono: '+34600111999', nombre: 'Antiguo' });
  const vieja = citas.reservar(entorno.db, config, {
    servicioId: 'corte', inicio: instante('2026-01-12', 10), clienteId: quien.id, ahora: Date.parse('2026-01-09T09:00:00Z'),
  });
  citas.marcar(entorno.db, config, { citaId: vieja.cita.id, estado: 'atendida' });
  const creados = recordatorios.programarSeguimientos(entorno.db, config, { ahora: AHORA });
  assert.equal(creados.length, 1);
  assert.equal(creados[0].tipo, 'seguimiento');
});

test('el seguimiento no se repite dos veces para la misma persona', () => {
  const config = negocioDePrueba({ recordatorios: { seguimientoInactivosDias: 60 } });
  const entorno = { ...montar(), config };
  const quien = clientes.buscarOCrear(entorno.db, { telefono: '+34600111999' });
  const vieja = citas.reservar(entorno.db, config, {
    servicioId: 'corte', inicio: instante('2026-01-12', 10), clienteId: quien.id, ahora: Date.parse('2026-01-09T09:00:00Z'),
  });
  citas.marcar(entorno.db, config, { citaId: vieja.cita.id, estado: 'atendida' });
  recordatorios.programarSeguimientos(entorno.db, config, { ahora: AHORA });
  assert.equal(recordatorios.programarSeguimientos(entorno.db, config, { ahora: AHORA }).length, 0);
});

test('marcar enviado y fallido deja constancia', () => {
  const entorno = montar();
  conCita(entorno);
  const [recordatorio] = recordatorios.listar(entorno.db, {});
  recordatorios.marcarEnviado(entorno.db, recordatorio.id, 'correo');
  assert.equal(recordatorios.listar(entorno.db, { estado: 'enviado' })[0].canal, 'correo');
  recordatorios.marcarFallido(entorno.db, recordatorio.id, 'no contesta el servidor');
  assert.match(recordatorios.listar(entorno.db, { estado: 'fallido' })[0].detalle, /no contesta/);
});
