import test from 'node:test';
import assert from 'node:assert/strict';
import * as bandeja from '../nucleo/bandeja.js';
import { buscarOCrear } from '../nucleo/clientes.js';
import { montar, avanzarReloj } from './ayuda.js';

test('abrir una conversación dos veces devuelve la misma', () => {
  const { db } = montar();
  const uno = bandeja.abrir(db, { canal: 'whatsapp', externo: '+34600111222' });
  const dos = bandeja.abrir(db, { canal: 'whatsapp', externo: '+34600111222' });
  assert.equal(uno.id, dos.id);
});

test('el mismo contacto por dos canales son dos conversaciones', () => {
  const { db } = montar();
  const uno = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  const dos = bandeja.abrir(db, { canal: 'correo', externo: 'x' });
  assert.notEqual(uno.id, dos.id);
});

test('la conversación se engancha a la ficha cuando aparece', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: '+34600111222' });
  assert.equal(conv.cliente_id, null);
  const quien = buscarOCrear(db, { telefono: '+34600111222' });
  const conDueño = bandeja.abrir(db, { canal: 'whatsapp', externo: '+34600111222', clienteId: quien.id });
  assert.equal(conDueño.cliente_id, quien.id);
});

test('los mensajes entrantes suman sin leer y los salientes no', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  bandeja.entrante(db, conv.id, 'hola');
  bandeja.entrante(db, conv.id, '¿hay hueco?');
  bandeja.saliente(db, conv.id, 'sí, mañana a las 10');
  assert.equal(bandeja.conversacionPorId(db, conv.id).sin_leer, 2);
  assert.equal(bandeja.sinLeer(db), 1);
});

test('marcar leída pone el contador a cero', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  bandeja.entrante(db, conv.id, 'hola');
  bandeja.marcarLeida(db, conv.id);
  assert.equal(bandeja.conversacionPorId(db, conv.id).sin_leer, 0);
});

test('los mensajes salen en el orden en que se dijeron', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  bandeja.entrante(db, conv.id, 'uno');
  bandeja.saliente(db, conv.id, 'dos');
  bandeja.entrante(db, conv.id, 'tres');
  assert.deepEqual(bandeja.mensajesDe(db, conv.id).map((m) => m.texto), ['uno', 'dos', 'tres']);
});

test('la memoria del cerebro se guarda y se recupera', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  assert.deepEqual(bandeja.memoria(db, conv.id), {});
  bandeja.memoria(db, conv.id, { paso: 'confirmando', servicioId: 'corte' });
  assert.equal(bandeja.memoria(db, conv.id).paso, 'confirmando');
});

test('cuando entra una persona, la conversación deja de ser del bot', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  assert.equal(conv.estado, 'bot');
  assert.equal(bandeja.tomarElMando(db, conv.id).estado, 'humano');
  assert.equal(bandeja.devolverAlBot(db, conv.id).estado, 'bot');
});

test('la bandeja ordena por lo último que llegó', async () => {
  const { db } = montar();
  const uno = bandeja.abrir(db, { canal: 'whatsapp', externo: 'uno' });
  const dos = bandeja.abrir(db, { canal: 'whatsapp', externo: 'dos' });
  bandeja.entrante(db, uno.id, 'primero');
  avanzarReloj(1000);
  bandeja.entrante(db, dos.id, 'después');
  assert.equal(bandeja.listar(db)[0].externo, 'dos');
});

test('la bandeja trae el último mensaje de cada conversación', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  bandeja.entrante(db, conv.id, 'hola');
  bandeja.saliente(db, conv.id, 'buenas, dime');
  const fila = bandeja.listar(db)[0];
  assert.equal(fila.ultimo_texto, 'buenas, dime');
  assert.equal(fila.ultimo_autor, 'bot');
});

test('se puede filtrar la bandeja por canal y por estado', () => {
  const { db } = montar();
  const uno = bandeja.abrir(db, { canal: 'whatsapp', externo: 'uno' });
  bandeja.abrir(db, { canal: 'correo', externo: 'dos' });
  bandeja.tomarElMando(db, uno.id);
  assert.equal(bandeja.listar(db, { canal: 'correo' }).length, 1);
  assert.equal(bandeja.listar(db, { estado: 'humano' }).length, 1);
});

test('las notas del sistema quedan apuntadas en el hilo', () => {
  const { db } = montar();
  const conv = bandeja.abrir(db, { canal: 'whatsapp', externo: 'x' });
  bandeja.nota(db, conv.id, 'Escalado al equipo');
  assert.equal(bandeja.mensajesDe(db, conv.id)[0].autor, 'sistema');
});
