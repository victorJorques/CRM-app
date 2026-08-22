// ---------------------------------------------------------------------------
// La configuracion es el unico sitio donde vive "que negocio es este". El
// resto del sistema no sabe si vende cortes de pelo, revisiones o clases:
// solo conoce servicios, recursos y horarios.
// ---------------------------------------------------------------------------

import { NOMBRES_DIAS, minutosDeHora, horaDeMinutos, esClaveDia } from './tiempo.js';

const VOCABULARIO_BASE = {
  cita: 'cita', citas: 'citas', laCita: 'la cita',
  recurso: 'profesional', recursos: 'profesionales', conRecurso: 'con',
  cliente: 'cliente', clientes: 'clientes',
  servicio: 'servicio', servicios: 'servicios',
  reservar: 'reservar', atendida: 'atendida',
};

const REGLAS_BASE = {
  granularidadMinutos: 15,
  margenEntreCitasMinutos: 0,
  antelacionMinimaHoras: 2,
  antelacionMaximaDias: 60,
  cancelacionMinimaHoras: 24,
  huecosQueOfrece: 4,
  permiteElegirRecurso: true,
};

const RECORDATORIOS_BASE = {
  vispera: true,
  visperaHora: '18:00',
  seguimientoInactivosDias: 0,
  avisoNoVino: true,
};

const ESCALADO_BASE = {
  palabras: [
    'queja', 'quejar', 'reclamacion', 'reclamación', 'reclamar', 'abogado',
    'denuncia', 'denunciar', 'estafa', 'fatal', 'vergüenza', 'verguenza',
    'hablar con una persona', 'hablar con alguien', 'responsable', 'encargado',
    'devolución', 'devolucion', 'devolver el dinero',
  ],
  aviso: 'Aviso a alguien del equipo y te contesta en cuanto pueda.',
};

function sinTildes(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function aClave(texto) {
  return sinTildes(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

class ErroresConfig extends Error {
  constructor(errores) {
    super(`La configuración tiene ${errores.length} problema${errores.length === 1 ? '' : 's'}.`);
    this.name = 'ErroresConfig';
    this.errores = errores;
  }
}

function normalizarTramos(valor, errores, donde) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) {
    errores.push(`${donde}: tiene que ser una lista de tramos, por ejemplo [["09:00","14:00"]].`);
    return [];
  }
  const tramos = [];
  for (const tramo of valor) {
    if (!Array.isArray(tramo) || tramo.length !== 2) {
      errores.push(`${donde}: cada tramo son dos horas, por ejemplo ["16:00","20:00"].`);
      continue;
    }
    const desde = minutosDeHora(tramo[0]);
    const hasta = minutosDeHora(tramo[1]);
    if (desde === null || hasta === null) {
      errores.push(`${donde}: "${tramo[0]}" a "${tramo[1]}" no son horas válidas (formato 09:00).`);
      continue;
    }
    if (hasta <= desde) {
      errores.push(`${donde}: el tramo ${tramo[0]}-${tramo[1]} termina antes de empezar.`);
      continue;
    }
    tramos.push([desde, hasta]);
  }
  tramos.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < tramos.length; i += 1) {
    if (tramos[i][0] < tramos[i - 1][1]) {
      errores.push(`${donde}: hay dos tramos que se pisan (${horaDeMinutos(tramos[i - 1][0])}-${horaDeMinutos(tramos[i - 1][1])} y ${horaDeMinutos(tramos[i][0])}-${horaDeMinutos(tramos[i][1])}).`);
    }
  }
  return tramos;
}

function normalizarHorario(valor, errores, donde) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    errores.push(`${donde}: tiene que ser un objeto con un día por línea.`);
    return null;
  }
  const horario = {};
  for (const dia of NOMBRES_DIAS) horario[dia] = [];
  for (const [clave, tramos] of Object.entries(valor)) {
    const dia = sinTildes(clave);
    if (!NOMBRES_DIAS.includes(dia)) {
      errores.push(`${donde}: "${clave}" no es un día de la semana.`);
      continue;
    }
    horario[dia] = normalizarTramos(tramos, errores, `${donde} → ${dia}`);
  }
  return horario;
}

function normalizarServicio(bruto, indice, errores) {
  const donde = `servicio ${indice + 1}${bruto?.nombre ? ` ("${bruto.nombre}")` : ''}`;
  if (typeof bruto !== 'object' || bruto === null) {
    errores.push(`${donde}: tiene que ser un objeto.`);
    return null;
  }
  const nombre = String(bruto.nombre ?? '').trim();
  if (!nombre) errores.push(`${donde}: le falta el nombre.`);
  const duracion = Number(bruto.duracionMinutos ?? bruto.duracion);
  if (!Number.isFinite(duracion) || duracion <= 0) {
    errores.push(`${donde}: "duracionMinutos" tiene que ser un número de minutos mayor que cero.`);
  }
  const precio = bruto.precio === undefined || bruto.precio === null ? null : Number(bruto.precio);
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
    errores.push(`${donde}: el precio "${bruto.precio}" no es un número.`);
  }
  const recursos = bruto.recursos === undefined || bruto.recursos === 'todos'
    ? null
    : (Array.isArray(bruto.recursos) ? bruto.recursos.map(aClave) : null);
  if (bruto.recursos !== undefined && bruto.recursos !== 'todos' && !Array.isArray(bruto.recursos)) {
    errores.push(`${donde}: "recursos" es una lista de identificadores, o "todos".`);
  }
  return {
    id: aClave(bruto.id ?? nombre),
    nombre,
    duracionMinutos: Math.round(duracion),
    margenDespuesMinutos: Math.max(0, Math.round(Number(bruto.margenDespuesMinutos ?? 0)) || 0),
    precio,
    recursos,
    alias: Array.isArray(bruto.alias) ? bruto.alias.map((a) => String(a)) : [],
    descripcion: bruto.descripcion ? String(bruto.descripcion) : '',
    activo: bruto.activo !== false,
  };
}

