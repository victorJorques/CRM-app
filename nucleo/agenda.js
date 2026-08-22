// ---------------------------------------------------------------------------
// El motor de huecos. Es la unica fuente de horas del sistema: ni el panel ni
// el bot se inventan una hora, la piden aqui. Y al reservar se vuelve a
// preguntar dentro de la transaccion, por si alguien se ha colado por medio.
// ---------------------------------------------------------------------------

import {
  claveDia, diaSemana, instanteDe, sumarDias, diasEntre, hora, horaDeMinutos,
} from './tiempo.js';
import {
  servicioPorId, recursoPorId, recursosDe, horarioDe, esFestivo, motivoCierre, sinTildes,
} from './config.js';

export const ESTADOS_ACTIVOS = ['reservada', 'confirmada', 'atendida'];

const FRANJAS = {
  manana: [0, 14 * 60],
  mediodia: [12 * 60, 16 * 60],
  tarde: [14 * 60, 20 * 60],
  noche: [19 * 60, 24 * 60],
  temprano: [0, 11 * 60],
};

/** 'por la mañana' -> [0, 840]. Devuelve null si no reconoce la franja. */
export function franjaEnMinutos(franja) {
  if (!franja) return null;
  if (Array.isArray(franja) && franja.length === 2) return franja;
  const clave = sinTildes(franja).replace(/^(por |a |al )?(la |el )?/, '').trim();
  return FRANJAS[clave] ?? null;
}

/** Minutos que bloquea de verdad un servicio (lo suyo mas los margenes). */
export function minutosQueOcupa(config, servicio) {
  return servicio.duracionMinutos
    + servicio.margenDespuesMinutos
    + (config.reglas.margenEntreCitasMinutos ?? 0);
}

/** Citas activas de un recurso que pisan esa ventana. */
export function citasQueSolapan(db, { recursoId, desde, hasta, excluir = null }) {
  return db.filas(
    `SELECT * FROM citas
     WHERE recurso_id = $recursoId
       AND estado IN ('reservada','confirmada','atendida')
       AND inicio < $hasta AND fin > $desde
       AND ($excluir IS NULL OR id != $excluir)
     ORDER BY inicio`,
    { recursoId, desde, hasta, excluir },
  );
}

function cabeEnElRecurso(db, config, { recurso, inicio, minutos, excluir }) {
  const hasta = inicio + minutos * 60000;
  const ocupadas = citasQueSolapan(db, { recursoId: recurso.id, desde: inicio, hasta, excluir });
  return ocupadas.length < recurso.capacidad;
}

/** Tramos de trabajo (en minutos desde medianoche) de un recurso ese dia. */
export function tramosDe(config, recurso, clave) {
  if (esFestivo(config, clave)) return [];
  return horarioDe(config, recurso, diaSemana(config.negocio.zonaHoraria, clave));
}

function citasEseDia(db, recursoId, clave, zona) {
  const inicioDia = instanteDe(zona, clave, 0) ?? Date.parse(`${clave}T00:00:00Z`);
  const finDia = inicioDia + 36 * 3600000;
  return db.valor(
    `SELECT COUNT(*) FROM citas WHERE recurso_id = $recursoId
       AND estado IN ('reservada','confirmada','atendida')
       AND inicio >= $inicioDia AND inicio < $finDia`,
    { recursoId, inicioDia, finDia },
  ) ?? 0;
}

/**
 * Huecos libres de un dia concreto. Si dos personas pueden hacer el servicio a
 * la misma hora, se ofrece una sola vez y se reparte hacia quien tiene menos
 * trabajo ese dia; el resto queda en `alternativas` por si el cliente pide a
 * alguien en particular.
 */
