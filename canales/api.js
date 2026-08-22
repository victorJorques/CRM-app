// ---------------------------------------------------------------------------
// La API de Conserje: agenda, citas, fichas, bandeja, avisos y simulador.
// Está separada del servidor a propósito. Aquí no hay ni una línea de HTTP:
// entra { ruta, método, cuerpo } y sale { codigo, datos }. Por eso el mismo
// enrutador vale para el panel de escritorio y para la demostración web.
// ---------------------------------------------------------------------------

import * as agenda from '../nucleo/agenda.js';
import * as citas from '../nucleo/citas.js';
import * as clientes from '../nucleo/clientes.js';
import * as bandeja from '../nucleo/bandeja.js';
import * as recordatorios from '../nucleo/recordatorios.js';
import { contestar, cerebroDisponible } from '../cerebro/index.js';
import { claveDia } from '../nucleo/tiempo.js';

/**
 * El enrutador de la API. No sabe nada de HTTP: recibe la ruta, el método, los
 * parámetros y el cuerpo, y devuelve { codigo, datos }. Así lo puede usar el
 * servidor (canales/panel.js) y también una página web sin servidor detrás.
 */
export async function api(ruta, { metodo = 'GET', url, cuerpo = {} } = {}, estado) {
  const { db, config } = estado;
  const zona = config.negocio.zonaHoraria;
  const partes = ruta.split('/').filter(Boolean).slice(1); // fuera 'api'
  const hoy = claveDia(zona, Date.now());

  // /api/estado
  if (partes[0] === 'estado') {
    const dia = agenda.resumenDia(db, config, hoy);
    return { codigo: 200, datos: {
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
    } };
  }

  // /api/agenda?dia=
  if (partes[0] === 'agenda') {
    const dia = url.searchParams.get('dia') ?? hoy;
    return { codigo: 200, datos: agenda.resumenDia(db, config, dia) };
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
    return { codigo: 200, datos: resultado };
  }

  // /api/citas
  if (partes[0] === 'citas') {
    if (metodo === 'POST' && !partes[1]) {
      const resultado = citas.reservar(db, config, {
        servicioId: cuerpo.servicio,
        inicio: Number(cuerpo.inicio),
        recursoId: cuerpo.recurso ?? null,
        clienteId: cuerpo.clienteId ?? null,
        cliente: cuerpo.cliente ?? null,
        notas: cuerpo.notas ?? '',
        canal: 'panel',
      });
      return { codigo: resultado.ok ? 200 : 409, datos: resultado };
    }
    if (partes[1] && partes[2] === 'mover' && metodo === 'POST') {
      const resultado = citas.mover(db, config, { citaId: partes[1], nuevoInicio: Number(cuerpo.inicio), recursoId: cuerpo.recurso ?? null });
      return { codigo: resultado.ok ? 200 : 409, datos: resultado };
    }
    if (partes[1] && partes[2] === 'anular' && metodo === 'POST') {
      return { codigo: 200, datos: citas.anular(db, config, { citaId: partes[1], motivo: cuerpo.motivo ?? '' }) };
    }
    if (partes[1] && partes[2] === 'estado' && metodo === 'POST') {
      return { codigo: 200, datos: citas.marcar(db, config, { citaId: partes[1], estado: cuerpo.estado, precio: cuerpo.precio }) };
    }
    if (partes[1] && partes[2] === 'notas' && metodo === 'POST') {
      return { codigo: 200, datos: { ok: true, cita: citas.notas(db, partes[1], cuerpo.texto ?? '') } };
    }
    if (partes[1] === 'por-cerrar') return { codigo: 200, datos: citas.pendientesDeCerrar(db) };
  }

  // /api/clientes
  if (partes[0] === 'clientes') {
    if (!partes[1] && metodo === 'GET') {
      return { codigo: 200, datos: clientes.listar(db, {
        busqueda: url.searchParams.get('busqueda') ?? '',
        limite: Number(url.searchParams.get('limite') ?? 60),
      }) };
    }
    if (!partes[1] && metodo === 'POST') {
      return { codigo: 200, datos: clientes.buscarOCrear(db, cuerpo) };
    }
    if (partes[1] && metodo === 'GET') return { codigo: 200, datos: clientes.ficha(db, partes[1]) };
    if (partes[1] && (metodo === 'PATCH' || metodo === 'POST')) {
      return { codigo: 200, datos: clientes.actualizar(db, partes[1], cuerpo) };
    }
  }

  // /api/bandeja
  if (partes[0] === 'bandeja') {
    if (!partes[1]) {
      return { codigo: 200, datos: bandeja.listar(db, {
        estado: url.searchParams.get('estado'),
        canal: url.searchParams.get('canal'),
        limite: Number(url.searchParams.get('limite') ?? 50),
      }) };
    }
    if (partes[1] && !partes[2] && metodo === 'GET') {
      bandeja.marcarLeida(db, partes[1]);
      const conversacion = bandeja.conversacionPorId(db, partes[1]);
      return { codigo: 200, datos: {
        conversacion,
        cliente: conversacion?.cliente_id ? clientes.ficha(db, conversacion.cliente_id) : null,
        mensajes: bandeja.mensajesDe(db, partes[1], { limite: 100 }),
      } };
    }
    if (partes[2] === 'responder' && metodo === 'POST') {
      bandeja.tomarElMando(db, partes[1], 'panel');
      const mensaje = bandeja.saliente(db, partes[1], cuerpo.texto ?? '', { autor: 'humano' });
      const conversacion = bandeja.conversacionPorId(db, partes[1]);
      const enviado = await estado.enviar?.(conversacion, cuerpo.texto ?? '');
      return { codigo: 200, datos: { ok: true, mensaje, enviado: enviado ?? { ok: false, motivo: 'sin-canal' } } };
    }
    if (partes[2] === 'mando' && metodo === 'POST') {
      const conversacion = cuerpo.estado === 'bot'
        ? bandeja.devolverAlBot(db, partes[1])
        : bandeja.tomarElMando(db, partes[1], 'panel');
      return { codigo: 200, datos: conversacion };
    }
  }

  // /api/simulador
  if (partes[0] === 'simulador' && metodo === 'POST') {
    const resultado = await contestar({
      db,
      config,
      canal: 'simulador',
      externo: cuerpo.externo || 'simulador',
      texto: cuerpo.texto ?? '',
      contacto: cuerpo.telefono ? { telefono: cuerpo.telefono } : {},
      forzarCerebro: cuerpo.cerebro ?? null,
    });
    return { codigo: 200, datos: {
      texto: resultado.texto,
      cerebro: resultado.cerebro,
      acciones: (resultado.acciones ?? []).map((a) => ({ herramienta: a.herramienta, entrada: a.entrada, ok: a.resultado?.ok })),
      conversacionId: resultado.conversacion?.id,
    } };
  }

  // /api/recordatorios
  if (partes[0] === 'recordatorios') {
    if (!partes[1] && metodo === 'GET') {
      return { codigo: 200, datos: recordatorios.listar(db, { estado: url.searchParams.get('estado'), limite: 100 }) };
    }
    if (partes[2] === 'enviado' && metodo === 'POST') {
      recordatorios.marcarEnviado(db, partes[1], 'a mano');
      return { codigo: 200, datos: { ok: true } };
    }
  }

  // /api/inactivos
  if (partes[0] === 'inactivos') {
    return { codigo: 200, datos: clientes.inactivos(db, {
      dias: Number(url.searchParams.get('dias') ?? config.recordatorios.seguimientoInactivosDias ?? 120),
      limite: 50,
    }) };
  }

  return { codigo: 404, datos: { error: 'No existe ese sitio' } };
}