/** Periodos de días con motivo: cierres del negocio, vacaciones de alguien. */
function normalizarTramosDeDias(valor, errores, donde, motivoPorDefecto) {
  const periodos = [];
  for (const periodo of Array.isArray(valor) ? valor : []) {
    if (!esClaveDia(periodo?.desde) || !esClaveDia(periodo?.hasta)) {
      errores.push(`${donde}: cada uno necesita "desde" y "hasta" con formato 2026-08-01.`);
      continue;
    }
    if (periodo.hasta < periodo.desde) {
      errores.push(`${donde}: el que empieza el ${periodo.desde} termina antes, el ${periodo.hasta}.`);
      continue;
    }
    periodos.push({
      desde: periodo.desde,
      hasta: periodo.hasta,
      motivo: String(periodo.motivo ?? motivoPorDefecto),
    });
  }
  return periodos;
}

function normalizarRecurso(bruto, indice, errores) {
  const donde = `${'recurso'} ${indice + 1}${bruto?.nombre ? ` ("${bruto.nombre}")` : ''}`;
  if (typeof bruto !== 'object' || bruto === null) {
    errores.push(`${donde}: tiene que ser un objeto.`);
    return null;
  }
  const nombre = String(bruto.nombre ?? '').trim();
  if (!nombre) errores.push(`${donde}: le falta el nombre.`);
  const capacidad = Number(bruto.capacidad ?? 1);
  if (!Number.isInteger(capacidad) || capacidad < 1) {
    errores.push(`${donde}: "capacidad" tiene que ser un número entero de 1 en adelante.`);
  }
  return {
    id: aClave(bruto.id ?? nombre),
    nombre,
    capacidad: Number.isInteger(capacidad) && capacidad > 0 ? capacidad : 1,
    horario: normalizarHorario(bruto.horario, errores, `${donde} → horario`),
    // Vacaciones, bajas, cursos: días en los que esta persona (o esta silla)
    // no está, aunque el negocio abra.
    ausencias: normalizarTramosDeDias(bruto.ausencias, errores, `${donde} → ausencias`, 'no está'),
    activo: bruto.activo !== false,
  };
}

/**
 * Valida y normaliza una configuracion. No lanza: devuelve los problemas para
 * que quien llame decida si arranca a medias o se planta.
 */
