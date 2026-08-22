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

import * as agenda from '../nucleo/agenda.js';
import * as citas from '../nucleo/citas.js';
import * as clientes from '../nucleo/clientes.js';
import * as bandeja from '../nucleo/bandeja.js';
import * as recordatorios from '../nucleo/recordatorios.js';
import * as redaccion from '../nucleo/redaccion.js';
import { contestar, cerebroDisponible } from '../cerebro/index.js';
import { claveDia, instanteDe, sumarDias } from '../nucleo/tiempo.js';
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
      return await api(ruta, req, res, url, estado);
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

async function api(ruta, req, res, url, estado) {
  const { db, config } = estado;
  const zona = config.negocio.zonaHoraria;
  const partes = ruta.split('/').filter(Boolean).slice(1); // fuera 'api'
  const cuerpo = req.method === 'GET' ? {} : await leerCuerpo(req);
  const hoy = claveDia(zona, Date.now());

  // /api/estado
  if (partes[0] === 'estado') {
    const dia = agenda.resumenDia(db, config, hoy);
    return json(res, {
      negocio: config.negocio,
      vocabulario: config.vocabulario,
      servicios: config.servicios.filter((s) => s.activo).map((s) => ({
        id: s.id, nombre: s.nombre, duracion: s.duracionMinutos, precio: s.precio,
      })),
      recursos: config.recursos.filter((r) => r.activo).map((r) => ({ id: r.id, nombre: r.nombre })),
      cerebro: cerebroDisponible(),
      canales: estado.canales ?? {},
      hoy: { dia: hoy, citas: dia.total, previsto: dia.previstoCentimos, abierto: dia.abierto },
      sinLeer: bandeja.sinLeer(db),
      porCerrar: citas.pendientesDeCerrar(db).length,
      recordatorios: recordatorios.listar(db, { estado: 'a_mano', limite: 50 }).length,
    });
  }

  // /api/agenda?dia=
  if (partes[0] === 'agenda') {
    const dia = url.searchParams.get('dia') ?? hoy;
    return json(res, agenda.resumenDia(db, config, dia));
  }

  // /api/huecos?servicio=&dia=&franja=&recurso=
  if (partes[0] === 'huecos') {
    const resultado = agenda.buscarHuecos(db, config, {
      servicioId: url.searchParams.get('servicio'),
      desde: url.searchParams.get('dia') ?? null,
      franja: url.searchParams.get('franja'),
      recursoId: url.searchParams.get('recurso'),
      dias: Number(url.searchParams.get('dias') ?? 7),
      limite: Number(url.searchParams.get('limite') ?? 12),
    });
    return json(res, resultado);
  }

  // /api/citas
  if (partes[0] === 'citas') {
    if (req.method === 'POST' && !partes[1]) {
      const resultado = citas.reservar(db, config, {
        servicioId: cuerpo.servicio,
        inicio: Number(cuerpo.inicio),
        recursoId: cuerpo.recurso ?? null,
        clienteId: cuerpo.clienteId ?? null,
        cliente: cuerpo.cliente ?? null,
        notas: cuerpo.notas ?? '',
        canal: 'panel',
      });
      return json(res, resultado, resultado.ok ? 200 : 409);
    }
    if (partes[1] && partes[2] === 'mover' && req.method === 'POST') {
      const resultado = citas.mover(db, config, { citaId: partes[1], nuevoInicio: Number(cuerpo.inicio), recursoId: cuerpo.recurso ?? null });
      return json(res, resultado, resultado.ok ? 200 : 409);
    }
    if (partes[1] && partes[2] === 'anular' && req.method === 'POST') {
      return json(res, citas.anular(db, config, { citaId: partes[1], motivo: cuerpo.motivo ?? '' }));
    }
    if (partes[1] && partes[2] === 'estado' && req.method === 'POST') {
      return json(res, citas.marcar(db, config, { citaId: partes[1], estado: cuerpo.estado, precio: cuerpo.precio }));
    }
    if (partes[1] && partes[2] === 'notas' && req.method === 'POST') {
      return json(res, { ok: true, cita: citas.notas(db, partes[1], cuerpo.texto ?? '') });
    }
    if (partes[1] === 'por-cerrar') return json(res, citas.pendientesDeCerrar(db));
  }

  // /api/clientes
  if (partes[0] === 'clientes') {
    if (!partes[1] && req.method === 'GET') {
      return json(res, clientes.listar(db, {
        busqueda: url.searchParams.get('busqueda') ?? '',
        limite: Number(url.searchParams.get('limite') ?? 60),
      }));
    }
    if (!partes[1] && req.method === 'POST') {
      return json(res, clientes.buscarOCrear(db, cuerpo));
    }
    if (partes[1] && req.method === 'GET') return json(res, clientes.ficha(db, partes[1]));
    if (partes[1] && (req.method === 'PATCH' || req.method === 'POST')) {
      return json(res, clientes.actualizar(db, partes[1], cuerpo));
    }
  }

  // /api/bandeja
  if (partes[0] === 'bandeja') {
    if (!partes[1]) {
      return json(res, bandeja.listar(db, {
        estado: url.searchParams.get('estado'),
        canal: url.searchParams.get('canal'),
        limite: Number(url.searchParams.get('limite') ?? 50),
      }));
    }
    if (partes[1] && !partes[2] && req.method === 'GET') {
      bandeja.marcarLeida(db, partes[1]);
      const conversacion = bandeja.conversacionPorId(db, partes[1]);
      return json(res, {
        conversacion,
        cliente: conversacion?.cliente_id ? clientes.ficha(db, conversacion.cliente_id) : null,
        mensajes: bandeja.mensajesDe(db, partes[1], { limite: 100 }),
      });
    }
    if (partes[2] === 'responder' && req.method === 'POST') {
      bandeja.tomarElMando(db, partes[1], 'panel');
      const mensaje = bandeja.saliente(db, partes[1], cuerpo.texto ?? '', { autor: 'humano' });
      const conversacion = bandeja.conversacionPorId(db, partes[1]);
      const enviado = await estado.enviar?.(conversacion, cuerpo.texto ?? '');
      return json(res, { ok: true, mensaje, enviado: enviado ?? { ok: false, motivo: 'sin-canal' } });
    }
    if (partes[2] === 'mando' && req.method === 'POST') {
      const conversacion = cuerpo.estado === 'bot'
        ? bandeja.devolverAlBot(db, partes[1])
        : bandeja.tomarElMando(db, partes[1], 'panel');
      return json(res, conversacion);
    }
  }

  // /api/simulador
  if (partes[0] === 'simulador' && req.method === 'POST') {
    const resultado = await contestar({
      db,
      config,
      canal: 'simulador',
      externo: cuerpo.externo || 'simulador',
      texto: cuerpo.texto ?? '',
      contacto: cuerpo.telefono ? { telefono: cuerpo.telefono } : {},
      forzarCerebro: cuerpo.cerebro ?? null,
    });
    return json(res, {
      texto: resultado.texto,
      cerebro: resultado.cerebro,
      acciones: (resultado.acciones ?? []).map((a) => ({ herramienta: a.herramienta, entrada: a.entrada, ok: a.resultado?.ok })),
      conversacionId: resultado.conversacion?.id,
    });
  }

  // /api/recordatorios
  if (partes[0] === 'recordatorios') {
    if (!partes[1] && req.method === 'GET') {
      return json(res, recordatorios.listar(db, { estado: url.searchParams.get('estado'), limite: 100 }));
    }
    if (partes[2] === 'enviado' && req.method === 'POST') {
      recordatorios.marcarEnviado(db, partes[1], 'a mano');
      return json(res, { ok: true });
    }
  }

  // /api/inactivos
  if (partes[0] === 'inactivos') {
    return json(res, clientes.inactivos(db, {
      dias: Number(url.searchParams.get('dias') ?? config.recordatorios.seguimientoInactivosDias ?? 120),
      limite: 50,
    }));
  }

  return json(res, { error: 'No existe ese sitio' }, 404);
}
