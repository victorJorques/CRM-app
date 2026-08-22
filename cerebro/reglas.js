// ---------------------------------------------------------------------------
// El cerebro que no necesita clave de nada. Es mas rigido que un modelo, pero
// entiende castellano suficiente para coger una cita, cambiarla y anularla, y
// usa exactamente las mismas herramientas. Si un dia se cae la API, aqui no se
// entera nadie salvo por las frases, que son mas secas.
// ---------------------------------------------------------------------------

import { ejecutar } from './herramientas.js';
import {
  detectarIntencion, resolverServicio, resolverDia, resolverHora, resolverFranja,
  resolverRecurso, elegirDeLaLista, extraerNombre, esAfirmacion, esNegacion, limpiar,
  desambiguarConHorario, horaEsExplicita,
} from './entender.js';
import * as redaccion from '../nucleo/redaccion.js';
import * as clientes from '../nucleo/clientes.js';
import { sinTildes } from '../nucleo/config.js';
import { fechaYHora } from '../nucleo/tiempo.js';

const MAX_SIN_ENTENDER = 2;

function huecoDeMemoria(memoria, hora) {
  return (memoria.huecos ?? []).find((h) => h.hora === hora) ?? null;
}

export function responder(texto, ctx) {
  const { db, config } = ctx;
  const memoria = { ...(ctx.memoria ?? {}) };
  const acciones = [];
  const ahora = ctx.ahora ?? Date.now();
  const v = config.vocabulario;

  const usar = (nombre, entrada = {}) => {
    const resultado = ejecutar(nombre, entrada, ctx);
    acciones.push({ herramienta: nombre, entrada, resultado });
    return resultado;
  };

  const cerrar = (respuesta, nuevaMemoria = {}) => ({
    texto: respuesta,
    acciones,
    memoria: { ...memoria, ...nuevaMemoria, sinEntender: 0 },
  });

  const t = limpiar(texto);
  const intencion = detectarIntencion(texto, config);
  const ficha = ctx.conversacion?.cliente_id ? clientes.porId(db, ctx.conversacion.cliente_id) : null;

  // --- 0. Lo que no es del bot: quejas y peticiones de hablar con alguien ---
  if (intencion === 'escalar' || config.escalado.palabras.some((p) => t.includes(sinTildes(p)))) {
    const r = usar('escalar', { motivo: texto.slice(0, 200) });
    return cerrar(r.resumen, { paso: 'inicio', propuesta: null });
  }

  // --- 1. Estamos esperando un nombre para cerrar la reserva ---
  // Ojo: "anúlamela" tambien parece un nombre si uno se fia solo de la forma.
  // Solo lo tomamos como nombre si el mensaje no dice otra cosa.
  if (memoria.paso === 'pidiendo_nombre' && ['otro', 'vacio', 'gracias', 'confirmar'].includes(intencion)) {
    const nombre = extraerNombre(texto, { esperandoNombre: true });
    if (nombre) {
      usar('guardar_nombre', { nombre });
      return cerrarReserva({ ...ctx, memoria }, memoria, usar, cerrar, nombre);
    }
    return cerrar('¿A nombre de quién la apunto?', { paso: 'pidiendo_nombre' });
  }

  // --- 2. Hay una propuesta encima de la mesa ---
  if (memoria.paso === 'confirmando' && memoria.propuesta) {
    if (esAfirmacion(texto)) {
      const nombre = extraerNombre(texto) ?? ficha?.nombre ?? ctx.contacto?.nombre ?? null;
      if (!nombre) return cerrar('Perfecto. ¿A nombre de quién la apunto?', { paso: 'pidiendo_nombre' });
      return cerrarReserva(ctx, memoria, usar, cerrar, nombre);
    }
    if (esNegacion(texto) || intencion === 'rechazar') {
      const r = usar('buscar_huecos', {
        servicio: memoria.servicioNombre,
        dia: memoria.dia ?? undefined,
      });
      if (r.ok && r._huecos?.length) {
        return cerrar(`Sin problema. ${r.resumen}`, {
          paso: 'eligiendo_hora', huecos: r._huecos.map(ligero), propuesta: null,
        });
      }
      return cerrar('Sin problema. ¿Qué día te viene bien?', { paso: 'eligiendo_hora', propuesta: null });
    }
    // Si en vez de confirmar propone otra hora, seguimos por el camino normal.
  }

  // --- 3. Estabamos ofreciendo horas y el cliente elige una ---
  if ((memoria.paso === 'eligiendo_hora' || memoria.paso === 'confirmando') && memoria.huecos?.length) {
    const elegido = elegirDeLaLista(texto, memoria.huecos);
    if (elegido) {
      const servicio = config.servicios.find((s) => s.id === memoria.servicioId);
      return cerrar(
        redaccion.propuesta(config, { servicio, hueco: { ...elegido }, ahora }),
        { paso: 'confirmando', propuesta: elegido },
      );
    }
    // Un "sí" a secas cuando lo que hay encima son varias horas no es una
    // confirmacion de nada: hay que preguntar cual.
    if (esAfirmacion(texto) && !memoria.propuesta) {
      return cerrar(
        `¿Cuál te viene mejor, ${redaccion.enumerar(memoria.huecos.map((h) => h.hora), 'o')}?`,
        { paso: 'eligiendo_hora' },
      );
    }
  }

  // --- 4. Anular -------------------------------------------------------------
  if (intencion === 'anular' || memoria.paso === 'anulando') {
    if (memoria.paso === 'anulando' && esAfirmacion(texto)) {
      const r = usar('anular_cita', { cita_id: memoria.citaId ?? undefined });
      return cerrar(r.resumen, { paso: 'inicio', citaId: null });
    }
    if (memoria.paso === 'anulando' && esNegacion(texto)) {
      return cerrar('Vale, la dejo como está.', { paso: 'inicio', citaId: null });
    }
    const mias = usar('mis_citas', {});
    const lista = mias._citas ?? [];
    if (lista.length === 0) return cerrar(`No me consta ninguna ${v.cita} pendiente a tu nombre.`, { paso: 'inicio' });
    if (lista.length === 1) {
      return cerrar(
        `¿Te anulo ${v.laCita} de ${lista[0].servicio_nombre} del ${fechaYHora(config.negocio.zonaHoraria, lista[0].inicio)}?`,
        { paso: 'anulando', citaId: lista[0].id },
      );
    }
    return cerrar(
      `Tienes ${lista.length} ${v.citas}: ${lista.map((c, i) => `${i + 1}) ${c.servicio_nombre} ${fechaYHora(config.negocio.zonaHoraria, c.inicio)}`).join('; ')}. ¿Cuál anulo?`,
      { paso: 'anulando', citaId: null },
    );
  }

  // --- 5. Mover --------------------------------------------------------------
  if (intencion === 'mover' || memoria.paso === 'moviendo') {
    const dia = resolverDia(texto, { zona: config.negocio.zonaHoraria, ahora });
    const horaTexto = resolverHora(texto);
    if (dia && horaTexto !== null) {
      const r = usar('mover_cita', { dia, hora: minutosATexto(horaTexto), cita_id: memoria.citaId ?? undefined });
      if (r.ok) return cerrar(r.resumen, { paso: 'inicio', citaId: null });
      if (r._huecos?.length) {
        return cerrar(r.resumen, { paso: 'moviendo', huecos: r._huecos.map(ligero) });
      }
      return cerrar(r.resumen, { paso: 'moviendo' });
    }
    const mias = usar('mis_citas', {});
    const lista = mias._citas ?? [];
    if (lista.length === 0) return cerrar(`No me consta ninguna ${v.cita} pendiente a tu nombre.`, { paso: 'inicio' });
    if (dia && horaTexto === null) {
      const r = usar('buscar_huecos', { servicio: lista[0].servicio_nombre, dia, franja: resolverFranja(texto) ?? undefined });
      return cerrar(r.resumen ?? '¿A qué hora te viene bien?', {
        paso: 'moviendo', citaId: lista[0].id, huecos: (r._huecos ?? []).map(ligero), servicioId: lista[0].servicio_id, servicioNombre: lista[0].servicio_nombre,
      });
    }
    return cerrar(
      `Tienes ${lista[0].servicio_nombre} el ${fechaYHora(config.negocio.zonaHoraria, lista[0].inicio)}. ¿Para qué día y hora la muevo?`,
      { paso: 'moviendo', citaId: lista[0].id },
    );
  }

  // --- 6. Preguntas de siempre ----------------------------------------------
  if (intencion === 'consultar') {
    const r = usar('mis_citas', {});
    return cerrar(r._citas?.length ? `Tienes ${r.resumen}.` : r.resumen, { paso: 'inicio' });
  }
  if (intencion === 'horario') return cerrar(usar('info_negocio', { que: 'horario' }).resumen, { paso: 'inicio' });
  if (intencion === 'direccion') return cerrar(usar('info_negocio', { que: 'direccion' }).resumen, { paso: 'inicio' });
  if (intencion === 'servicios') return cerrar(usar('info_negocio', { que: 'servicios' }).resumen, { paso: 'inicio' });
  if (intencion === 'precio' && !resolverServicio(config, texto)) {
    return cerrar(usar('info_negocio', { que: 'precios' }).resumen, { paso: 'inicio' });
  }

  // --- 7. Pedir cita ---------------------------------------------------------
  const servicio = resolverServicio(config, texto)
    ?? (memoria.servicioId ? config.servicios.find((s) => s.id === memoria.servicioId) : null);
  // Si veniamos hablando de un dia y ahora solo dice la hora, el dia sigue
  // siendo aquel: "el lunes por la mañana" -> "a las 10:30".
  const enMitadDeUnaCita = memoria.paso === 'eligiendo_hora' || memoria.paso === 'confirmando';
  const dia = resolverDia(texto, { zona: config.negocio.zonaHoraria, ahora })
    ?? (enMitadDeUnaCita ? memoria.dia ?? null : null);
  const franja = resolverFranja(texto);
  const recurso = resolverRecurso(config, texto);
  const minutos = resolverHora(texto);
  const quiereCita = intencion === 'reservar' || servicio || (dia && memoria.paso === 'eligiendo_hora');

  if (quiereCita) {
    if (!servicio) {
      return cerrar(
        `¿Para qué ${v.servicio}? Hacemos ${redaccion.listaServicios(config).join(', ')}.`,
        { paso: 'eligiendo_servicio' },
      );
    }
    if (intencion === 'precio') {
      const precio = redaccion.precioServicio(config, servicio);
      const respuesta = precio
        ? `${servicio.nombre}: ${precio} (${servicio.duracionMinutos} min). ¿Te busco hueco?`
        : `${servicio.nombre} dura ${servicio.duracionMinutos} min. ¿Te busco hueco?`;
      return cerrar(respuesta, { paso: 'eligiendo_hora', servicioId: servicio.id, servicioNombre: servicio.nombre });
    }

    // Hora concreta: se comprueba, no se promete.
    if (dia && minutos !== null) {
      const enPunto = desambiguarConHorario(config, minutos, dia, { explicita: horaEsExplicita(texto) });
      const r = usar('comprobar_hora', {
        servicio: servicio.nombre, dia, hora: minutosATexto(enPunto), recurso: recurso?.nombre,
      });
      if (r.ok && r.libre) {
        return cerrar(
          redaccion.propuesta(config, { servicio, hueco: r._hueco, ahora }),
          { paso: 'confirmando', propuesta: ligero(r._hueco), servicioId: servicio.id, servicioNombre: servicio.nombre, dia },
        );
      }
      return cerrar(r.resumen, {
        paso: 'eligiendo_hora', servicioId: servicio.id, servicioNombre: servicio.nombre,
        dia, huecos: (r._huecos ?? []).map(ligero),
      });
    }

    const r = usar('buscar_huecos', {
      servicio: servicio.nombre,
      dia: dia ?? undefined,
      franja: franja ?? undefined,
      recurso: recurso?.nombre,
    });
    if (r.ok && r._huecos?.length) {
      return cerrar(r.resumen, {
        paso: 'eligiendo_hora', servicioId: servicio.id, servicioNombre: servicio.nombre,
        dia: dia ?? null, huecos: r._huecos.map(ligero),
      });
    }
    return cerrar(r.resumen ?? redaccion.sinHuecos(config, { servicio, dia }), {
      paso: 'eligiendo_hora', servicioId: servicio.id, servicioNombre: servicio.nombre,
    });
  }

  if (intencion === 'saludo') {
    return cerrar(`${redaccion.saludo(config)}`, { paso: 'inicio' });
  }
  if (intencion === 'gracias') {
    return cerrar('A ti. Si necesitas algo más, aquí estoy.', { paso: 'inicio' });
  }

  // --- 8. No lo he entendido -------------------------------------------------
  const fallos = (memoria.sinEntender ?? 0) + 1;
  if (fallos > MAX_SIN_ENTENDER) {
    const r = usar('escalar', { motivo: 'El bot no entiende al cliente' });
    return { texto: `${r.resumen}`, acciones, memoria: { ...memoria, paso: 'inicio', sinEntender: 0 } };
  }
  return {
    texto: `No te he entendido del todo. Puedo darte ${v.cita}, cambiarla o anularla. ¿Qué necesitas?`,
    acciones,
    memoria: { ...memoria, sinEntender: fallos },
  };
}

function cerrarReserva(ctx, memoria, usar, cerrar, nombre) {
  const propuesta = memoria.propuesta;
  if (!propuesta) return cerrar('¿Qué día y a qué hora te viene bien?', { paso: 'eligiendo_hora' });
  const r = usar('reservar', {
    servicio: memoria.servicioNombre,
    dia: propuesta.dia,
    hora: propuesta.hora,
    recurso: propuesta.recursoNombre,
    nombre: nombre ?? undefined,
  });
  if (r.ok) return cerrar(r.resumen, { paso: 'inicio', propuesta: null, huecos: [], dia: null, servicioId: null, servicioNombre: null });
  return cerrar(r.resumen, {
    paso: 'eligiendo_hora', propuesta: null, huecos: (r._huecos ?? []).map(ligero),
  });
}

/** Del hueco solo guardamos lo que hace falta para volver a pedirlo. */
function ligero(hueco) {
  return {
    dia: hueco.dia,
    hora: hueco.hora,
    minuto: hueco.minuto,
    inicio: hueco.inicio,
    recursoId: hueco.recursoId,
    recursoNombre: hueco.recursoNombre,
    servicioId: hueco.servicioId,
    servicioNombre: hueco.servicioNombre,
  };
}

function minutosATexto(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}
