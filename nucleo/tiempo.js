// ---------------------------------------------------------------------------
// Tiempo: todo el sistema guarda instantes en milisegundos UTC y solo se pasa
// a hora local (la del negocio) para hablar con personas. Aqui vive esa
// traduccion, incluido el fin de semana en que cambia la hora.
// ---------------------------------------------------------------------------

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DIAS_BONITOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const cacheFormato = new Map();

function formateador(zona) {
  let f = cacheFormato.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    cacheFormato.set(zona, f);
  }
  return f;
}

/** Descompone un instante en la hora de pared del negocio. */
export function partesLocales(zona, ms) {
  const p = {};
  for (const parte of formateador(zona).formatToParts(new Date(ms))) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  }
  const partes = {
    anio: p.year,
    mes: p.month,
    dia: p.day,
    hora: p.hour === 24 ? 0 : p.hour,
    minuto: p.minute,
    segundo: p.second,
  };
  partes.diaSemana = new Date(Date.UTC(partes.anio, partes.mes - 1, partes.dia)).getUTCDay();
  return partes;
}

/** Diferencia entre la hora local y UTC, en milisegundos, para ese instante. */
export function desfase(zona, ms) {
  const p = partesLocales(zona, ms);
  const comoSiFueraUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoSiFueraUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Pasa una hora de pared local a instante UTC.
 * Devuelve null si esa hora no existe (la madrugada que se adelanta el reloj).
 */
export function aUtc(zona, { anio, mes, dia, hora = 0, minuto = 0 }) {
  const objetivo = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const encaja = (ms) => {
    const vuelta = partesLocales(zona, ms);
    return vuelta.anio === anio && vuelta.mes === mes && vuelta.dia === dia
      && vuelta.hora === hora && vuelta.minuto === minuto;
  };
  // Se prueban los dos desfases posibles alrededor de ese dia: en el fin de
  // semana del cambio de hora conviven los dos. Si la hora existe dos veces
  // (la madrugada en que se atrasa el reloj), nos quedamos con la primera,
  // que es lo que entiende cualquiera; si no existe ninguna, devolvemos null.
  const candidatos = new Set([
    objetivo - desfase(zona, objetivo),
    objetivo - desfase(zona, objetivo - 86400000),
    objetivo - desfase(zona, objetivo + 86400000),
  ]);
  const validos = [...candidatos].filter(encaja);
  return validos.length ? Math.min(...validos) : null;
}

/** 'YYYY-MM-DD' del dia local al que pertenece ese instante. */
export function claveDia(zona, ms) {
  const p = partesLocales(zona, ms);
  return `${p.anio}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/** Instante UTC de una hora concreta de un dia dado ('YYYY-MM-DD', minutos). */
export function instanteDe(zona, clave, minutosDelDia) {
  const [anio, mes, dia] = clave.split('-').map(Number);
  return aUtc(zona, { anio, mes, dia, hora: Math.floor(minutosDelDia / 60), minuto: minutosDelDia % 60 });
}

/** Nombre interno del dia de la semana ('lunes', 'miercoles'...). */
export function diaSemana(zona, msOClave) {
  const clave = typeof msOClave === 'string' ? msOClave : claveDia(zona, msOClave);
  const [anio, mes, dia] = clave.split('-').map(Number);
  return DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
}

/** Suma dias a una clave 'YYYY-MM-DD' sin tocar horas: solo calendario. */
export function sumarDias(clave, dias) {
  const [anio, mes, dia] = clave.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Dias de calendario entre dos claves (b - a). */
export function diasEntre(claveA, claveB) {
  const [a1, a2, a3] = claveA.split('-').map(Number);
  const [b1, b2, b3] = claveB.split('-').map(Number);
  return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86400000);
}

/** '10:30' -> 630 minutos. Devuelve null si no es una hora. */
export function minutosDeHora(texto) {
  const m = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(String(texto).trim());
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = m[2] === undefined ? 0 : Number(m[2]);
  if (hora > 23 || minuto > 59) return null;
  return hora * 60 + minuto;
}

/** 630 -> '10:30'. */
export function horaDeMinutos(minutos) {
  const m = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutos desde medianoche local de ese instante. */
export function minutosDelDia(zona, ms) {
  const p = partesLocales(zona, ms);
  return p.hora * 60 + p.minuto;
}

export function hora(zona, ms) {
  const p = partesLocales(zona, ms);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}

/** 'lunes 24 de agosto' (sin el año, que en una cita cercana sobra). */
export function fechaLarga(zona, ms, { conAnio = false } = {}) {
  const p = partesLocales(zona, ms);
  const dia = DIAS_BONITOS[p.diaSemana];
  const base = `${dia} ${p.dia} de ${MESES[p.mes - 1]}`;
  return conAnio ? `${base} de ${p.anio}` : base;
}

/** 'lunes 24 de agosto a las 10:30'. */
export function fechaYHora(zona, ms, opciones) {
  return `${fechaLarga(zona, ms, opciones)} a las ${hora(zona, ms)}`;
}

/** 'YYYY-MM-DD' -> 'lunes 24 de agosto'. */
export function fechaLargaDeClave(zona, clave, opciones) {
  const ms = instanteDe(zona, clave, 12 * 60);
  return fechaLarga(zona, ms ?? Date.parse(`${clave}T12:00:00Z`), opciones);
}

export function esClaveDia(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
    && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));
}

export const NOMBRES_DIAS = DIAS;
export const NOMBRES_MESES = MESES;
