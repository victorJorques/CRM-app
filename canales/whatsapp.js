// ---------------------------------------------------------------------------
// WhatsApp (API de Meta). Entra por webhook firmado y sale por la API de
// mensajes. Sin token configurado, todo esto queda apagado y no molesta.
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto';
import { contestar } from '../cerebro/index.js';

const VERSION = 'v21.0';

export function configurado() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_ID_NUMERO);
}

/** Meta comprueba el webhook con un GET antes de mandar nada. */
export function verificarWhatsapp(req, res, url) {
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const reto = url.searchParams.get('hub.challenge');
  if (modo === 'subscribe' && token && token === process.env.WHATSAPP_VERIFICACION) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(reto ?? '');
    return;
  }
  res.writeHead(403, { 'content-type': 'text/plain' });
  res.end('no');
}

/** La firma de Meta se calcula sobre el cuerpo tal cual llego, sin tocar. */
export function firmaValida(crudo, cabecera) {
  const secreto = process.env.WHATSAPP_SECRETO_APP;
  if (!secreto) return null;                 // sin secreto no se puede comprobar
  if (!cabecera?.startsWith('sha256=')) return false;
  const esperada = createHmac('sha256', secreto).update(crudo, 'utf8').digest('hex');
  const a = Buffer.from(cabecera.slice(7));
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Saca de la maraña de Meta lo unico que importa: quien escribe y que dice. */
export function extraerMensajes(cuerpo) {
  const salida = [];
  for (const entrada of cuerpo?.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      const valor = cambio.value ?? {};
      const perfiles = new Map((valor.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const mensaje of valor.messages ?? []) {
        const de = mensaje.from;
        const base = { id: mensaje.id, de: de.startsWith('+') ? de : `+${de}`, nombre: perfiles.get(de) ?? null, tipo: mensaje.type };
        if (mensaje.type === 'text') salida.push({ ...base, texto: mensaje.text?.body ?? '' });
        else if (mensaje.type === 'audio') salida.push({ ...base, texto: '', aviso: 'audio' });
        else if (mensaje.type === 'image') salida.push({ ...base, texto: mensaje.image?.caption ?? '', aviso: 'imagen' });
        else salida.push({ ...base, texto: '', aviso: mensaje.type });
      }
    }
  }
  return salida;
}

export async function recibirWhatsapp(req, res, estado, crudo) {
  const { db } = estado;
  const firma = firmaValida(crudo, req.headers['x-hub-signature-256']);
  if (firma === false) {
    db.apuntar('whatsapp.firma-mala', null, {});
    res.writeHead(401).end('firma');
    return;
  }
  let cuerpo;
  try { cuerpo = JSON.parse(crudo || '{}'); } catch { cuerpo = {}; }

  // A Meta se le contesta ya, y se trabaja despues: si tardas, reintenta.
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');

  for (const mensaje of extraerMensajes(cuerpo)) {
    try {
      const texto = mensaje.texto
        || (mensaje.aviso === 'audio'
          ? '[nota de voz]'
          : `[${mensaje.aviso ?? 'mensaje'}]`);
      const resultado = await contestar({
        db,
        config: estado.config,
        canal: 'whatsapp',
        externo: mensaje.de,
        texto,
        contacto: { telefono: mensaje.de, nombre: mensaje.nombre },
      });
      if (mensaje.aviso === 'audio') {
        // No transcribimos audio: se apunta y se avisa, sin fingir que se entiende.
        db.apuntar('whatsapp.audio', mensaje.de, { id: mensaje.id });
        await enviar(mensaje.de, 'Me ha llegado tu nota de voz, pero no puedo escucharla. ¿Me lo escribes?');
        continue;
      }
      if (resultado.texto) await enviar(mensaje.de, resultado.texto);
    } catch (error) {
      db.apuntar('whatsapp.error', mensaje.de, { mensaje: error.message });
    }
  }
}

export async function enviar(telefono, texto) {
  if (!configurado()) return { ok: false, motivo: 'whatsapp-sin-configurar' };
  const respuesta = await fetch(`https://graph.facebook.com/${VERSION}/${process.env.WHATSAPP_ID_NUMERO}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefono.replace(/^\+/, ''),
      type: 'text',
      text: { body: texto.slice(0, 4000) },
    }),
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    return { ok: false, motivo: `whatsapp-${respuesta.status}`, detalle: detalle.slice(0, 300) };
  }
  return { ok: true, canal: 'whatsapp' };
}