export function huecosDelDia(db, config, {
  servicioId, clave, recursoId = null, franja = null, ahora = Date.now(), limite = Infinity,
}) {
  const servicio = servicioPorId(config, servicioId);
  if (!servicio) return [];
  const zona = config.negocio.zonaHoraria;
  const paso = config.reglas.granularidadMinutos;
  const minutos = minutosQueOcupa(config, servicio);
  const noAntesDe = ahora + (config.reglas.antelacionMinimaHoras ?? 0) * 3600000;
  const ventana = franjaEnMinutos(franja);

  let candidatos = recursosDe(config, servicio);
  if (recursoId) candidatos = candidatos.filter((r) => r.id === recursoId);
  if (candidatos.length === 0) return [];

  const carga = new Map(candidatos.map((r) => [r.id, citasEseDia(db, r.id, clave, zona)]));
  const porMinuto = new Map();

  for (const recurso of candidatos) {
    for (const [desde, hasta] of tramosDe(config, recurso, clave)) {
      for (let m = desde; m + servicio.duracionMinutos <= hasta; m += paso) {
        if (ventana && (m < ventana[0] || m >= ventana[1])) continue;
        const inicio = instanteDe(zona, clave, m);
        if (inicio === null) continue;          // esa hora no existe (cambio de hora)
        if (inicio < noAntesDe) continue;
        if (!cabeEnElRecurso(db, config, { recurso, inicio, minutos, excluir: null })) continue;
        if (!porMinuto.has(m)) porMinuto.set(m, { inicio, recursos: [] });
        porMinuto.get(m).recursos.push(recurso);
      }
    }
  }

  return [...porMinuto.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, limite === Infinity ? undefined : limite)
    .map(([minuto, { inicio, recursos }]) => {
      const ordenados = [...recursos].sort((a, b) => (carga.get(a.id) - carga.get(b.id)) || a.id.localeCompare(b.id));
      const elegido = ordenados[0];
      return {
        dia: clave,
        minuto,
        hora: horaDeMinutos(minuto),
        inicio,
        fin: inicio + servicio.duracionMinutos * 60000,
        servicioId: servicio.id,
        servicioNombre: servicio.nombre,
        recursoId: elegido.id,
        recursoNombre: elegido.nombre,
        alternativas: ordenados.slice(1).map((r) => ({ id: r.id, nombre: r.nombre })),
      };
    });
}

/**
 * Busca huecos a partir de un dia, saltando los dias cerrados, hasta reunir
 * los que hagan falta o agotar la antelacion maxima.
 */
export function buscarHuecos(db, config, {
  servicioId, desde = null, dias = 14, franja = null, recursoId = null,
  limite = config.reglas.huecosQueOfrece ?? 4, ahora = Date.now(),
} = {}) {
  const zona = config.negocio.zonaHoraria;
  const servicio = servicioPorId(config, servicioId);
  if (!servicio) return { servicio: null, huecos: [], error: 'servicio-desconocido' };

  const hoy = claveDia(zona, ahora);
  let clave = desde ?? hoy;
  if (clave < hoy) clave = hoy;
  const tope = Math.min(dias, config.reglas.antelacionMaximaDias ?? 60);

  const huecos = [];
  const diasCerrados = [];
  for (let i = 0; i < tope && huecos.length < limite; i += 1) {
    const dia = i === 0 ? clave : sumarDias(clave, i);
    if (diasEntre(hoy, dia) > (config.reglas.antelacionMaximaDias ?? 60)) break;
    const delDia = huecosDelDia(db, config, {
      servicioId, clave: dia, recursoId, franja, ahora, limite: limite - huecos.length,
    });
    if (delDia.length === 0 && esFestivo(config, dia)) diasCerrados.push({ dia, motivo: motivoCierre(config, dia) });
    huecos.push(...delDia);
  }
  return { servicio, huecos, diasCerrados };
}

/**
 * Responde si una hora concreta esta libre. Si no lo esta, dice por que y
 * propone lo mas parecido, que es lo que necesita el bot para no dejar al
 * cliente en un callejon sin salida.
 */
