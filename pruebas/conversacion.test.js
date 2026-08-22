// Conversaciones enteras con el cerebro de reglas: lo que le pasa a un cliente
// de verdad, de "hola" a cita puesta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contestar } from '../cerebro/index.js';
import * as bandeja from '../nucleo/bandeja.js';
import * as citas from '../nucleo/citas.js';
import * as clientes from '../nucleo/clientes.js';
import { montar, LUNES, MARTES, DOMINGO, instante } from './ayuda.js';

function charla(entorno, externo = '+34600111222') {
  return async (texto, contacto = { telefono: externo }) => contestar({
    db: entorno.db,
    config: entorno.config,
    canal: 'whatsapp',
    externo,
    texto,
    contacto,
    ahora: entorno.ahora,
    forzarCerebro: 'reglas',
  });
}

test('coge una cita de principio a fin', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  const primera = await decir('buenas, quiero un corte el lunes por la mañana');
  assert.match(primera.texto, /lunes 24 de agosto/);
  assert.match(primera.texto, /09:00/);
  const segunda = await decir('a las 10:00');
  assert.match(segunda.texto, /¿Te la confirmo\?/);
  const tercera = await decir('sí, confirmo', { telefono: '+34600111222', nombre: 'Rocío' });
  assert.match(tercera.texto, /Hecho, Rocío/);
  assert.equal(entorno.db.valor("SELECT COUNT(*) FROM citas WHERE estado = 'reservada'"), 1);
});

test('pide el nombre si no lo sabe, y luego reserva', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('quiero un corte el lunes');
  await decir('la primera');
  const pregunta = await decir('vale');
  assert.match(pregunta.texto, /¿A nombre de quién/i);
  const hecho = await decir('me llamo Javier');
  assert.match(hecho.texto, /Hecho, Javier/);
  assert.equal(clientes.porTelefono(entorno.db, '+34600111222').nombre, 'Javier');
});

test('elige por el orden cuando el cliente dice "la primera"', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  const ofrece = await decir('un corte el lunes por la tarde');
  const horas = ofrece.texto.match(/\d{2}:\d{2}/g);
  const elegida = await decir('la segunda');
  assert.ok(elegida.texto.includes(horas[1]));
});

test('mantiene el día cuando el cliente solo dice la hora', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('un corte el lunes por la mañana');
  const respuesta = await decir('a las 12:30');
  assert.match(respuesta.texto, /lunes 24 de agosto a las 12:30/);
});

test('no acepta una hora que no existe en el horario', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  const respuesta = await decir('un corte el lunes a las 15:00');
  assert.match(respuesta.texto, /no abrimos/i);
  assert.equal(entorno.db.valor('SELECT COUNT(*) FROM citas'), 0);
});

test('un día cerrado se dice claro y se ofrece otro', async () => {
  const entorno = montar();
  const respuesta = await charla(entorno)(`un corte el ${DOMINGO}`);
  assert.match(respuesta.texto, /no abrimos/i);
  assert.match(respuesta.texto, /lunes 24 de agosto/);
});

test('consulta cuándo tiene la cita', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('un corte el lunes');
  await decir('la primera');
  await decir('sí', { telefono: '+34600111222', nombre: 'Rocío' });
  const respuesta = await decir('¿cuándo tengo la cita?');
  assert.match(respuesta.texto, /Corte/);
  assert.match(respuesta.texto, /lunes 24 de agosto/);
});

test('anula pidiendo confirmación antes', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('un corte el lunes');
  await decir('la primera');
  await decir('sí', { telefono: '+34600111222', nombre: 'Rocío' });
  const pregunta = await decir('anúlamela');
  assert.match(pregunta.texto, /¿Te anulo/i);
  const anulada = await decir('sí');
  assert.match(anulada.texto, /Anulada/);
  assert.equal(entorno.db.valor("SELECT COUNT(*) FROM citas WHERE estado = 'anulada'"), 1);
});

test('si dice que no al anular, la cita se queda', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('un corte el lunes');
  await decir('la primera');
  await decir('sí', { telefono: '+34600111222', nombre: 'Rocío' });
  await decir('quiero cancelar');
  const respuesta = await decir('no, mejor no');
  assert.match(respuesta.texto, /la dejo como está/i);
  assert.equal(entorno.db.valor("SELECT COUNT(*) FROM citas WHERE estado = 'reservada'"), 1);
});

