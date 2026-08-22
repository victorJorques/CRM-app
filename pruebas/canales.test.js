import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as whatsapp from '../canales/whatsapp.js';
import * as llamadas from '../canales/llamadas.js';
import * as correo from '../canales/correo.js';
import { mandar, canalesEncendidos } from '../canales/enviar.js';

test('sin token, los canales están apagados', () => {
  const encendidos = canalesEncendidos();
  assert.equal(encendidos.whatsapp, Boolean(process.env.WHATSAPP_TOKEN));
  assert.equal(encendidos.correo, Boolean(process.env.CORREO_USUARIO));
});

test('sin ningún canal, mandar lo dice en vez de fingir', async () => {
  const resultado = await mandar({ telefono: '+34600111222' }, 'hola');
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'sin-canal');
});

test('la firma de Meta se comprueba de verdad', () => {
  process.env.WHATSAPP_SECRETO_APP = 'secreto';
  const cuerpo = JSON.stringify({ entry: [] });
  const buena = `sha256=${createHmac('sha256', 'secreto').update(cuerpo, 'utf8').digest('hex')}`;
  assert.equal(whatsapp.firmaValida(cuerpo, buena), true);
  assert.equal(whatsapp.firmaValida(cuerpo, 'sha256=0000'), false);
  assert.equal(whatsapp.firmaValida(cuerpo, undefined), false);
  delete process.env.WHATSAPP_SECRETO_APP;
});

test('sin secreto de app no se puede comprobar la firma, y se dice', () => {
  assert.equal(whatsapp.firmaValida('{}', 'sha256=abc'), null);
});

test('del webhook de WhatsApp se saca quién escribe y qué dice', () => {
  const mensajes = whatsapp.extraerMensajes({
    entry: [{
      changes: [{
        value: {
          contacts: [{ wa_id: '34600111222', profile: { name: 'Rocío' } }],
          messages: [{ id: '1', from: '34600111222', type: 'text', text: { body: 'hola' } }],
        },
      }],
    }],
  });
  assert.equal(mensajes.length, 1);
  assert.deepEqual(
    { de: mensajes[0].de, nombre: mensajes[0].nombre, texto: mensajes[0].texto },
    { de: '+34600111222', nombre: 'Rocío', texto: 'hola' },
  );
});

test('una nota de voz se reconoce como audio, no se inventa el texto', () => {
  const [mensaje] = whatsapp.extraerMensajes({
    entry: [{ changes: [{ value: { messages: [{ id: '2', from: '34600111222', type: 'audio' }] } }] }],
  });
  assert.equal(mensaje.aviso, 'audio');
  assert.equal(mensaje.texto, '');
});

test('un webhook vacío no da mensajes ni rompe', () => {
  assert.deepEqual(whatsapp.extraerMensajes({}), []);
  assert.deepEqual(whatsapp.extraerMensajes(null), []);
});

test('el TwiML de la llamada escucha y se despide si no oye', () => {
  const xml = llamadas.twiml({ decir: 'Peluquería Ana, dime' });
  assert.match(xml, /<Gather input="speech" language="es-ES"/);
  assert.match(xml, /Peluquería Ana, dime/);
  assert.match(xml, /No te he oído/);
});

test('el TwiML escapa lo que se le meta', () => {
  const xml = llamadas.twiml({ decir: 'Ana & <Luis>' });
  assert.match(xml, /Ana &amp; &lt;Luis&gt;/);
  assert.ok(!xml.includes('<Luis>'));
});

test('el TwiML puede colgar', () => {
  const xml = llamadas.twiml({ decir: 'Hasta luego', escuchar: false, colgar: true });
  assert.match(xml, /<Hangup\/>/);
  assert.ok(!xml.includes('<Gather'));
});

test('la firma de Twilio se comprueba de verdad', () => {
  process.env.TWILIO_TOKEN = 'token-de-prueba';
  const url = 'https://ejemplo.com/webhook/llamada';
  const parametros = { From: '+34600111222', SpeechResult: 'quiero cita' };
  const cadena = Object.keys(parametros).sort().reduce((a, k) => a + k + parametros[k], url);
  const firma = createHmac('sha1', 'token-de-prueba').update(Buffer.from(cadena, 'utf8')).digest('base64');
  assert.equal(llamadas.firmaValida({ url, parametros, firma }), true);
  assert.equal(llamadas.firmaValida({ url, parametros, firma: 'inventada' }), false);
  delete process.env.TWILIO_TOKEN;
});

test('un correo sencillo se lee entero', () => {
  const crudo = [
    'From: Rocío <rocio@ejemplo.com>',
    'Subject: Cita del lunes',
    'Message-ID: <abc@ejemplo.com>',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Hola, quiero cambiar la cita.',
  ].join('\r\n');
  const leido = correo.analizarCorreo(crudo);
  assert.equal(leido.de, 'rocio@ejemplo.com');
  assert.equal(leido.nombre, 'Rocío');
  assert.equal(leido.asunto, 'Cita del lunes');
  assert.equal(leido.id, '<abc@ejemplo.com>');
  assert.match(leido.texto, /quiero cambiar la cita/);
});

test('un correo con acentos codificados se lee bien', () => {
  const crudo = [
    'From: =?UTF-8?Q?Roc=C3=ADo?= <rocio@ejemplo.com>',
    'Subject: =?UTF-8?B?Q2l0YSBkZWwgbHVuZXM=?=',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hola, =C2=BFpod=C3=A9is cambiarme la cita?',
  ].join('\r\n');
  const leido = correo.analizarCorreo(crudo);
  assert.equal(leido.nombre, 'Rocío');
  assert.equal(leido.asunto, 'Cita del lunes');
  assert.match(leido.texto, /¿podéis cambiarme la cita\?/);
});

test('de un correo multiparte se coge la parte de texto', () => {
  const crudo = [
    'From: Ana <ana@ejemplo.com>',
    'Subject: prueba',
    'Content-Type: multipart/alternative; boundary="lim"',
    '',
    '--lim',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Quiero cita el martes',
    '--lim',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<p>Quiero cita el martes</p>',
    '--lim--',
  ].join('\r\n');
  assert.equal(correo.analizarCorreo(crudo).texto, 'Quiero cita el martes');
});

test('lo que va citado del correo anterior no cuenta', () => {
  const crudo = [
    'From: Ana <ana@ejemplo.com>',
    'Subject: Re: cita',
    'Content-Type: text/plain',
    '',
    'Perfecto, el martes me va bien.',
    '',
    'El 21 ago 2026 escribio:',
    '> Te propongo el martes a las 10',
  ].join('\r\n');
  assert.equal(correo.analizarCorreo(crudo).texto, 'Perfecto, el martes me va bien.');
});

test('un correo sin remitente reconocible no identifica a nadie', () => {
  const leido = correo.analizarCorreo('Subject: nada\r\n\r\ntexto');
  assert.equal(leido.de, null);
});

test('sin configurar, leer el buzón no lo intenta siquiera', async () => {
  const resultado = await correo.revisarBuzon({ db: null, config: null });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'correo-sin-configurar');
});

test('sin configurar, mandar por WhatsApp o SMS lo dice', async () => {
  assert.equal((await whatsapp.enviar('+34600111222', 'hola')).motivo, 'whatsapp-sin-configurar');
  assert.equal((await llamadas.enviarSms('+34600111222', 'hola')).motivo, 'twilio-sin-configurar');
});
