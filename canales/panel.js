// ---------------------------------------------------------------------------
// El panel: un servidor HTTP sin dependencias que sirve la interfaz y la API.
// Cerrado por fuera: con clave y sesion firmada si hay CONSERJE_CLAVE, y solo
// desde este ordenador si no la hay.
// ---------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { api } from './api.js';
import { cerebroDisponible } from '../cerebro/index.js';
import { recibirWhatsapp, verificarWhatsapp } from './whatsapp.js';
import { recibirLlamada } from './llamadas.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const DURACION_SESION = 12 * 3600 * 1000;

function json(res, datos, estado = 200) {
  const cuerpo = JSON.stringify(datos ?? null);
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(cuerpo);
}

async function leerTexto(req, { maximo = 512 * 1024 } = {}) {
  const trozos = [];
  let total = 0;
  for await (const trozo of req) {
    total += trozo.length;
    if (total > maximo) throw new Error('El cuerpo de la petición es demasiado grande');
    trozos.push(trozo);
  }
  return Buffer.concat(trozos).toString('utf8');
}

async function leerCuerpo(req, { maximo = 512 * 1024 } = {}) {
  const trozos = [];
  let total = 0;
  for await (const trozo of req) {
    total += trozo.length;
    if (total > maximo) throw new Error('El cuerpo de la petición es demasiado grande');
    trozos.push(trozo);
  }
  if (total === 0) return {};
  const texto = Buffer.concat(trozos).toString('utf8');
  const tipo = req.headers['content-type'] ?? '';
  if (tipo.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(texto));
  }
  try { return JSON.parse(texto); } catch { return { _crudo: texto }; }
}

function galletas(req) {
  const cabecera = req.headers.cookie ?? '';
  return Object.fromEntries(cabecera.split(';').map((t) => {
    const i = t.indexOf('=');
    return i < 0 ? [t.trim(), ''] : [t.slice(0, i).trim(), decodeURIComponent(t.slice(i + 1).trim())];
  }).filter(([k]) => k));
}

function firmar(valor, secreto) {
  const firma = createHmac('sha256', secreto).update(valor).digest('base64url');
  return `${valor}.${firma}`;
}

function comprobarFirma(galleta, secreto) {
  if (!galleta || !galleta.includes('.')) return null;
  const corte = galleta.lastIndexOf('.');
  const valor = galleta.slice(0, corte);
  const firma = galleta.slice(corte + 1);
  const esperada = createHmac('sha256', secreto).update(valor).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const caduca = Number(valor.split(':')[1] ?? 0);
  return Number.isFinite(caduca) && caduca > Date.now() ? valor : null;
}

function esLocal(req) {
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Monta el servidor. `estado` lleva la base, la configuracion y los ajustes
 * que dependen del entorno (clave, secreto, canales encendidos).
 */
export function crearServidor(estado) {
  const { db, config } = estado;
  const clave = estado.clave ?? process.env.CONSERJE_CLAVE ?? '';
  const secreto = estado.secreto ?? process.env.CONSERJE_SECRETO ?? randomBytes(32).toString('hex');

  const autorizado = (req) => {
    if (!clave) return esLocal(req);
    return Boolean(comprobarFirma(galletas(req).conserje, secreto));
  };

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    try {
      // --- Webhooks: no llevan sesion, llevan firma propia ---
      if (ruta === '/webhook/whatsapp') {
        if (req.method === 'GET') return verificarWhatsapp(req, res, url);
        // La firma se calcula sobre el cuerpo sin tocar, asi que va crudo.
        return recibirWhatsapp(req, res, estado, await leerTexto(req));
      }
      if (ruta === '/webhook/llamada') {
        return recibirLlamada(req, res, estado, await leerCuerpo(req), url);
      }
      if (ruta === '/salud') return json(res, { ok: true, negocio: config.negocio.nombre, cerebro: cerebroDisponible() });

      // --- Entrar y salir ---
      if (ruta === '/api/entrar' && req.method === 'POST') {
        const cuerpo = await leerCuerpo(req);
        if (!clave) return json(res, { ok: true, sinClave: true });
        if (String(cuerpo.clave ?? '') !== clave) {
          await new Promise((r) => setTimeout(r, 400));
          return json(res, { ok: false, error: 'La clave no es esa.' }, 401);
        }
        const galleta = firmar(`${randomBytes(8).toString('hex')}:${Date.now() + DURACION_SESION}`, secreto);
        res.setHeader('set-cookie', `conserje=${encodeURIComponent(galleta)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACION_SESION / 1000}`);
        return json(res, { ok: true });
      }
      if (ruta === '/api/salir') {
        res.setHeader('set-cookie', 'conserje=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(res, { ok: true });
      }

      // --- Estaticos ---
      if (!ruta.startsWith('/api/')) return servirEstatico(ruta, res);

      if (!autorizado(req)) {
        return json(res, { error: clave ? 'Hay que entrar con la clave.' : 'Solo desde este ordenador.' }, 401);
      }
      const respuesta = await api(ruta, {
        metodo: req.method,
        url,
        cuerpo: req.method === 'GET' ? {} : await leerCuerpo(req),
      }, estado);
      return json(res, respuesta.datos, respuesta.codigo);
    } catch (error) {
      db.apuntar('panel.error', ruta, { mensaje: error.message });
      return json(res, { error: error.message }, 500);
    }
  });

  servidor.necesitaClave = Boolean(clave);
  return servidor;
}

async function servirEstatico(ruta, res) {
  const archivo = ruta === '/' ? 'index.html' : ruta.replace(/^\//, '');
  if (archivo.includes('..')) {
    res.writeHead(400).end('Ruta no válida');
    return;
  }
  try {
    const contenido = await readFile(join(RAIZ, 'panel', archivo));
    res.writeHead(200, {
      'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(contenido);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Aquí no hay nada');
  }
}
