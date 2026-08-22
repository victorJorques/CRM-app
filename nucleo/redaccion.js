// ---------------------------------------------------------------------------
// Como habla Conserje. Todas las frases que ve un cliente salen de aqui, en
// castellano y con el vocabulario del negocio: donde una peluqueria dice
// "cita con Ana", una clinica dice "visita con la Dra. Gomez".
// ---------------------------------------------------------------------------

import { fechaLarga, fechaYHora, hora, fechaLargaDeClave, claveDia, sumarDias } from './tiempo.js';

export function enumerar(lista, union = 'y') {
  const partes = lista.filter(Boolean);
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} ${union} ${partes.at(-1)}`;
}

export function dinero(config, centimos) {
  if (centimos === null || centimos === undefined) return '';
  const valor = centimos / 100;
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace('.', ',');
  return config.negocio.moneda === 'EUR' ? `${texto} €` : `${texto} ${config.negocio.moneda}`;
}

export function precioServicio(config, servicio) {
  if (!servicio || servicio.precio === null) return '';
  if (Number(servicio.precio) === 0) return 'gratis';
  return dinero(config, Math.round(servicio.precio * 100));
}

/** 'hoy', 'mañana' o 'el lunes 24 de agosto', segun lo cerca que quede. */
export function cuandoRelativo(config, ms, ahora = Date.now()) {
  const zona = config.negocio.zonaHoraria;
  const dia = claveDia(zona, ms);
  const hoy = claveDia(zona, ahora);
  if (dia === hoy) return 'hoy';
  if (dia === sumarDias(hoy, 1)) return 'mañana';
  if (dia === sumarDias(hoy, 2)) return 'pasado mañana';
  return `el ${fechaLarga(zona, ms)}`;
}

export function listaServicios(config) {
  const zona = config.negocio.zonaHoraria;
  return config.servicios.filter((s) => s.activo).map((s) => {
    const precio = precioServicio(config, s);
    return `${s.nombre}${precio ? ` (${precio}` : ''}${precio ? `, ${s.duracionMinutos} min)` : ` (${s.duracionMinutos} min)`}`;
  });
}

export function horarioTexto(config) {
  const nombres = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo' };
  const lineas = [];
  for (const [dia, tramos] of Object.entries(config.horario)) {
    if (!tramos.length) continue;
    const horas = tramos.map(([d, h]) => `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')} a ${String(Math.floor(h / 60)).padStart(2, '0')}:${String(h % 60).padStart(2, '0')}`);
    lineas.push(`${nombres[dia]}: ${horas.join(' y ')}`);
  }
  return lineas;
}

/** "El lunes me quedan 10:00, 10:15 y 10:30. ¿Cuál prefieres?" */
export function ofertaDeHuecos(config, huecos, { ahora = Date.now() } = {}) {
  if (huecos.length === 0) return null;
  const zona = config.negocio.zonaHoraria;
  const porDia = new Map();
  for (const hueco of huecos) {
    if (!porDia.has(hueco.dia)) porDia.set(hueco.dia, []);
    porDia.get(hueco.dia).push(hueco);
  }
  const trozos = [...porDia.entries()].map(([dia, lista]) => {
    const cuando = cuandoRelativo(config, lista[0].inicio, ahora);
    const horas = enumerar(lista.map((h) => h.hora), 'y');
    return `${cuando === 'hoy' || cuando === 'mañana' || cuando === 'pasado mañana' ? cuando : cuando} ${lista.length === 1 ? 'a las' : 'tengo'} ${horas}`;
  });
  const cuerpo = trozos.length === 1
    ? `${trozos[0].charAt(0).toUpperCase()}${trozos[0].slice(1)}`
    : `${trozos.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('. ')}`;
  return `${cuerpo}. ¿Cuál te viene mejor?`;
}

/** "Perfecto: mechas el lunes 24 de agosto a las 10:30, 85 €. ¿Te la confirmo?" */
export function propuesta(config, { servicio, hueco, ahora = Date.now() }) {
  const zona = config.negocio.zonaHoraria;
  const precio = precioServicio(config, servicio);
  const cuando = `${cuandoRelativo(config, hueco.inicio, ahora)} a las ${hora(zona, hueco.inicio)}`;
  const con = config.recursos.filter((r) => r.activo).length > 1 ? ` con ${hueco.recursoNombre}` : '';
  return `Perfecto: ${servicio.nombre.toLowerCase()}${con} ${cuando}${precio ? `, ${precio}` : ''}. ¿Te ${config.vocabulario.laCita === 'la cita' ? 'la' : 'la'} confirmo?`;
}

