// El cerebro con modelo, probado sin tocar la red: se sustituye la llamada a
// la API por una respuesta escrita a mano. Así se puede comprobar lo que de
// verdad importa: que las herramientas se ejecutan de veras contra el motor,
// que el modelo no ve nada que no deba, y que si la API falla no se pierde
// ninguna conversación.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as claude from '../cerebro/claude.js';
import { contestar } from '../cerebro/index.js';
import * as bandeja from '../nucleo/bandeja.js';
import { montar, LUNES } from './ayuda.js';

const fetchDeVerdad = globalThis.fetch;
const claveDeVerdad = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  globalThis.fetch = fetchDeVerdad;
  if (claveDeVerdad === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = claveDeVerdad;
});

/** Devuelve las respuestas de la lista, una por llamada, y apunta lo enviado. */
function apiDeMentira(respuestas) {
  const enviado = [];
  globalThis.fetch = async (url, opciones) => {
    enviado.push({ url, cuerpo: JSON.parse(opciones.body), cabeceras: opciones.headers });
    const siguiente = respuestas[enviado.length - 1];
    if (typeof siguiente === 'function') return siguiente();
    return new Response(JSON.stringify(siguiente), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return enviado;
}

const texto = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const usaHerramienta = (name, input, id = 'uso-1') => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
});

function contexto(cambios = {}) {
  const entorno = montar();
  process.env.ANTHROPIC_API_KEY = 'clave-de-mentira';
  const conversacion = bandeja.abrir(entorno.db, { canal: 'whatsapp', externo: '+34600111222' });
  return {
    db: entorno.db,
    config: entorno.config,
    conversacion,
    contacto: { telefono: '+34600111222' },
    canal: 'whatsapp',
    ahora: entorno.ahora,
    memoria: {},
    ...cambios,
  };
}

test('sin clave no se llama a nadie', async () => {
  const ctx = contexto();
  delete process.env.ANTHROPIC_API_KEY;   // el orden importa: contexto() la pone
  assert.equal(claude.hayClave(), false);
  globalThis.fetch = () => { throw new Error('no debería llamar a nadie'); };
  await assert.rejects(() => claude.responder('hola', ctx), /ANTHROPIC_API_KEY/);
});

test('una respuesta sin herramientas se devuelve tal cual', async () => {
  const ctx = contexto();
  apiDeMentira([texto('Buenas, dime qué necesitas.')]);
  const r = await claude.responder('hola', ctx);
  assert.equal(r.texto, 'Buenas, dime qué necesitas.');
  assert.equal(r.cerebro, 'claude');
  assert.equal(r.acciones.length, 0);
});

test('la petición lleva el modelo, la clave y las nueve herramientas', async () => {
  const ctx = contexto();
  const enviado = apiDeMentira([texto('ok')]);
  await claude.responder('hola', ctx);
  const { cuerpo, cabeceras, url } = enviado[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(cabeceras['x-api-key'], 'clave-de-mentira');
  assert.equal(cabeceras['anthropic-version'], '2023-06-01');
  assert.equal(cuerpo.model, ctx.config.modelo.nombre);
  assert.equal(cuerpo.tools.length, 9);
  assert.deepEqual(cuerpo.messages, [{ role: 'user', content: 'hola' }]);
});

test('las instrucciones llevan el negocio y sus normas', async () => {
  const ctx = contexto();
  const enviado = apiDeMentira([texto('ok')]);
  await claude.responder('hola', ctx);
  const sistema = enviado[0].cuerpo.system;
  assert.match(sistema, /Prueba/);
  assert.match(sistema, /Corte/);
  assert.match(sistema, /Nunca digas una hora que no venga de buscar_huecos/);
  assert.match(sistema, /No le lleves la contraria/);
  assert.match(sistema, /no le ofrezcas el mismo día que ya tiene/);
  assert.match(sistema, /Cambia siempre con mover_cita/);
  assert.match(sistema, /no le recites las otras/);
  assert.match(sistema, /acto seguido dale UNA alternativa/);
  assert.match(sistema, /no existen para esta conversación/);
});

test('cuando el modelo usa una herramienta, se ejecuta de verdad', async () => {
  const ctx = contexto();
  const enviado = apiDeMentira([
    usaHerramienta('buscar_huecos', { servicio: 'corte', dia: LUNES }),
    texto('El lunes tengo 09:00. ¿Te va bien?'),
  ]);
  const r = await claude.responder('quiero un corte el lunes', ctx);
  assert.equal(r.texto, 'El lunes tengo 09:00. ¿Te va bien?');
  assert.equal(r.acciones[0].herramienta, 'buscar_huecos');
  // La segunda llamada lleva el resultado de verdad del motor de agenda
  const resultado = JSON.parse(enviado[1].cuerpo.messages.at(-1).content[0].content);
  assert.equal(resultado.huecos[0].hora, '09:00');
  assert.equal(resultado.huecos[0].dia, LUNES);
});

test('el modelo no ve los objetos internos', async () => {
  const ctx = contexto();
  const enviado = apiDeMentira([
    usaHerramienta('buscar_huecos', { servicio: 'corte', dia: LUNES }),
    texto('ok'),
  ]);
  await claude.responder('quiero un corte el lunes', ctx);
  const contenido = enviado[1].cuerpo.messages.at(-1).content[0].content;
  assert.ok(!contenido.includes('_huecos'));
  assert.ok(!contenido.includes('recursoId'));
});

test('reservar por el modelo deja la cita puesta', async () => {
  const ctx = contexto();
  apiDeMentira([
    usaHerramienta('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00', nombre: 'Rocío' }),
    texto('Hecho, Rocío.'),
  ]);
  await claude.responder('resérvame el lunes a las 10', ctx);
  assert.equal(ctx.db.valor('SELECT COUNT(*) FROM citas'), 1);
  assert.equal(ctx.db.valor("SELECT servicio_nombre FROM citas"), 'Corte');
});

