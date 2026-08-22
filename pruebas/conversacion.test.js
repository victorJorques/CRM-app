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

// --- Lo que pasó en la demostración con la clínica --------------------------
// Una clienta escribió diciendo que tenía cita el lunes a las 9 y el bot le
// contestó que no tenía ninguna. Dos fallos en uno: no la reconocía, y encima
// le llevaba la contraria.

// Por defecto, la cita es del mismo número desde el que se escribe en estas
// pruebas: es el caso normal. Los teléfonos distintos se piden a propósito.
function conVisita(entorno, { telefono = '+34600111222', nombre = 'Carmen Ortiz', clave = LUNES, hora = 9 } = {}) {
  const quien = clientes.buscarOCrear(entorno.db, { nombre, telefono });
  const reserva = citas.reservar(entorno.db, entorno.config, {
    servicioId: 'corte', inicio: instante(clave, hora), clienteId: quien.id, ahora: entorno.ahora,
  });
  return { quien, cita: reserva.cita };
}

test('"tenía cita el lunes a las 9" habla de la suya, no pide una nueva', async () => {
  const entorno = montar();
  const { cita } = conVisita(entorno);
  const respuesta = await charla(entorno)('hola, tenía cita el lunes 24/08/26 a las 9');
  assert.match(respuesta.texto, /lunes 24 de agosto a las 09:00/);
  assert.ok(!/¿Para qué servicio/i.test(respuesta.texto));
  assert.equal(entorno.db.valor('SELECT COUNT(*) FROM citas'), 1);
  assert.equal(citas.porId(entorno.db, cita.id).estado, 'reservada');
});

test('si no aparece su cita, no se le dice que no la tiene', async () => {
  const entorno = montar();
  conVisita(entorno, { telefono: '+34600111230' });   // la cita es de otro número
  const respuesta = await charla(entorno, '+34600999000')('tenía cita el lunes a las 9');
  assert.ok(!/no tienes|no me consta ninguna/i.test(respuesta.texto));
  assert.match(respuesta.texto, /no quiere decir que no la tengas/i);
  assert.match(respuesta.texto, /equipo/i);
});

test('cuando no aparece, queda apuntado para que lo mire una persona', async () => {
  const entorno = montar();
  await charla(entorno, '+34600999000')('tenía cita el lunes a las 9');
  const conversacion = bandeja.listar(entorno.db)[0];
  const notas = bandeja.mensajesDe(entorno.db, conversacion.id).filter((m) => m.autor === 'sistema');
  assert.equal(notas.length, 1);
  assert.match(notas[0].texto, /no aparece con este contacto/i);
  const eventos = entorno.db.filas("SELECT tipo FROM eventos WHERE tipo = 'cita.no-aparece'");
  assert.equal(eventos.length, 1);
});

test('si insiste en que la tiene, deja de contestar el bot', async () => {
  const entorno = montar();
  const decir = charla(entorno, '+34600999000');
  await decir('tenía cita el lunes a las 9');
  const segunda = await decir('que sí, que tengo cita el lunes, miradlo bien');
  assert.match(segunda.texto, /Aviso a alguien del equipo/);
  assert.equal(segunda.conversacion.estado, 'humano');
});

test('"otro día de esta semana por la mañana" no ofrece su mismo día', async () => {
  const entorno = montar();
  const { cita } = conVisita(entorno);
  const decir = charla(entorno);
  await decir('tenía cita el lunes a las 9');
  const respuesta = await decir('quería cambiarla a otro día de esta semana por la mañana');
  // Le recuerda la que tiene, no le ofrece su mismo día, y lo que ofrece es
  // de mañana, que es lo que ha pedido.
  assert.match(respuesta.texto, /Ahora tienes Corte el lunes 24 de agosto a las 09:00/);
  assert.ok(!/El lunes 24 de agosto tengo/.test(respuesta.texto));
  const horas = respuesta.texto.split('.').at(-2).match(/\d{2}:\d{2}/g) ?? [];
  assert.ok(horas.length > 0);
  assert.ok(horas.every((h) => Number(h.slice(0, 2)) < 14), `ofrece tardes: ${horas}`);
});

test('cambiar de día mueve la cita, no crea otra', async () => {
  const entorno = montar();
  const { quien, cita } = conVisita(entorno);
  const decir = charla(entorno);
  await decir('tenía cita el lunes a las 9');
  await decir('quería cambiarla a otro día de esta semana por la mañana');
  const propuesta = await decir('la primera');
  assert.match(propuesta.texto, /¿Te la cambio al/);
  const hecho = await decir('sí');
  assert.match(hecho.texto, /Cambiada/);
  assert.equal(citas.deCliente(entorno.db, quien.id).length, 1);
  const despues = citas.porId(entorno.db, cita.id);
  assert.notEqual(despues.inicio, instante(LUNES, 9));
  assert.equal(despues.estado, 'reservada');
});

test('si pregunta por una cita concreta, no se le recitan todas', async () => {
  const entorno = montar();
  conVisita(entorno);                                   // lunes a las 9
  conVisita(entorno, { clave: MARTES, hora: 12 });      // y otra el martes
  const respuesta = await charla(entorno)('tenía cita el lunes a las 9');
  assert.match(respuesta.texto, /lunes 24 de agosto a las 09:00/);
  assert.ok(!/martes/.test(respuesta.texto));
});

test('quien sí tiene cita la ve confirmada al preguntar', async () => {
  const entorno = montar();
  conVisita(entorno);
  const respuesta = await charla(entorno)('¿cuándo tengo la cita?');
  assert.match(respuesta.texto, /Corte/);
  assert.match(respuesta.texto, /¿Quieres cambiarla o anularla\?/);
});