/** "Hecho, Rocío: Mechas con Ana, lunes 24 de agosto a las 10:30." */
export function confirmacion(config, cita, { nombre = '', conRecordatorio = true } = {}) {
  const zona = config.negocio.zonaHoraria;
  const varios = config.recursos.filter((r) => r.activo).length > 1;
  const partes = [
    `Hecho${nombre ? `, ${nombre.split(' ')[0]}` : ''}: ${cita.servicio_nombre}${varios ? ` con ${cita.recurso_nombre}` : ''}, ${fechaYHora(zona, cita.inicio)}.`,
  ];
  if (conRecordatorio && config.recordatorios.vispera) {
    partes.push('Te mando un recordatorio el día de antes.');
  }
  return partes.join(' ');
}

export function cambioConfirmado(config, cita) {
  const zona = config.negocio.zonaHoraria;
  return `Cambiada: ${cita.servicio_nombre}, ${fechaYHora(zona, cita.inicio)}. ¿Te va bien así?`;
}

export function anulacionConfirmada(config, cita, { tarde = false, ahora = Date.now() } = {}) {
  const zona = config.negocio.zonaHoraria;
  const base = `Anulada ${config.vocabulario.laCita} de ${cita.servicio_nombre} ${cuandoRelativo(config, cita.inicio, ahora)} a las ${hora(zona, cita.inicio)}.`;
  if (tarde && config.reglas.cancelacionMinimaHoras) {
    return `${base} Te aviso de que avisamos con ${config.reglas.cancelacionMinimaHoras} h de margen, se lo comento al equipo. Cuando quieras otra, aquí estoy.`;
  }
  return `${base} Cuando quieras otra, aquí estoy.`;
}

export function sinHuecos(config, { servicio, dia = null }) {
  const donde = dia ? ` ${cuandoRelativoDeClave(config, dia)}` : '';
  return `No me queda nada libre${donde} para ${servicio.nombre.toLowerCase()}. ¿Miro otro día o te aviso si se libera algo?`;
}

function cuandoRelativoDeClave(config, clave) {
  const zona = config.negocio.zonaHoraria;
  const hoy = claveDia(zona, Date.now());
  if (clave === hoy) return 'hoy';
  if (clave === sumarDias(hoy, 1)) return 'mañana';
  return `el ${fechaLargaDeClave(zona, clave)}`;
}

export function saludo(config) {
  if (config.mensajes.saludo) return config.mensajes.saludo;
  return `Hola, soy el conserje de ${config.negocio.nombre}. ¿Qué necesitas?`;
}

export function escalado(config) {
  return config.escalado.aviso;
}

export function recordatorioVispera(config, cita) {
  const zona = config.negocio.zonaHoraria;
  const varios = config.recursos.filter((r) => r.activo).length > 1;
  return `Recordatorio de ${config.negocio.nombre}: ${cita.servicio_nombre}${varios ? ` con ${cita.recurso_nombre}` : ''} mañana a las ${hora(zona, cita.inicio)}. Si no te viene bien, dímelo y lo cambiamos.`;
}

export function mensajeNoVino(config, cita) {
  const zona = config.negocio.zonaHoraria;
  return `Te esperábamos hoy a las ${hora(zona, cita.inicio)} para ${cita.servicio_nombre.toLowerCase()} y no pudo ser. ¿Te busco otro hueco?`;
}

export function mensajeSeguimiento(config, cliente, { ultima = null } = {}) {
  const nombre = cliente.nombre ? `, ${cliente.nombre.split(' ')[0]}` : '';
  const desde = ultima ? ` Desde ${fechaLarga(config.negocio.zonaHoraria, ultima)} no te vemos.` : '';
  return `Hola${nombre}, soy ${config.negocio.nombre}.${desde} ¿Te busco hueco para estas semanas?`;
}

export function fichaResumen(config, ficha) {
  const partes = [];
  partes.push(ficha.nombre || 'Sin nombre');
  if (ficha.telefono) partes.push(ficha.telefono);
  partes.push(`${ficha.atendidas} ${ficha.atendidas === 1 ? 'visita' : 'visitas'}`);
  if (ficha.gastoCentimos) partes.push(`${dinero(config, ficha.gastoCentimos)} en total`);
  if (ficha.noVino) partes.push(`${ficha.noVino} ${ficha.noVino === 1 ? 'ausencia' : 'ausencias'}`);
  return partes.join(' · ');
}