test('una hora inventada por el modelo se rechaza igual', async () => {
  const ctx = contexto();
  const enviado = apiDeMentira([
    usaHerramienta('reservar', { servicio: 'corte', dia: LUNES, hora: '04:00' }),
    texto('Perdona, a esa hora no abrimos.'),
  ]);
  await claude.responder('ponme el lunes a las 4 de la mañana', ctx);
  assert.equal(ctx.db.valor('SELECT COUNT(*) FROM citas'), 0);
  const resultado = JSON.parse(enviado[1].cuerpo.messages.at(-1).content[0].content);
  assert.equal(resultado.ok, false);
  assert.equal(enviado[1].cuerpo.messages.at(-1).content[0].is_error, true);
});

test('varias herramientas seguidas encadenan bien', async () => {
  const ctx = contexto();
  apiDeMentira([
    usaHerramienta('buscar_huecos', { servicio: 'corte', dia: LUNES }, 'u1'),
    usaHerramienta('reservar', { servicio: 'corte', dia: LUNES, hora: '09:00', nombre: 'Ana' }, 'u2'),
    texto('Reservado.'),
  ]);
  const r = await claude.responder('lo que sea el lunes', ctx);
  assert.deepEqual(r.acciones.map((a) => a.herramienta), ['buscar_huecos', 'reservar']);
  assert.equal(ctx.db.valor('SELECT COUNT(*) FROM citas'), 1);
});

test('si el modelo se queda en bucle, se corta', async () => {
  const ctx = contexto();
  apiDeMentira(Array.from({ length: 10 }, (_, i) => usaHerramienta('mis_citas', {}, `u${i}`)));
  await assert.rejects(() => claude.responder('hola', ctx), /dando vueltas/);
});

test('un error de la API se cuenta con su código', async () => {
  const ctx = contexto();
  apiDeMentira([() => new Response('sin saldo', { status: 429 })]);
  await assert.rejects(() => claude.responder('hola', ctx), /429/);
});

test('si la API falla, contesta el cerebro de reglas y queda apuntado', async () => {
  const ctx = contexto();
  apiDeMentira([() => new Response('boom', { status: 500 })]);
  const r = await contestar({
    db: ctx.db,
    config: ctx.config,
    canal: 'whatsapp',
    externo: '+34600111222',
    texto: 'quiero un corte el lunes por la mañana',
    contacto: { telefono: '+34600111222' },
    ahora: ctx.ahora,
    forzarCerebro: 'claude',
  });
  assert.equal(r.cerebro, 'reglas');
  assert.match(r.texto, /09:00/);
  const caidas = ctx.db.filas("SELECT * FROM eventos WHERE tipo = 'cerebro.caida'");
  assert.equal(caidas.length, 1);
  assert.match(JSON.parse(caidas[0].datos).mensaje, /500/);
});

test('el historial se convierte en turnos que la API acepta', () => {
  const turnos = claude.historial([
    { direccion: 'saliente', autor: 'bot', texto: 'saludo suelto' },
    { direccion: 'entrante', autor: 'cliente', texto: 'hola' },
    { direccion: 'entrante', autor: 'cliente', texto: 'quiero cita' },
    { direccion: 'saliente', autor: 'sistema', texto: 'nota interna' },
    { direccion: 'saliente', autor: 'bot', texto: '¿qué día?' },
  ]);
  // Empieza por el cliente, junta lo seguido y tira las notas internas
  assert.deepEqual(turnos, [
    { role: 'user', content: 'hola\nquiero cita' },
    { role: 'assistant', content: '¿qué día?' },
  ]);
});

test('el historial que llega vacío no rompe nada', () => {
  assert.deepEqual(claude.historial([]), []);
  assert.deepEqual(claude.historial([{ direccion: 'saliente', autor: 'bot', texto: 'hola' }]), []);
});
