// ---------------------------------------------------------------------------
// El cerebro con modelo. Habla mejor, pero no tiene mas poder que el otro:
// las mismas herramientas, y las horas siguen saliendo del motor de agenda.
// Si la API falla o tarda, esto lanza y arriba se pasa al cerebro de reglas.
// ---------------------------------------------------------------------------

import { definiciones, ejecutar } from './herramientas.js';
import * as redaccion from '../nucleo/redaccion.js';
import { fechaLarga, hora as horaDe } from '../nucleo/tiempo.js';

const URL_API = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2023-06-01';
const VUELTAS_MAXIMAS = 6;
const ESPERA_MS = 25000;

export function hayClave() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function instrucciones(config, { ahora, cliente }) {
  const zona = config.negocio.zonaHoraria;
  const v = config.vocabulario;
  const lineas = [
    `Eres el conserje de ${config.negocio.nombre}. Coges ${v.citas} por escrito, como quien contesta el WhatsApp del negocio.`,
    '',
    `Hoy es ${fechaLarga(zona, ahora, { conAnio: true })} y son las ${horaDe(zona, ahora)}.`,
    `${v.servicios.charAt(0).toUpperCase()}${v.servicios.slice(1)}: ${redaccion.listaServicios(config).join('; ')}.`,
    `Horario: ${redaccion.horarioTexto(config).join('; ')}.`,
  ];
  if (config.negocio.direccion) lineas.push(`Dirección: ${config.negocio.direccion}.`);
  if (cliente?.nombre) lineas.push(`Estás hablando con ${cliente.nombre}.`);
  lineas.push(
    '',
    'Cómo trabajas:',
    `- Nunca digas una hora que no venga de buscar_huecos o comprobar_hora. No existe ningún hueco que no salga de ahí.`,
    `- Ofrece pocas horas, tres o cuatro, y deja que elija.`,
    `- Antes de reservar, repite ${v.servicio}, día, hora y precio, y espera a que confirme.`,
    `- Reserva solo con la herramienta reservar. Hasta que esa herramienta diga que sí, no hay ${v.cita}.`,
    `- Si la herramienta falla, di la verdad y ofrece lo que sí hay.`,
    '- Contesta corto, en castellano de tú, sin emojis y sin firmar. Dos o tres frases como mucho.',
    '- Ante una queja, una reclamación, un problema de salud serio o cualquier cosa rara, usa escalar y no sigas gestionando.',
    '- No hables de precios que no estén en la lista, ni prometas descuentos, ni des consejo profesional.',
    '',
    `Si dice que tiene ${v.cita} y no la encuentras:`,
    `- No le lleves la contraria ni le digas que no la tiene. Tú solo ves lo que hay a este teléfono o correo; puede estar a otro nombre, con otro número, o haberla pedido otra persona por él.`,
    `- Dile que a ti no te sale, que lo van a comprobar, y usa escalar para que lo mire alguien del equipo.`,
    `- Mientras tanto, ofrécele hueco si le sirve. Nunca des por hecho que se la ha inventado.`,
    '',
    'Al cambiar una hora:',
    `- Recuérdale la que tiene ahora antes de ofrecerle otras.`,
    `- Si pide "otro día", no le ofrezcas el mismo día que ya tiene, y desde luego no su misma hora.`,
    `- Cambia siempre con mover_cita. Anular y volver a reservar le hace perder el sitio.`,
  );
  if (config.mensajes.saludo) lineas.push(`- Si saludas primero, di: "${config.mensajes.saludo}".`);
  return lineas.join('\n');
}

async function llamar(cuerpo, { clave, senal }) {
  const respuesta = await fetch(URL_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': clave,
      'anthropic-version': VERSION_API,
    },
    body: JSON.stringify(cuerpo),
    signal: senal,
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    const error = new Error(`La API ha contestado ${respuesta.status}: ${detalle.slice(0, 300)}`);
    error.estado = respuesta.status;
    throw error;
  }
  return respuesta.json();
}

/** Convierte el historial de la bandeja en turnos para el modelo. */
export function historial(mensajes, { maximo = 20 } = {}) {
  const turnos = [];
  for (const mensaje of mensajes.slice(-maximo)) {
    if (mensaje.autor === 'sistema') continue;
    const papel = mensaje.direccion === 'entrante' ? 'user' : 'assistant';
    const anterior = turnos.at(-1);
    if (anterior && anterior.role === papel) {
      anterior.content += `\n${mensaje.texto}`;
    } else {
      turnos.push({ role: papel, content: mensaje.texto });
    }
  }
  while (turnos.length && turnos[0].role !== 'user') turnos.shift();
  return turnos;
}

export async function responder(texto, ctx) {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) throw new Error('No hay ANTHROPIC_API_KEY');
  const { config } = ctx;
  const ahora = ctx.ahora ?? Date.now();
  const acciones = [];
  const herramientas = definiciones(config);

  const mensajes = [...(ctx.historial ?? []), { role: 'user', content: texto }];
  const reloj = new AbortController();
  const alarma = setTimeout(() => reloj.abort(), ESPERA_MS);

  try {
    for (let vuelta = 0; vuelta < VUELTAS_MAXIMAS; vuelta += 1) {
      const respuesta = await llamar({
        model: config.modelo.nombre,
        max_tokens: config.modelo.maxTokens,
        temperature: config.modelo.temperatura,
        system: instrucciones(config, { ahora, cliente: ctx.cliente }),
        tools: herramientas,
        messages: mensajes,
      }, { clave, senal: reloj.signal });

      const bloques = respuesta.content ?? [];
      const usos = bloques.filter((b) => b.type === 'tool_use');
      const dicho = bloques.filter((b) => b.type === 'text').map((b) => b.text.trim()).filter(Boolean).join('\n');

      if (usos.length === 0) {
        return { texto: dicho, acciones, memoria: ctx.memoria ?? {}, cerebro: 'claude' };
      }

      mensajes.push({ role: 'assistant', content: bloques });
      const resultados = [];
      for (const uso of usos) {
        const resultado = ejecutar(uso.name, uso.input ?? {}, ctx);
        acciones.push({ herramienta: uso.name, entrada: uso.input, resultado });
        resultados.push({
          type: 'tool_result',
          tool_use_id: uso.id,
          is_error: resultado.ok === false,
          content: paraElModelo(resultado),
        });
      }
      mensajes.push({ role: 'user', content: resultados });
    }
    throw new Error('El modelo se ha quedado dando vueltas con las herramientas');
  } finally {
    clearTimeout(alarma);
  }
}

/** Lo que ve el modelo de cada herramienta: sin objetos internos. */
function paraElModelo(resultado) {
  const limpio = {};
  for (const [clave, valor] of Object.entries(resultado)) {
    if (clave.startsWith('_')) continue;
    limpio[clave] = valor;
  }
  return JSON.stringify(limpio);
}
