// ---------------------------------------------------------------------------
// Entender castellano escrito por un cliente con prisa: "el lunes por la
// mañana", "a las 5 y media", "mechas", "anúlamela". Esto lo usan los dos
// cerebros: el de reglas para decidir, y el de Claude para traducir lo que el
// modelo dice a fechas de verdad.
// ---------------------------------------------------------------------------

import { sinTildes } from '../nucleo/config.js';
import {
  claveDia, sumarDias, diaSemana, NOMBRES_DIAS, NOMBRES_MESES, minutosDeHora, esClaveDia,
} from '../nucleo/tiempo.js';

export function limpiar(texto) {
  return sinTildes(String(texto ?? ''))
    .replace(/[¡!¿?,;"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Dias -------------------------------------------------------------------

const RELATIVOS = [
  [/\bpasado\s+manana\b/, 2],
  [/\bhoy\b/, 0],
  [/\besta\s+(manana|tarde|noche)\b/, 0],
  [/\bmanana\b/, 1],
];

/**
 * Devuelve 'YYYY-MM-DD' o null. `ahora` manda: "el lunes" es el lunes que
 * viene, no el que paso.
 */
export function resolverDia(texto, { zona = 'Europe/Madrid', ahora = Date.now() } = {}) {
  const bruto = limpiar(texto);
  const hoy = claveDia(zona, ahora);
  if (!bruto) return null;

  if (esClaveDia(bruto)) return bruto;

  // Una fecha 2026-08-25 metida en mitad de una frase.
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(bruto);
  if (iso && esClaveDia(iso[1])) return iso[1];

  // "el lunes por la mañana" habla del lunes, no de mañana: quitamos la franja
  // antes de buscar el dia.
  const t = bruto.replace(/\b(por|de|a)\s+la\s+(manana|tarde|noche|madrugada)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

  for (const [patron, dias] of RELATIVOS) {
    if (patron.test(t)) return sumarDias(hoy, dias);
  }

  // 24/08, 24-08-2026
  const numerica = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(t);
  if (numerica) {
    const dia = Number(numerica[1]);
    const mes = Number(numerica[2]);
    let anio = numerica[3] ? Number(numerica[3]) : Number(hoy.slice(0, 4));
    if (anio < 100) anio += 2000;
    const clave = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    if (esClaveDia(clave)) return clave < hoy && !numerica[3] ? `${anio + 1}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}` : clave;
  }

  // "el 24 de agosto", "el 24"
  const conMes = /\b(?:el\s+)?(?:dia\s+)?(\d{1,2})\s+de\s+([a-z]+)/.exec(t);
  if (conMes) {
    const mes = NOMBRES_MESES.findIndex((m) => sinTildes(m) === conMes[2]);
    if (mes >= 0) {
      const dia = Number(conMes[1]);
      const anio = Number(hoy.slice(0, 4));
      const clave = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (esClaveDia(clave)) return clave < hoy ? `${anio + 1}-${clave.slice(5)}` : clave;
    }
  }

  const soloDia = /\bel\s+(?:dia\s+)?(\d{1,2})\b(?!\s*[:.h]\d)/.exec(t);
  if (soloDia && !/\ba\s+las\b/.test(t.slice(0, soloDia.index))) {
    const dia = Number(soloDia[1]);
    if (dia >= 1 && dia <= 31) {
      const [anio, mes] = hoy.split('-').map(Number);
      const clave = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (esClaveDia(clave) && clave >= hoy) return clave;
      const siguiente = mes === 12 ? `${anio + 1}-01-${String(dia).padStart(2, '0')}` : `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (esClaveDia(siguiente)) return siguiente;
    }
  }

  // "el lunes", "el lunes que viene"
  for (const nombre of NOMBRES_DIAS) {
    const patron = new RegExp(`\\b${nombre}\\b`);
    if (!patron.test(t)) continue;
    const proxima = /\b(que\s+viene|proximo|proxima|siguiente)\b/.test(t);
    const hoyDia = NOMBRES_DIAS.indexOf(diaSemana(zona, hoy));
    const objetivo = NOMBRES_DIAS.indexOf(nombre);
    let salto = (objetivo - hoyDia + 7) % 7;
    if (salto === 0) salto = 7;            // "el lunes" dicho un lunes = el que viene
    if (proxima && salto < 7) salto += 0;  // ya es el proximo
    return sumarDias(hoy, salto);
  }

  if (/\bsemana\s+que\s+viene\b/.test(t)) return sumarDias(hoy, 7);
  return null;
}

// --- Horas ------------------------------------------------------------------

const NUMEROS = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

/** Minutos desde medianoche, o null. Entiende "y media", "menos cuarto". */
export function resolverHora(texto) {
  const t = limpiar(texto);

  const conMinutos = /\b(?:a\s+la[s]?\s+)?(\d{1,2})[:.h](\d{2})\b/.exec(t);
  if (conMinutos) {
    const m = minutosDeHora(`${conMinutos[1]}:${conMinutos[2]}`);
    if (m !== null) return ajustarPorTarde(m, t);
  }

  const enLetra = new RegExp(`\\ba\\s+la[s]?\\s+(${Object.keys(NUMEROS).join('|')})\\b`).exec(t);
  const enCifra = /\ba\s+la[s]?\s+(\d{1,2})\b/.exec(t);
  let horas = null;
  if (enCifra) horas = Number(enCifra[1]);
  else if (enLetra) horas = NUMEROS[enLetra[1]];
  if (horas === null || horas > 23) return null;

  let minutos = horas * 60;
  if (/\by\s+media\b/.test(t)) minutos += 30;
  else if (/\by\s+cuarto\b/.test(t)) minutos += 15;
  else if (/\bmenos\s+cuarto\b/.test(t)) minutos -= 15;
  return ajustarPorTarde(minutos, t);
}

function ajustarPorTarde(minutos, t) {
  const esTarde = /\b(tarde|noche|pm)\b/.test(t);
  const esManana = /\b(manana|madrugada|am)\b/.test(t);
  if (esTarde && minutos < 12 * 60) return minutos + 12 * 60;
  if (esManana && minutos >= 12 * 60) return minutos - 12 * 60;
  return minutos;
}

/** "10:30" es una hora dicha entera; "a las 5", no. */
export function horaEsExplicita(texto) {
  return /\d{1,2}[:.h][0-5]\d/.test(String(texto ?? ''));
}

/**
 * Cuando alguien dice "a las 5" y el negocio no abre a las 5 de la manana,
 * quiere decir las 17:00. Se decide mirando el horario de verdad. Si ha
 * escrito la hora entera ("04:00"), se respeta tal cual: el que la ha escrito
 * asi sabe lo que dice.
 */
export function desambiguarConHorario(config, minutos, clave, { explicita = false } = {}) {
  if (minutos === null || explicita || minutos >= 12 * 60) return minutos;
  const dia = diaSemana(config.negocio.zonaHoraria, clave ?? claveDia(config.negocio.zonaHoraria, Date.now()));
  const tramos = config.horario[dia] ?? [];
  const cabe = (m) => tramos.some(([d, h]) => m >= d && m < h);
  if (cabe(minutos)) return minutos;
  if (cabe(minutos + 12 * 60)) return minutos + 12 * 60;
  return minutos;
}

export function resolverFranja(texto) {
  const t = limpiar(texto);
  if (/\b(por|a|de)\s+la\s+manana\b/.test(t) || /\bpor\s+la\s+manana\b/.test(t)) return 'manana';
  if (/\bmediodia\b/.test(t)) return 'mediodia';
  if (/\b(por|a|de)\s+la\s+tarde\b/.test(t)) return 'tarde';
  if (/\b(por|a|de)\s+la\s+noche\b/.test(t)) return 'noche';
  if (/\btemprano\b|\bprimera\s+hora\b/.test(t)) return 'temprano';
  if (/\bultima\s+hora\b/.test(t)) return 'noche';
  return null;
}

// --- Servicios --------------------------------------------------------------

function raiz(palabra) {
  return palabra.replace(/(es|s)$/, '');
}

/** Busca el servicio del que habla el cliente. Devuelve null si no lo ve claro. */
export function resolverServicio(config, texto) {
  const t = limpiar(texto);
  if (!t) return null;
  const palabras = t.split(' ').map(raiz).filter((p) => p.length > 2);
  let mejor = null;
  let mejorPuntos = 0;

  for (const servicio of config.servicios.filter((s) => s.activo)) {
    const etiquetas = [servicio.nombre, servicio.id.replace(/-/g, ' '), ...servicio.alias];
    let puntos = 0;
    for (const etiqueta of etiquetas) {
      const limpia = limpiar(etiqueta);
      if (!limpia) continue;
      if (t.includes(limpia)) puntos = Math.max(puntos, 10 + limpia.length);
      const trozos = limpia.split(' ').map(raiz).filter((p) => p.length > 2);
      const comunes = trozos.filter((p) => palabras.includes(p)).length;
      if (comunes) puntos = Math.max(puntos, comunes * 4 + (comunes === trozos.length ? 2 : 0));
    }
    if (puntos > mejorPuntos) { mejorPuntos = puntos; mejor = servicio; }
  }
  return mejorPuntos >= 4 ? mejor : null;
}

const ESCAPAR = /[.*+?^${}()|[\]\\]/g;

export function resolverRecurso(config, texto) {
  const t = limpiar(texto);
  if (!t) return null;
  // Por palabras enteras: si no, "mañana" contiene "ana" y acabas asignando
  // la cita a quien no era.
  for (const recurso of config.recursos.filter((r) => r.activo)) {
    const nombre = limpiar(recurso.nombre).replace(ESCAPAR, '\\$&');
    if (!nombre) continue;
    if (new RegExp(`\\b${nombre}\\b`).test(t)) return recurso;
    const pila = nombre.split(' ').filter((p) => p.length > 2);
    if (pila.length > 1 && pila.some((p) => new RegExp(`\\b${p}\\b`).test(t))) return recurso;
  }
  return null;
}

// --- Intencion --------------------------------------------------------------

const PATRONES = [
  ['escalar', /\b(queja|quejar|reclamacion|reclamar|abogado|denuncia|estafa|hablar con (una persona|alguien|el encargado|un humano)|responsable|devolucion|devolver el dinero)\b/],
  ['anular', /\b(anul\w*|cancel\w*|quitar la cita|no voy a poder|no podre ir|borra la cita)\b/],
  ['mover', /\b(cambi\w*|mover\w*|muev\w*|aplaz\w*|adelant\w*|retras\w*|pospon\w*|otro dia|otra hora)\b/],
  ['consultar', /\b(cuando tengo|que dia tengo|mi cita|mis citas|tengo cita|a que hora tengo|confirmame la hora)\b/],
  ['precio', /\b(cuanto cuesta|cuanto vale|precio|precios|tarifa|cuanto es)\b/],
  ['horario', /\b(que horario|horario|a que hora abris|abris|cerrais|abierto|cerrado|festivo)\b/],
  ['direccion', /\b(donde estais|direccion|como llego|donde os encuentro|ubicacion)\b/],
  ['servicios', /\b(que haceis|que servicios|que ofreceis|teneis .*(servicio|tratamiento))\b/],
  ['reservar', /\b(cita|reserva|reservar|pedir hora|coger hora|quiero|querria|me gustaria|necesito|puedo ir|hueco|disponible|disponibilidad|hay sitio|para cuando)\b/],
  ['saludo', /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal)\b/],
  ['gracias', /\b(gracias|muchas gracias|genial|perfecto|de acuerdo)\b/],
];

/**
 * Quita del texto el nombre del servicio antes de mirar que quiere el
 * cliente. Hace falta de verdad: en un taller, "cambio de aceite" lleva la
 * palabra "cambio" dentro, y sin esto "quiero un cambio de aceite" se
 * entiende como "quiero cambiar mi cita".
 */
function sinElNombreDelServicio(t, config) {
  const servicio = resolverServicio(config, t);
  if (!servicio) return t;
  let limpio = t;
  for (const etiqueta of [servicio.nombre, ...servicio.alias, servicio.id.replace(/-/g, ' ')]) {
    const limpia = limpiar(etiqueta);
    if (limpia.length > 2) limpio = limpio.split(limpia).join(' ');
  }
  return limpio.replace(/\s+/g, ' ').trim();
}

export function detectarIntencion(texto, config = null) {
  const bruto = limpiar(texto);
  if (!bruto) return 'vacio';
  if (esAfirmacion(bruto)) return 'confirmar';
  if (esNegacion(bruto)) return 'rechazar';
  const t = config ? sinElNombreDelServicio(bruto, config) : bruto;
  for (const [nombre, patron] of PATRONES) {
    if (patron.test(t)) return nombre;
  }
  // Si al quitar el servicio no queda nada que interpretar, es que pedia cita.
  if (config && t !== bruto && resolverServicio(config, texto)) return 'reservar';
  return 'otro';
}

export function esAfirmacion(texto) {
  const t = limpiar(texto);
  // "no me la confirmes" lleva la palabra confirmar dentro y no es un sí.
  if (/^(no|nop|mejor no|que va|ninguna|ninguno)\b/.test(t)) return false;
  return /^(si|sii+|s|vale|ok|okey|okay|de acuerdo|confirm\w*|si confirmo|perfecto|genial|estupendo|adelante|dale|venga|eso es|correcto|me vale|si por favor|si gracias|si porfa)\b/.test(t)
    || /\b(confirm\w*|reserv(ala|amela|ame)|me la quedo|apuntamela|apuntame)\b/.test(t);
}

export function esNegacion(texto) {
  const t = limpiar(texto);
  return /^(no|nop|no gracias|mejor no|ninguna|ninguno|no me viene bien|no puedo|que va)\b/.test(t);
}

/** "soy Rocío", "me llamo Rocío Díaz", "Rocío" a secas cuando se le pregunta. */
export function extraerNombre(texto, { esperandoNombre = false } = {}) {
  const bruto = String(texto ?? '').trim();
  const patron = /(?:me\s+llamo|soy|mi\s+nombre\s+es|de\s+parte\s+de)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,2})/i.exec(bruto);
  if (patron) return limpiarNombre(patron[1]);
  if (esperandoNombre) {
    const palabras = bruto.replace(/[.,;!¡?¿]/g, '').split(/\s+/).filter(Boolean);
    if (palabras.length >= 1 && palabras.length <= 3 && palabras.every((p) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]{2,}$/.test(p))) {
      return limpiarNombre(palabras.join(' '));
    }
  }
  return null;
}

function limpiarNombre(nombre) {
  return nombre.trim().split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 60);
}

export function extraerTelefono(texto) {
  const m = /(\+?\d[\d\s.-]{7,15}\d)/.exec(String(texto ?? ''));
  return m ? m[1] : null;
}

/** Cuando ofrecemos horas y el cliente responde "la de las 10:30" o "la primera". */
export function elegirDeLaLista(texto, huecos) {
  if (!huecos?.length) return null;
  const t = limpiar(texto);
  const ordinales = [
    [/\b(la\s+)?primera\b|\bla\s+1\b|\bla\s+de\s+antes\b/, 0],
    [/\b(la\s+)?segunda\b|\bla\s+2\b/, 1],
    [/\b(la\s+)?tercera\b|\bla\s+3\b/, 2],
    [/\b(la\s+)?cuarta\b|\bla\s+4\b/, 3],
    [/\b(la\s+)?ultima\b/, huecos.length - 1],
  ];
  for (const [patron, indice] of ordinales) {
    if (patron.test(t) && huecos[indice]) return huecos[indice];
  }
  const minutos = resolverHora(t);
  if (minutos !== null) {
    const exacta = huecos.find((h) => h.minuto === minutos);
    if (exacta) return exacta;
    const conAjuste = huecos.find((h) => h.minuto === minutos + 12 * 60);
    if (conAjuste) return conAjuste;
  }
  return null;
}
