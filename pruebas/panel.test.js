import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { crearServidor } from '../canales/panel.js';
import * as citas from '../nucleo/citas.js';
import * as clientes from '../nucleo/clientes.js';
import * as bandeja from '../nucleo/bandeja.js';
import { montar, instante, LUNES } from './ayuda.js';

// Si una prueba falla antes de cerrar su servidor, el proceso se queda vivo
// esperando. Se apuntan todos y se cierran al final pase lo que pase.
const abiertos = new Set();
after(async () => {
  for (const servidor of abiertos) await new Promise((r) => servidor.close(r));
});

async function levantar(opciones = {}) {
  const entorno = montar();
  const servidor = crearServidor({ db: entorno.db, config: entorno.config, ...opciones });
  abiertos.add(servidor);
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    ...entorno,
    base,
    cerrar: () => { abiertos.delete(servidor); return new Promise((r) => servidor.close(r)); },
    pedir: (ruta, init = {}) => fetch(`${base}${ruta}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: init.cuerpo ? JSON.stringify(init.cuerpo) : undefined,
    }),
  };
}

test('/salud contesta sin sesión', async () => {
  const panel = await levantar();
  const datos = await (await panel.pedir('/salud')).json();
  assert.ok(datos.ok);
  assert.equal(datos.negocio, 'Prueba');
  await panel.cerrar();
});

test('sirve el panel en la raíz', async () => {
  const panel = await levantar();
  const respuesta = await panel.pedir('/');
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers.get('content-type'), /text\/html/);
  assert.match(await respuesta.text(), /<title>Conserje<\/title>/);
  await panel.cerrar();
});

test('sirve el css y el js del panel', async () => {
  const panel = await levantar();
  assert.equal((await panel.pedir('/panel.css')).status, 200);
  assert.equal((await panel.pedir('/panel.js')).status, 200);
  await panel.cerrar();
});

test('no deja salirse de la carpeta del panel', async () => {
  const panel = await levantar();
  const respuesta = await panel.pedir('/..%2f..%2fetc%2fpasswd');
  assert.ok([400, 404].includes(respuesta.status));
  await panel.cerrar();
});

test('con clave, la API pide sesión', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  const respuesta = await panel.pedir('/api/estado');
  assert.equal(respuesta.status, 401);
  await panel.cerrar();
});

test('con la clave buena entra y con la mala no', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  const mala = await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: 'otra' } });
  assert.equal(mala.status, 401);
  const buena = await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: 'secreta123' } });
  assert.equal(buena.status, 200);
  const galleta = buena.headers.get('set-cookie').split(';')[0];
  const estado = await panel.pedir('/api/estado', { headers: { cookie: galleta } });
  assert.equal(estado.status, 200);
  await panel.cerrar();
});

test('una galleta manipulada no vale', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  const respuesta = await panel.pedir('/api/estado', { headers: { cookie: 'conserje=abc.def' } });
  assert.equal(respuesta.status, 401);
  await panel.cerrar();
});

test('sin clave, desde este ordenador, la API está abierta', async () => {
  const panel = await levantar();
  assert.equal((await panel.pedir('/api/estado')).status, 200);
  await panel.cerrar();
});

test('/api/estado resume el negocio y el día', async () => {
  const panel = await levantar();
  const datos = await (await panel.pedir('/api/estado')).json();
  assert.equal(datos.negocio.nombre, 'Prueba');
  assert.equal(datos.servicios.length, 2);
  assert.equal(datos.cerebro, process.env.ANTHROPIC_API_KEY ? 'claude' : 'reglas');
  assert.ok('sinLeer' in datos);
  await panel.cerrar();
});

test('/api/huecos devuelve horas de verdad', async () => {
  const panel = await levantar();
  const datos = await (await panel.pedir(`/api/huecos?servicio=corte&dia=${LUNES}&dias=1&limite=5`)).json();
  assert.equal(datos.huecos[0].hora, '09:00');
  await panel.cerrar();
});

test('/api/citas reserva y aparece en la agenda', async () => {
  const panel = await levantar();
  const reserva = await (await panel.pedir('/api/citas', {
    method: 'POST',
    cuerpo: { servicio: 'corte', inicio: instante(LUNES, 10), cliente: { telefono: '600111222', nombre: 'Rocío' } },
  })).json();
  assert.ok(reserva.ok);
  const agenda = await (await panel.pedir(`/api/agenda?dia=${LUNES}`)).json();
  assert.equal(agenda.total, 1);
  assert.equal(agenda.citas[0].cliente_nombre, 'Rocío');
  await panel.cerrar();
});

test('/api/citas rechaza con 409 lo que ya está cogido', async () => {
  const panel = await levantar();
  const cuerpo = { servicio: 'tinte', inicio: instante(LUNES, 10), cliente: { telefono: '600111222' } };
  await panel.pedir('/api/citas', { method: 'POST', cuerpo });
  const segunda = await panel.pedir('/api/citas', { method: 'POST', cuerpo: { ...cuerpo, cliente: { telefono: '600999888' } } });
  assert.equal(segunda.status, 409);
  await panel.cerrar();
});

test('se puede cerrar una cita como atendida', async () => {
  const panel = await levantar();
  const quien = clientes.buscarOCrear(panel.db, { telefono: '+34600111222' });
  const reserva = citas.reservar(panel.db, panel.config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora: panel.ahora });
  const respuesta = await (await panel.pedir(`/api/citas/${reserva.cita.id}/estado`, { method: 'POST', cuerpo: { estado: 'atendida' } })).json();
  assert.equal(respuesta.cita.estado, 'atendida');
  await panel.cerrar();
});

test('se puede anular desde el panel', async () => {
  const panel = await levantar();
  const quien = clientes.buscarOCrear(panel.db, { telefono: '+34600111222' });
  const reserva = citas.reservar(panel.db, panel.config, { servicioId: 'corte', inicio: instante(LUNES, 10), clienteId: quien.id, ahora: panel.ahora });
  const respuesta = await (await panel.pedir(`/api/citas/${reserva.cita.id}/anular`, { method: 'POST', cuerpo: { motivo: 'llamó' } })).json();
  assert.equal(respuesta.cita.estado, 'anulada');
  await panel.cerrar();
});

test('las fichas se buscan y se abren', async () => {
  const panel = await levantar();
  const quien = clientes.buscarOCrear(panel.db, { telefono: '+34600111222', nombre: 'Rocío' });
  const lista = await (await panel.pedir('/api/clientes?busqueda=roc')).json();
  assert.equal(lista.length, 1);
  const ficha = await (await panel.pedir(`/api/clientes/${quien.id}`)).json();
  assert.equal(ficha.nombre, 'Rocío');
  await panel.cerrar();
});

test('las notas de la ficha se guardan desde el panel', async () => {
  const panel = await levantar();
  const quien = clientes.buscarOCrear(panel.db, { telefono: '+34600111222' });
  await panel.pedir(`/api/clientes/${quien.id}`, { method: 'POST', cuerpo: { notas: 'viene con prisa' } });
  assert.equal(clientes.porId(panel.db, quien.id).notas, 'viene con prisa');
  await panel.cerrar();
});

test('el simulador contesta y deja rastro de las herramientas', async () => {
  const panel = await levantar();
  const datos = await (await panel.pedir('/api/simulador', {
    method: 'POST',
    cuerpo: { texto: `un corte el ${LUNES} por la mañana`, externo: 'prueba', telefono: '+34600111222', cerebro: 'reglas' },
  })).json();
  assert.match(datos.texto, /09:00/);
  assert.equal(datos.acciones[0].herramienta, 'buscar_huecos');
  await panel.cerrar();
});

test('contestar desde la bandeja aparta al bot', async () => {
  const panel = await levantar();
  const conversacion = bandeja.abrir(panel.db, { canal: 'whatsapp', externo: '+34600111222' });
  bandeja.entrante(panel.db, conversacion.id, 'hola');
  const respuesta = await (await panel.pedir(`/api/bandeja/${conversacion.id}/responder`, {
    method: 'POST', cuerpo: { texto: 'te llamo yo ahora' },
  })).json();
  assert.ok(respuesta.ok);
  assert.equal(bandeja.conversacionPorId(panel.db, conversacion.id).estado, 'humano');
  assert.equal(respuesta.enviado.ok, false);
  await panel.cerrar();
});

test('se puede devolver la conversación al bot', async () => {
  const panel = await levantar();
  const conversacion = bandeja.abrir(panel.db, { canal: 'whatsapp', externo: '+34600111222' });
  bandeja.tomarElMando(panel.db, conversacion.id);
  const respuesta = await (await panel.pedir(`/api/bandeja/${conversacion.id}/mando`, {
    method: 'POST', cuerpo: { estado: 'bot' },
  })).json();
  assert.equal(respuesta.estado, 'bot');
  await panel.cerrar();
});

test('abrir una conversación la marca como leída', async () => {
  const panel = await levantar();
  const conversacion = bandeja.abrir(panel.db, { canal: 'whatsapp', externo: '+34600111222' });
  bandeja.entrante(panel.db, conversacion.id, 'hola');
  const datos = await (await panel.pedir(`/api/bandeja/${conversacion.id}`)).json();
  assert.equal(datos.mensajes.length, 1);
  assert.equal(bandeja.conversacionPorId(panel.db, conversacion.id).sin_leer, 0);
  await panel.cerrar();
});

test('una ruta que no existe da 404 en JSON', async () => {
  const panel = await levantar();
  const respuesta = await panel.pedir('/api/lo-que-sea');
  assert.equal(respuesta.status, 404);
  assert.match((await respuesta.json()).error, /No existe/);
  await panel.cerrar();
});

test('el webhook de WhatsApp responde al saludo de Meta', async () => {
  process.env.WHATSAPP_VERIFICACION = 'palabra-secreta';
  const panel = await levantar();
  const buena = await panel.pedir('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=palabra-secreta&hub.challenge=1234');
  assert.equal(await buena.text(), '1234');
  const mala = await panel.pedir('/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=1234');
  assert.equal(mala.status, 403);
  delete process.env.WHATSAPP_VERIFICACION;
  await panel.cerrar();
});

test('el webhook de WhatsApp rechaza una firma que no cuadra', async () => {
  process.env.WHATSAPP_SECRETO_APP = 'secreto-de-app';
  const panel = await levantar();
  const respuesta = await panel.pedir('/webhook/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
    cuerpo: { entry: [] },
  });
  assert.equal(respuesta.status, 401);
  delete process.env.WHATSAPP_SECRETO_APP;
  await panel.cerrar();
});

// --- Lo que pasa cuando alguien intenta entrar por la fuerza ---------------

test('a la sexta clave mala deja de contestar un rato', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  let ultima;
  for (let i = 0; i < 6; i += 1) {
    ultima = await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: `intento-${i}` } });
  }
  assert.equal(ultima.status, 429);
  assert.match((await ultima.json()).error, /Demasiados intentos/);
  // Y con la buena tampoco entra mientras dure el castigo
  const buena = await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: 'secreta123' } });
  assert.equal(buena.status, 429);
  await panel.cerrar();
});

test('los intentos fallidos quedan registrados', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: 'no' } });
  const eventos = panel.db.filas("SELECT * FROM eventos WHERE tipo = 'panel.clave-fallida'");
  assert.equal(eventos.length, 1);
  await panel.cerrar();
});

test('una clave de otra longitud no entra ni por casualidad', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  for (const mala of ['', 'secreta12', 'secreta1234', 'SECRETA123']) {
    const r = await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: mala } });
    assert.equal(r.status, 401, mala);
  }
  await panel.cerrar();
});

test('la sesión se marca Secure cuando se sirve por HTTPS', async () => {
  const panel = await levantar({ clave: 'secreta123', secreto: 'x'.repeat(32) });
  const normal = await panel.pedir('/api/entrar', { method: 'POST', cuerpo: { clave: 'secreta123' } });
  assert.ok(!normal.headers.get('set-cookie').includes('Secure'));
  const detras = await panel.pedir('/api/entrar', {
    method: 'POST', cuerpo: { clave: 'secreta123' }, headers: { 'x-forwarded-proto': 'https' },
  });
  const galleta = detras.headers.get('set-cookie');
  assert.match(galleta, /Secure/);
  assert.match(galleta, /HttpOnly/);
  assert.match(galleta, /SameSite=Strict/);
  await panel.cerrar();
});

test('no se sale de la carpeta del panel ni con la ruta codificada', async () => {
  const panel = await levantar();
  for (const ruta of ['/../datos/conserje.db', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd', '/panel/../../.env']) {
    const respuesta = await panel.pedir(ruta);
    assert.ok([400, 404].includes(respuesta.status), `${ruta} → ${respuesta.status}`);
    const cuerpo = await respuesta.text();
    assert.ok(!cuerpo.includes('ANTHROPIC'), ruta);
  }
  await panel.cerrar();
});