test('mueve la cita a otro día', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('un corte el lunes');
  await decir('la primera');
  await decir('sí', { telefono: '+34600111222', nombre: 'Rocío' });
  const respuesta = await decir(`cámbiamela al ${MARTES} a las 12:00`);
  assert.match(respuesta.texto, /Cambiada/);
  assert.match(respuesta.texto, /12:00/);
});

test('ante una queja se aparta y avisa al equipo', async () => {
  const entorno = montar();
  const respuesta = await charla(entorno)('esto es una vergüenza, quiero poner una reclamación');
  assert.match(respuesta.texto, /Aviso a alguien del equipo/);
  assert.equal(respuesta.conversacion.estado, 'humano');
});

test('cuando lo lleva una persona, el bot se calla', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('hola');
  const conversacion = bandeja.listar(entorno.db)[0];
  bandeja.tomarElMando(entorno.db, conversacion.id);
  const respuesta = await decir('quiero cita el lunes');
  assert.ok(respuesta.silencio);
  assert.equal(respuesta.texto, null);
});

test('el mensaje del cliente queda guardado aunque el bot calle', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('hola');
  const conversacion = bandeja.listar(entorno.db)[0];
  bandeja.tomarElMando(entorno.db, conversacion.id);
  await decir('sigo aquí');
  const mensajes = bandeja.mensajesDe(entorno.db, conversacion.id);
  assert.equal(mensajes.at(-1).texto, 'sigo aquí');
});

test('contesta las preguntas de siempre', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  assert.match((await decir('¿qué horario tenéis?')).texto, /lunes/);
  assert.match((await decir('¿dónde estáis?')).texto, /Calle Falsa/);
  assert.match((await decir('¿cuánto cuesta el corte?')).texto, /20 €/);
});

test('la ficha se crea sola con el primer mensaje', async () => {
  const entorno = montar();
  await charla(entorno)('hola');
  assert.ok(clientes.porTelefono(entorno.db, '+34600111222'));
});

test('cada mensaje queda en la bandeja, por los dos lados', async () => {
  const entorno = montar();
  await charla(entorno)('hola');
  const conversacion = bandeja.listar(entorno.db)[0];
  const mensajes = bandeja.mensajesDe(entorno.db, conversacion.id);
  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0].direccion, 'entrante');
  assert.equal(mensajes[1].autor, 'bot');
});

test('si no entiende dos veces, avisa a una persona', async () => {
  const entorno = montar();
  const decir = charla(entorno);
  await decir('asdf qwer');
  await decir('zxcv');
  const tercera = await decir('mnbv');
  assert.match(tercera.texto, /Aviso a alguien del equipo/);
});

test('dos clientes a la vez no se pisan la conversación', async () => {
  const entorno = montar();
  const uno = charla(entorno, '+34600111222');
  const dos = charla(entorno, '+34600333444');
  await uno('un corte el lunes por la mañana');
  await dos('un tinte el lunes por la mañana');
  const respuestaUno = await uno('la primera');
  const respuestaDos = await dos('la primera');
  assert.match(respuestaUno.texto, /corte/i);
  assert.match(respuestaDos.texto, /tinte/i);
});

test('dos clientes no se llevan el mismo hueco', async () => {
  const entorno = montar();
  const uno = charla(entorno, '+34600111222');
  const dos = charla(entorno, '+34600333444');
  await uno('un tinte el lunes por la mañana');
  await uno('a las 10:00');
  await uno('sí', { telefono: '+34600111222', nombre: 'Una' });
  await dos('un tinte el lunes por la mañana');
  const chocada = await dos('a las 10:00');
  assert.match(chocada.texto, /cogida/i);
  const insistiendo = await dos('sí', { telefono: '+34600333444', nombre: 'Otra' });
  assert.match(insistiendo.texto, /¿Cuál te viene mejor/i);
  assert.equal(entorno.db.valor("SELECT COUNT(*) FROM citas WHERE estado = 'reservada'"), 1);
});

test('el cerebro que contesta queda apuntado en el mensaje', async () => {
  const entorno = montar();
  const respuesta = await charla(entorno)('hola');
  assert.equal(respuesta.cerebro, 'reglas');
  const conversacion = bandeja.listar(entorno.db)[0];
  const ultimo = bandeja.mensajesDe(entorno.db, conversacion.id).at(-1);
  assert.equal(JSON.parse(ultimo.datos).cerebro, 'reglas');
});