export function comprobarHora(db, config, {
  servicioId, inicio, recursoId = null, ahora = Date.now(), excluir = null,
}) {
  const servicio = servicioPorId(config, servicioId);
  if (!servicio) return { libre: false, motivo: 'servicio-desconocido', alternativas: [] };
  const zona = config.negocio.zonaHoraria;
  const clave = claveDia(zona, inicio);
  const minuto = Math.round((inicio - (instanteDe(zona, clave, 0) ?? inicio)) / 60000);

  const alternativas = () => buscarHuecos(db, config, {
    servicioId, desde: clave, recursoId, ahora, limite: config.reglas.huecosQueOfrece ?? 4,
  }).huecos;

  if (inicio < ahora) return { libre: false, motivo: 'ya-paso', alternativas: alternativas() };
  if (inicio < ahora + (config.reglas.antelacionMinimaHoras ?? 0) * 3600000) {
    return { libre: false, motivo: 'demasiado-justo', alternativas: alternativas() };
  }
  if (diasEntre(claveDia(zona, ahora), clave) > (config.reglas.antelacionMaximaDias ?? 60)) {
    return { libre: false, motivo: 'demasiado-lejos', alternativas: [] };
  }
  if (esFestivo(config, clave)) {
    return { libre: false, motivo: 'cerrado', detalle: motivoCierre(config, clave), alternativas: alternativas() };
  }

  let candidatos = recursosDe(config, servicio);
  if (recursoId) {
    candidatos = candidatos.filter((r) => r.id === recursoId);
    if (candidatos.length === 0) return { libre: false, motivo: 'recurso-no-hace-servicio', alternativas: alternativas() };
  }

  const minutos = minutosQueOcupa(config, servicio);
  const dentroDeHorario = [];
  for (const recurso of candidatos) {
    const cabe = tramosDe(config, recurso, clave)
      .some(([desde, hasta]) => minuto >= desde && minuto + servicio.duracionMinutos <= hasta);
    if (cabe) dentroDeHorario.push(recurso);
  }
  if (dentroDeHorario.length === 0) {
    return { libre: false, motivo: 'fuera-de-horario', alternativas: alternativas() };
  }

  const libres = dentroDeHorario
    .filter((recurso) => cabeEnElRecurso(db, config, { recurso, inicio, minutos, excluir }));
  if (libres.length === 0) {
    return { libre: false, motivo: 'ocupado', alternativas: alternativas() };
  }

  const carga = new Map(libres.map((r) => [r.id, citasEseDia(db, r.id, clave, zona)]));
  const elegido = [...libres].sort((a, b) => (carga.get(a.id) - carga.get(b.id)) || a.id.localeCompare(b.id))[0];
  return {
    libre: true,
    motivo: null,
    hueco: {
      dia: clave,
      minuto,
      hora: hora(zona, inicio),
      inicio,
      fin: inicio + servicio.duracionMinutos * 60000,
      servicioId: servicio.id,
      servicioNombre: servicio.nombre,
      recursoId: elegido.id,
      recursoNombre: elegido.nombre,
      alternativas: libres.filter((r) => r.id !== elegido.id).map((r) => ({ id: r.id, nombre: r.nombre })),
    },
    alternativas: [],
  };
}

/** Lo que hay que ver de un dia: quien trabaja, que tiene y cuanto suma. */
export function resumenDia(db, config, clave, { ahora = Date.now() } = {}) {
  const zona = config.negocio.zonaHoraria;
  const inicioDia = instanteDe(zona, clave, 0) ?? Date.parse(`${clave}T00:00:00Z`);
  const finDia = (instanteDe(zona, sumarDias(clave, 1), 0) ?? inicioDia + 86400000);
  const citas = db.filas(
    `SELECT c.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono
     FROM citas c JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.inicio >= $inicioDia AND c.inicio < $finDia
     ORDER BY c.inicio`,
    { inicioDia, finDia },
  );
  const activas = citas.filter((c) => ESTADOS_ACTIVOS.includes(c.estado));
  return {
    dia: clave,
    abierto: !esFestivo(config, clave),
    motivoCierre: motivoCierre(config, clave),
    citas,
    recursos: config.recursos.filter((r) => r.activo).map((recurso) => ({
      id: recurso.id,
      nombre: recurso.nombre,
      tramos: tramosDe(config, recurso, clave).map(([d, h]) => [horaDeMinutos(d), horaDeMinutos(h)]),
      citas: citas.filter((c) => c.recurso_id === recurso.id),
    })),
    total: activas.length,
    ingresosCentimos: citas
      .filter((c) => c.estado === 'atendida')
      .reduce((suma, c) => suma + (c.precio_centimos ?? 0), 0),
    previstoCentimos: activas.reduce((suma, c) => suma + (c.precio_centimos ?? 0), 0),
    ahora,
  };
}
