// ---------------------------------------------------------------------------
// La geometria del calendario de un dia: a que altura empieza cada cita,
// cuanto mide, y que carril ocupa cuando dos se pisan.
//
// Aqui no se pinta nada ni se sabe de zonas horarias: entran minutos desde
// medianoche y salen numeros. Asi la cuenta se puede comprobar con pruebas,
// que es donde se ven los fallos de verdad: una cita de las 12:30 pintada a
// las 12:00 nadie la nota mirando, y a alguien le cambia el dia.
// ---------------------------------------------------------------------------

/** '09:30' → 570. */
export function minutosDeHora(texto) {
  const [horas, minutos] = String(texto).split(':').map(Number);
  return (horas || 0) * 60 + (minutos || 0);
}

/** 570 → '09:30'. Las doce de la noche del final del día son las 24:00. */
export function horaDeMinutos(minutos) {
  const enteros = Math.round(minutos);
  return `${String(Math.floor(enteros / 60)).padStart(2, '0')}:${String(enteros % 60).padStart(2, '0')}`;
}

/** '2 h 15 min', que es como se dice un hueco en voz alta. */
export function duracionDicha(minutos) {
  const horas = Math.floor(minutos / 60);
  const sueltos = Math.round(minutos % 60);
  if (!horas) return `${sueltos} min`;
  return sueltos ? `${horas} h ${sueltos} min` : `${horas} h`;
}

/**
 * El trozo de día que hay que pintar: de la primera hora a la que alguien
 * abre a la última a la que cierra, con las citas dentro aunque alguna se
 * salga del horario. Redondeado a horas enteras, que es como se lee.
 */
export function rangoDelDia(columnas, { minimo = 4 * 60 } = {}) {
  let desde = Infinity;
  let hasta = -Infinity;
  for (const columna of columnas) {
    for (const [abre, cierra] of columna.tramos ?? []) {
      desde = Math.min(desde, abre);
      hasta = Math.max(hasta, cierra);
    }
    for (const bloque of columna.bloques ?? []) {
      desde = Math.min(desde, bloque.desde);
      hasta = Math.max(hasta, bloque.hasta);
    }
  }
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) return null;
  desde = Math.max(0, Math.floor(desde / 60) * 60);
  hasta = Math.min(24 * 60, Math.ceil(hasta / 60) * 60);
  // Un calendario de media hora no se lee: se le deja un alto mínimo.
  if (hasta - desde < minimo) hasta = Math.min(24 * 60, desde + minimo);
  if (hasta - desde < minimo) desde = Math.max(0, hasta - minimo);
  return { desde, hasta };
}

/**
 * Reparte en carriles las citas que se pisan, para que ninguna tape a otra.
 * Cada grupo de citas encadenadas se mide por su cuenta: que a las doce haya
 * tres a la vez no tiene por qué estrechar las de la tarde.
 */
export function enCarriles(bloques) {
  const orden = [...bloques].sort((a, b) => a.desde - b.desde || a.hasta - b.hasta);
  const puestos = [];
  let grupo = [];
  let finales = [];
  let finGrupo = -Infinity;

  const cerrarGrupo = () => {
    const anchura = grupo.reduce((max, bloque) => Math.max(max, bloque.carril + 1), 1);
    for (const bloque of grupo) bloque.carriles = anchura;
    puestos.push(...grupo);
    grupo = [];
    finales = [];
    finGrupo = -Infinity;
  };

  for (const bloque of orden) {
    if (grupo.length && bloque.desde >= finGrupo) cerrarGrupo();
    let carril = finales.findIndex((fin) => fin <= bloque.desde);
    if (carril === -1) {
      carril = finales.length;
      finales.push(bloque.hasta);
    } else {
      finales[carril] = bloque.hasta;
    }
    grupo.push({ ...bloque, carril });
    finGrupo = Math.max(finGrupo, bloque.hasta);
  }
  if (grupo.length) cerrarGrupo();
  return puestos;
}

/** Lo que dentro del calendario cae fuera del horario de esa persona. */
export function fueraDeHorario(tramos, rango) {
  const orden = [...tramos].sort((a, b) => a[0] - b[0]);
  const fuera = [];
  let cursor = rango.desde;
  for (const [abre, cierra] of orden) {
    if (cierra <= cursor) continue;
    if (abre > cursor) fuera.push([cursor, Math.min(abre, rango.hasta)]);
    cursor = Math.max(cursor, Math.min(cierra, rango.hasta));
  }
  if (cursor < rango.hasta) fuera.push([cursor, rango.hasta]);
  return fuera.filter(([abre, cierra]) => cierra > abre);
}

/** Las rayas de las horas en punto que lleva el calendario. */
export function lineasDeHoras(rango) {
  const lineas = [];
  for (let minutos = Math.ceil(rango.desde / 60) * 60; minutos <= rango.hasta; minutos += 60) {
    lineas.push({ minutos, etiqueta: horaDeMinutos(minutos), ...alturaDe(minutos, minutos, rango) });
  }
  return lineas;
}

/** Donde cae un tramo dentro del calendario, en tanto por ciento del alto. */
export function alturaDe(desde, hasta, rango) {
  const total = rango.hasta - rango.desde;
  const arriba = ((Math.max(desde, rango.desde) - rango.desde) / total) * 100;
  const abajo = ((Math.min(hasta, rango.hasta) - rango.desde) / total) * 100;
  return { arriba, alto: Math.max(0, abajo - arriba) };
}