export function revisarConfig(bruta) {
  const errores = [];
  const avisos = [];
  if (typeof bruta !== 'object' || bruta === null) {
    return { ok: false, errores: ['El fichero de configuración no es un objeto JSON.'], avisos, config: null };
  }

  const negocioBruto = bruta.negocio ?? {};
  const nombre = String(negocioBruto.nombre ?? '').trim();
  if (!nombre) errores.push('negocio → nombre: ponle el nombre del negocio, que es lo que dice el bot al presentarse.');

  const zona = String(negocioBruto.zonaHoraria ?? 'Europe/Madrid');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
  } catch {
    errores.push(`negocio → zonaHoraria: "${zona}" no existe. Usa por ejemplo "Europe/Madrid".`);
  }

  const horario = normalizarHorario(bruta.horario, errores, 'horario') ?? {};
  if (Object.values(horario).every((t) => t.length === 0)) {
    errores.push('horario: no hay ni un solo día abierto, así que nunca habría hueco para nadie.');
  }

  const serviciosBrutos = Array.isArray(bruta.servicios) ? bruta.servicios : [];
  if (serviciosBrutos.length === 0) errores.push('servicios: hace falta al menos uno, con nombre y duración.');
  const servicios = serviciosBrutos.map((s, i) => normalizarServicio(s, i, errores)).filter(Boolean);

  const recursosBrutos = Array.isArray(bruta.recursos) ? bruta.recursos : [];
  const recursos = recursosBrutos.map((r, i) => normalizarRecurso(r, i, errores)).filter(Boolean);
  if (recursos.length === 0) {
    recursos.push({ id: 'general', nombre: nombre || 'General', capacidad: 1, horario: null, ausencias: [], activo: true });
    avisos.push('No hay recursos declarados: se usa uno solo, con el horario del negocio.');
  }

  const idsRecursos = new Set(recursos.map((r) => r.id));
  for (const id of idsRecursos) {
    if (recursos.filter((r) => r.id === id).length > 1) {
      errores.push(`recursos: hay dos con el mismo identificador "${id}".`);
    }
  }
  for (const servicio of servicios) {
    if (servicios.filter((s) => s.id === servicio.id).length > 1) {
      errores.push(`servicios: hay dos con el mismo identificador "${servicio.id}".`);
    }
    if (servicio.recursos) {
      for (const id of servicio.recursos) {
        if (!idsRecursos.has(id)) {
          errores.push(`servicio "${servicio.nombre}": apunta a "${id}", que no está en la lista de recursos.`);
        }
      }
      if (servicio.recursos.length === 0) {
        errores.push(`servicio "${servicio.nombre}": no tiene a nadie que lo haga.`);
      }
    }
  }

  const festivos = Array.isArray(bruta.festivos) ? bruta.festivos.map(String) : [];
  for (const festivo of festivos) {
    if (!esClaveDia(festivo)) errores.push(`festivos: "${festivo}" no es una fecha con formato 2026-12-25.`);
  }

  const cierres = normalizarTramosDeDias(bruta.cierres, errores, 'cierres', 'cerrado');

  const reglas = { ...REGLAS_BASE, ...(bruta.reglas ?? {}) };
  if (!Number.isFinite(reglas.granularidadMinutos) || reglas.granularidadMinutos < 1) {
    errores.push('reglas → granularidadMinutos: en cuántos minutos van los huecos (5, 10, 15, 30...).');
  }
  if (reglas.antelacionMaximaDias < 1) {
    errores.push('reglas → antelacionMaximaDias: con menos de un día no se puede pedir cita.');
  }

  const config = {
    negocio: {
      nombre,
      tipo: String(negocioBruto.tipo ?? 'general'),
      zonaHoraria: zona,
      telefono: String(negocioBruto.telefono ?? ''),
      correo: String(negocioBruto.correo ?? ''),
      direccion: String(negocioBruto.direccion ?? ''),
      moneda: String(negocioBruto.moneda ?? 'EUR'),
      web: String(negocioBruto.web ?? ''),
    },
    vocabulario: { ...VOCABULARIO_BASE, ...(bruta.vocabulario ?? {}) },
    horario,
    festivos,
    cierres,
    reglas,
    servicios,
    recursos,
    recordatorios: { ...RECORDATORIOS_BASE, ...(bruta.recordatorios ?? {}) },
    escalado: {
      ...ESCALADO_BASE,
      ...(bruta.escalado ?? {}),
      palabras: [...ESCALADO_BASE.palabras, ...(bruta.escalado?.palabras ?? [])].map(sinTildes),
    },
    mensajes: {
      saludo: bruta.mensajes?.saludo ?? '',
      despedida: bruta.mensajes?.despedida ?? '',
      fueraDeHorario: bruta.mensajes?.fueraDeHorario ?? '',
    },
    modelo: {
      nombre: bruta.modelo?.nombre ?? 'claude-opus-5',
      maxTokens: Number(bruta.modelo?.maxTokens ?? 1024),
      temperatura: Number(bruta.modelo?.temperatura ?? 0.2),
    },
  };

  if (config.recordatorios.vispera && minutosDeHora(config.recordatorios.visperaHora) === null) {
    errores.push(`recordatorios → visperaHora: "${config.recordatorios.visperaHora}" no es una hora (formato 18:00).`);
  }
  if (servicios.length > 0 && servicios.every((s) => s.precio === null)) {
    avisos.push('Ningún servicio tiene precio: el bot no dirá cuánto cuesta.');
  }

  return { ok: errores.length === 0, errores, avisos, config: errores.length === 0 ? config : null };
}

// --- Consultas de conveniencia ---------------------------------------------

export function servicioPorId(config, id) {
  return config.servicios.find((s) => s.id === id) ?? null;
}

export function recursoPorId(config, id) {
  return config.recursos.find((r) => r.id === id) ?? null;
}

/** Recursos que pueden hacer ese servicio (todos, si el servicio no acota). */
export function recursosDe(config, servicio) {
  const activos = config.recursos.filter((r) => r.activo);
  if (!servicio?.recursos) return activos;
  return activos.filter((r) => servicio.recursos.includes(r.id));
}

/** Horario efectivo de un recurso en un dia: el suyo si lo tiene, si no el del negocio. */
export function horarioDe(config, recurso, dia) {
  const propio = recurso?.horario;
  if (propio) return propio[dia] ?? [];
  return config.horario[dia] ?? [];
}

export function esFestivo(config, clave) {
  if (config.festivos.includes(clave)) return true;
  return config.cierres.some((c) => clave >= c.desde && clave <= c.hasta);
}

/** ¿Está fuera ese día esta persona (o esta silla)? */
export function ausencia(recurso, clave) {
  return (recurso?.ausencias ?? []).find((a) => clave >= a.desde && clave <= a.hasta) ?? null;
}

export function motivoCierre(config, clave) {
  if (config.festivos.includes(clave)) return 'festivo';
  const cierre = config.cierres.find((c) => clave >= c.desde && clave <= c.hasta);
  return cierre ? cierre.motivo : null;
}

export { ErroresConfig, sinTildes };
