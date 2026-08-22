// ---------------------------------------------------------------------------
// Llamadas (Twilio). El telefono suena, Twilio transcribe lo que dice quien
// llama y nosotros contestamos con el mismo cerebro que en WhatsApp.
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto';
import { contestar } from '../cerebro/index.js';

export function configurado() {
  return Boolean(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_NUMERO);
}

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** TwiML: escucha, y si no oye nada, se despide. */
export function twiml({ decir, escuchar = true, url = '/webhook/llamada', colgar = false }) {
  const partes = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];
  const voz = '<Say language="es-ES" voice="Polly.Conchita">';
  if (escuchar && !colgar) {
    partes.push(`<Gather input="speech" language="es-ES" speechTimeout="auto" action="${escapar(url)}" method="POST">`);
    if (decir) partes.push(`${voz}${escapar(decir)}</Say>`);
    partes.push('</Gather>');
    partes.push(`${voz}No te he oído. Si quieres, escríbenos por WhatsApp y lo vemos. Hasta luego.</Say>`);
  } else {
    if (decir) partes.push(`${voz}${escapar(decir)}</Say>`);
    if (colgar) partes.push('<Hangup/>');
  }
  partes.push('</Response>');
  return partes.join('');
}

/** Firma de Twilio: URL completa + los campos del formulario ordenados. */
export function firmaValida({ url, parametros, firma }) {
  const token = process.env.TWILIO_TOKEN;
  if (!token) return null;
  if (!firma) return false;
  const cadena = Object.keys(parametros).sort()
    .reduce((acumulado, clave) => acumulado + clave + parametros[clave], url);
  const esperada = createHmac('sha1', token).update(Buffer.from(cadena, 'utf8')).digest('base64');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function recibirLlamada(req, res, estado, cuerpo, url) {
  const { db, config } = estado;
  const publica = process.env.CONSERJE_URL_PUBLICA
    ? `${process.env.CONSERJE_URL_PUBLICA.replace(/\/$/, '')}${url.pathname}`
    : `https://${req.headers.host}${url.pathname}`;
  const firma = firmaValida({ url: publica, parametros: cuerpo, firma: req.headers['x-twilio-signature'] });
  if (firma === false) {
    db.apuntar('llamada.firma-mala', null, {});
    res.writeHead(401).end('firma');
    return;
  }

  const de = cuerpo.From ?? cuerpo.Caller ?? 'desconocido';
  const dicho = (cuerpo.SpeechResult ?? '').trim();
  const responder = (xml) => {
    res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' });
    res.end(xml);
  };

  if (!dicho) {
    return responder(twiml({
      decir: `${config.negocio.nombre}. Dime qué necesitas y te ayudo.`,
    }));
  }

  try {
    const resultado = await contestar({
      db, config, canal: 'llamada', externo: de, texto: dicho, contacto: { telefono: de },
    });
    if (resultado.silencio) {
      return responder(twiml({
        decir: 'Ahora mismo te atiende una persona del equipo. Te llamamos en un momento.',
        escuchar: false, colgar: true,
      }));
    }
    return responder(twiml({ decir: resultado.texto ?? 'Perdona, no te he entendido.' }));
  } catch (error) {
    db.apuntar('llamada.error', de, { mensaje: error.message });
    return responder(twiml({
      decir: 'Ahora mismo no puedo ayudarte. Te devolvemos la llamada enseguida.',
      escuchar: false, colgar: true,
    }));
  }
}

export async function enviarSms(telefono, texto) {
  if (!configurado()) return { ok: false, motivo: 'twilio-sin-configurar' };
  const cuerpo = new URLSearchParams({ To: telefono, From: process.env.TWILIO_NUMERO, Body: texto.slice(0, 640) });
  const respuesta = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: cuerpo.toString(),
  });
  if (!respuesta.ok) return { ok: false, motivo: `twilio-${respuesta.status}` };
  return { ok: true, canal: 'sms' };
}
