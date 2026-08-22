// ---------------------------------------------------------------------------
// Las herramientas. Es lo unico que puede hacer el bot, sea cual sea el
// cerebro que lleve dentro: no escribe en la base por su cuenta ni se inventa
// horas. Todo pasa por aqui, y aqui todo pasa por el motor de agenda.
// ---------------------------------------------------------------------------

import { servicioPorId, recursosDe } from '../nucleo/config.js';
import { buscarHuecos, comprobarHora, porQueNoHayHuecos } from '../nucleo/agenda.js';
import * as citas from '../nucleo/citas.js';
import * as clientes from '../nucleo/clientes.js';
import * as bandeja from '../nucleo/bandeja.js';
import * as redaccion from '../nucleo/redaccion.js';
import { instanteDe, fechaYHora } from '../nucleo/tiempo.js';
import {
  resolverDia, resolverHora, resolverServicio, resolverRecurso, desambiguarConHorario, horaEsExplicita,
} from './entender.js';

/** Lo que el modelo ve. Las descripciones son parte del comportamiento. */
export function definiciones(config) {
  const nombres = config.servicios.filter((s) => s.activo).map((s) => s.nombre);
  const recursos = config.recursos.filter((r) => r.activo).map((r) => r.nombre);
  const v = config.vocabulario;
  return [
    {
      name: 'buscar_huecos',
      description: `Devuelve las horas libres de verdad para un ${v.servicio}. Es la ÚNICA forma de saber qué hay libre: nunca digas una hora que no venga de aquí. Servicios: ${nombres.join(', ')}.`,
      input_schema: {
        type: 'object',
        properties: {
          servicio: { type: 'string', description: `Nombre del ${v.servicio}, tal cual lo diga el ${v.cliente}.` },
          dia: { type: 'string', description: "Día en formato 2026-08-24, o 'hoy', 'mañana', 'el lunes'. Si no lo dice, déjalo vacío y se buscan los próximos días." },
          franja: { type: 'string', enum: ['manana', 'mediodia', 'tarde', 'noche', 'temprano'], description: 'Parte del día, si la pide.' },
          recurso: { type: 'string', description: `${v.recurso} concreto si lo pide (${recursos.join(', ')}).` },
        },
        required: ['servicio'],
      },
    },
    {
      name: 'comprobar_hora',
      description: 'Comprueba si una hora concreta está libre. Úsala cuando el cliente propone una hora que no le has ofrecido tú.',
      input_schema: {
        type: 'object',
        properties: {
          servicio: { type: 'string' },
          dia: { type: 'string', description: 'Formato 2026-08-24 o expresión como "el lunes".' },
          hora: { type: 'string', description: 'Formato 10:30.' },
          recurso: { type: 'string' },
        },
        required: ['servicio', 'dia', 'hora'],
      },
    },
    {
      name: 'reservar',
      description: `Reserva de verdad ${v.laCita}. Solo después de que el ${v.cliente} haya confirmado día y hora. Si la hora ya no está libre, la reserva se rechaza y te devuelve alternativas.`,
      input_schema: {
        type: 'object',
        properties: {
          servicio: { type: 'string' },
          dia: { type: 'string' },
          hora: { type: 'string' },
          recurso: { type: 'string' },
          nombre: { type: 'string', description: `Nombre del ${v.cliente}, si lo ha dicho.` },
        },
        required: ['servicio', 'dia', 'hora'],
      },
    },
    {
      name: 'mis_citas',
      description: `Las próximas ${v.citas} de quien está escribiendo. Úsala antes de mover o anular nada.`,
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'mover_cita',
      description: `Cambia ${v.laCita} a otro día u hora. La hora nueva se comprueba igual que una reserva: si está cogida, te devuelve alternativas.`,
      input_schema: {
        type: 'object',
        properties: {
          dia: { type: 'string' },
          hora: { type: 'string' },
          cita_id: { type: 'string', description: 'Si tiene varias, el identificador que devuelve mis_citas.' },
        },
        required: ['dia', 'hora'],
      },
    },
    {
      name: 'anular_cita',
      description: `Anula ${v.laCita}. Mira antes con mis_citas cuál es; si tiene varias, pregúntale cuál antes de anular nada.`,
      input_schema: {
        type: 'object',
        properties: {
          cita_id: { type: 'string' },
          motivo: { type: 'string' },
        },
      },
    },
    {
      name: 'info_negocio',
      description: 'Datos del negocio: horario, dirección, teléfono, servicios y precios.',
      input_schema: {
        type: 'object',
        properties: {
          que: { type: 'string', enum: ['horario', 'direccion', 'telefono', 'servicios', 'precios', 'todo'] },
        },
        required: ['que'],
      },
    },
    {
      name: 'guardar_nombre',
      description: `Guarda el nombre del ${v.cliente} en su ficha cuando lo diga.`,
      input_schema: {
        type: 'object',
        properties: { nombre: { type: 'string' } },
        required: ['nombre'],
      },
    },
    {
      name: 'escalar',
      description: 'Apártate y avisa a una persona del equipo. Úsala ante una queja, una reclamación, algo delicado o cualquier cosa que no sepas resolver. Después de llamarla, no sigas gestionando nada.',
      input_schema: {
        type: 'object',
        properties: { motivo: { type: 'string' } },
        required: ['motivo'],
      },
    },
  ];
}

function fallo(motivo, resumen, extra = {}) {
  return { ok: false, motivo, resumen, ...extra };
}

function resolverInstante(config, { dia, hora }, ahora) {
  const zona = config.negocio.zonaHoraria;
  const clave = resolverDia(dia, { zona, ahora });
  if (!clave) return { error: 'dia-no-entendido' };
  let minutos = resolverHora(hora) ?? resolverHora(`a las ${hora}`);
  if (minutos === null) return { error: 'hora-no-entendida', clave };
  minutos = desambiguarConHorario(config, minutos, clave, { explicita: horaEsExplicita(hora) });
  const inicio = instanteDe(zona, clave, minutos);
  if (inicio === null) return { error: 'hora-que-no-existe', clave };
  return { clave, minutos, inicio };
}

function huecoLegible(config, hueco) {
  return {
    dia: hueco.dia,
    hora: hueco.hora,
    recurso: hueco.recursoNombre,
    cuando: fechaYHora(config.negocio.zonaHoraria, hueco.inicio),
  };
}

function clienteDeContexto(ctx, { crearSiFalta = false, nombre = null } = {}) {
  const { db, conversacion } = ctx;
  if (conversacion?.cliente_id) return clientes.porId(db, conversacion.cliente_id);
  const contacto = ctx.contacto ?? {};
  if (!crearSiFalta) {
    return (contacto.telefono && clientes.porTelefono(db, contacto.telefono))
      || (contacto.correo && clientes.porCorreo(db, contacto.correo))
      || null;
  }
  const ficha = clientes.buscarOCrear(db, { ...contacto, nombre: nombre ?? contacto.nombre });
  if (conversacion && ficha) {
    db.ejecutar('UPDATE conversaciones SET cliente_id = $clienteId WHERE id = $id',
      { clienteId: ficha.id, id: conversacion.id });
    ctx.conversacion = bandeja.conversacionPorId(db, conversacion.id);
  }
  return ficha;
}

/** Ejecuta una herramienta. Nunca lanza: los problemas vuelven como datos. */
export function ejecutar(nombre, entrada = {}, ctx) {
  const { db, config } = ctx;
  const ahora = ctx.ahora ?? Date.now();
  const v = config.vocabulario;

  try {
    switch (nombre) {
      case 'buscar_huecos': {
        const servicio = resolverServicio(config, entrada.servicio ?? '');
        if (!servicio) {
          return fallo('servicio-desconocido',
            `No sé a qué ${v.servicio} se refiere. Los que hay: ${config.servicios.filter((s) => s.activo).map((s) => s.nombre).join(', ')}.`,
            { servicios: config.servicios.filter((s) => s.activo).map((s) => s.nombre) });
        }
        const recurso = entrada.recurso ? resolverRecurso(config, entrada.recurso) : null;
        const desde = entrada.dia ? resolverDia(entrada.dia, { zona: config.negocio.zonaHoraria, ahora }) : null;
        if (entrada.dia && !desde) return fallo('dia-no-entendido', `No he entendido el día "${entrada.dia}".`);
        // `excluir_dia` no está en el esquema que ve el modelo: lo usa el cerebro
        // de reglas cuando el cliente pide expresamente otro día.
        const excluirDias = entrada.excluir_dia ? [entrada.excluir_dia] : [];
        const { huecos } = buscarHuecos(db, config, {
          servicioId: servicio.id,
          desde,
          franja: entrada.franja ?? null,
          recursoId: recurso?.id ?? null,
          dias: entrada.dia ? 1 : 14,
          ahora,
          limite: config.reglas.huecosQueOfrece ?? 4,
          excluirDias,
        });
        if (huecos.length === 0) {
          // Caso frecuente: ese día sí hay huecos, pero no en la franja que
          // pide. Decir "no queda nada" y ofrecerle las 18:45 es contradecirse.
          if (entrada.franja && desde) {
            const fueraDeFranja = buscarHuecos(db, config, {
              servicioId: servicio.id, desde, dias: 1, recursoId: recurso?.id ?? null, ahora,
              limite: config.reglas.huecosQueOfrece ?? 4,
            }).huecos;
            if (fueraDeFranja.length) {
              const cuando = redaccion.cuandoRelativo(config, fueraDeFranja[0].inicio, ahora);
              return {
                ok: true,
                servicio: servicio.nombre,
                huecos: [],
                fueraDeFranja: fueraDeFranja.map((h) => huecoLegible(config, h)),
                _huecos: fueraDeFranja,
                resumen: `${redaccion.franjaDicha(entrada.franja) ?? 'A esa hora'} no me queda nada ${cuando}, pero sí tengo ${redaccion.enumerar(fueraDeFranja.map((h) => h.hora))}. ¿Te sirve alguna?`,
              };
            }
          }
          const porQuePrevio = desde
            ? porQueNoHayHuecos(config, { clave: desde, servicio, recurso })
            : { motivo: 'lleno' };
          // Si el problema es quien lo hace, se busca con quien SI lo hace:
          // "Luis no hace mechas, las hace Ana; el lunes tengo..."
          const sinRecurso = porQuePrevio.motivo === 'recurso-no-hace'
            || porQuePrevio.motivo === 'recurso-ausente';
          const masAdelante = (entrada.dia || sinRecurso)
            ? buscarHuecos(db, config, {
              servicioId: servicio.id,
              desde,
              dias: 14,
              recursoId: sinRecurso ? null : (recurso?.id ?? null),
              ahora,
              limite: 3,
            }).huecos
            : [];
          const porQue = porQuePrevio;
          const quienLoHace = recursosDe(config, servicio).map((r) => r.nombre);
          const cabeceras = {
            festivo: `Ese día está cerrado${porQue.detalle && porQue.detalle !== 'festivo' ? ` (${porQue.detalle})` : ''}.`,
            cerrado: 'Ese día no abrimos.',
            'recurso-libra': `${porQue.detalle} no trabaja ese día.`,
            // "está vacaciones" no lo dice nadie: el motivo va entre paréntesis y
            // así vale igual para "de baja", "en un curso" o lo que pongan.
            'recurso-ausente': `${porQue.detalle} no está esos días${porQue.razon ? ` (${porQue.razon})` : ''}.`,
            'recurso-no-hace': `${porQue.detalle} no hace ${servicio.nombre.toLowerCase()}: ${quienLoHace.length === 1 ? `lo hace ${quienLoHace[0]}` : `lo hacen ${quienLoHace.join(' y ')}`}.`,
            'servicio-sin-nadie': `Ese día no hay nadie que haga ${servicio.nombre.toLowerCase()}.`,
            lleno: `Ese día no queda nada para ${servicio.nombre.toLowerCase()}.`,
          };
          const cabecera = cabeceras[porQue.motivo] ?? cabeceras.lleno;
          return {
            ok: true, huecos: [], servicio: servicio.nombre, cerrado: porQue.motivo !== 'lleno', motivo: porQue.motivo,
            siguientes: masAdelante.map((h) => huecoLegible(config, h)),
            _huecos: masAdelante,
            resumen: masAdelante.length
              ? `${cabecera} ${redaccion.ofertaDeHuecos(config, masAdelante, { ahora })}`
              : `${cabecera} No me queda nada libre en los próximos días.`,
          };
        }
        return {
          ok: true,
          servicio: servicio.nombre,
          huecos: huecos.map((h) => huecoLegible(config, h)),
          _huecos: huecos,
          resumen: redaccion.ofertaDeHuecos(config, huecos, { ahora }),
        };
      }

      case 'comprobar_hora': {
        const servicio = resolverServicio(config, entrada.servicio ?? '');
        if (!servicio) return fallo('servicio-desconocido', `No sé a qué ${v.servicio} se refiere.`);
        const cuando = resolverInstante(config, entrada, ahora);
        if (cuando.error) return fallo(cuando.error, 'No he entendido esa fecha u hora.');
        const recurso = entrada.recurso ? resolverRecurso(config, entrada.recurso) : null;
        const resultado = comprobarHora(db, config, {
          servicioId: servicio.id, inicio: cuando.inicio, recursoId: recurso?.id ?? null, ahora,
        });
        if (resultado.libre) {
          return {
            ok: true, libre: true, hueco: huecoLegible(config, resultado.hueco), _hueco: resultado.hueco,
            resumen: `Libre: ${fechaYHora(config.negocio.zonaHoraria, resultado.hueco.inicio)}${config.recursos.length > 1 ? ` con ${resultado.hueco.recursoNombre}` : ''}.`,
          };
        }
        return {
          ok: true, libre: false, motivo: resultado.motivo,
          alternativas: (resultado.alternativas ?? []).map((h) => huecoLegible(config, h)),
          _huecos: resultado.alternativas ?? [],
          resumen: explicarMotivo(config, resultado, servicio, ahora),
        };
      }

      case 'reservar': {
        const servicio = resolverServicio(config, entrada.servicio ?? '');
        if (!servicio) return fallo('servicio-desconocido', `No sé a qué ${v.servicio} se refiere.`);
        const cuando = resolverInstante(config, entrada, ahora);
        if (cuando.error) return fallo(cuando.error, 'No he entendido esa fecha u hora.');
        const recurso = entrada.recurso ? resolverRecurso(config, entrada.recurso) : null;
        const ficha = clienteDeContexto(ctx, { crearSiFalta: true, nombre: entrada.nombre });
        if (!ficha) return fallo('sin-contacto', `Necesito un teléfono o un nombre para apuntar ${v.laCita}.`);
        if (entrada.nombre && !ficha.nombre) clientes.actualizar(db, ficha.id, { nombre: entrada.nombre });

        const resultado = citas.reservar(db, config, {
          servicioId: servicio.id,
          inicio: cuando.inicio,
          recursoId: recurso?.id ?? null,
          clienteId: ficha.id,
          canal: ctx.canal ?? 'panel',
          ahora,
        });
        if (!resultado.ok) {
          return {
            ok: false, motivo: resultado.motivo,
            alternativas: (resultado.alternativas ?? []).map((h) => huecoLegible(config, h)),
            _huecos: resultado.alternativas ?? [],
            resumen: `${explicarMotivo(config, resultado, servicio, ahora)}`,
          };
        }
        return {
          ok: true,
          cita: {
            id: resultado.cita.id,
            servicio: resultado.cita.servicio_nombre,
            recurso: resultado.cita.recurso_nombre,
            cuando: fechaYHora(config.negocio.zonaHoraria, resultado.cita.inicio),
          },
          _cita: resultado.cita,
          resumen: redaccion.confirmacion(config, resultado.cita, { nombre: ficha.nombre }),
        };
      }

      case 'mis_citas': {
        const ficha = clienteDeContexto(ctx);
        if (!ficha) return { ok: true, citas: [], resumen: `No encuentro ninguna ${v.cita} a tu nombre.` };
        const proximas = citas.deCliente(db, ficha.id, { soloProximas: true, ahora });
        return {
          ok: true,
          citas: proximas.map((c) => ({
            id: c.id, servicio: c.servicio_nombre, recurso: c.recurso_nombre,
            cuando: fechaYHora(config.negocio.zonaHoraria, c.inicio),
          })),
          _citas: proximas,
          resumen: proximas.length
            ? proximas.map((c) => `${c.servicio_nombre}, ${fechaYHora(config.negocio.zonaHoraria, c.inicio)}`).join('. ')
            : `No tienes ninguna ${v.cita} pendiente.`,
        };
      }

      case 'mover_cita': {
        const ficha = clienteDeContexto(ctx);
        if (!ficha) return fallo('sin-cliente', `No encuentro ninguna ${v.cita} a tu nombre.`);
        const proximas = citas.deCliente(db, ficha.id, { soloProximas: true, ahora });
        const cita = entrada.cita_id ? proximas.find((c) => c.id === entrada.cita_id) : proximas[0];
        if (!cita) return fallo('sin-cita', `No encuentro ninguna ${v.cita} pendiente para cambiar.`);
        if (proximas.length > 1 && !entrada.cita_id) {
          return fallo('varias-citas',
            `Tiene ${proximas.length} ${v.citas}: ${proximas.map((c) => `${c.servicio_nombre} ${fechaYHora(config.negocio.zonaHoraria, c.inicio)}`).join('; ')}. Pregunta cuál.`,
            { citas: proximas.map((c) => ({ id: c.id, cuando: fechaYHora(config.negocio.zonaHoraria, c.inicio) })) });
        }
        const cuando = resolverInstante(config, entrada, ahora);
        if (cuando.error) return fallo(cuando.error, 'No he entendido esa fecha u hora.');
        const resultado = citas.mover(db, config, { citaId: cita.id, nuevoInicio: cuando.inicio, ahora });
        if (!resultado.ok) {
          return {
            ok: false, motivo: resultado.motivo,
            alternativas: (resultado.alternativas ?? []).map((h) => huecoLegible(config, h)),
            _huecos: resultado.alternativas ?? [],
            resumen: `${explicarMotivo(config, resultado, servicioPorId(config, cita.servicio_id), ahora)}`,
          };
        }
        return { ok: true, _cita: resultado.cita, resumen: redaccion.cambioConfirmado(config, resultado.cita) };
      }

      case 'anular_cita': {
        const ficha = clienteDeContexto(ctx);
        if (!ficha) return fallo('sin-cliente', `No encuentro ninguna ${v.cita} a tu nombre.`);
        const proximas = citas.deCliente(db, ficha.id, { soloProximas: true, ahora });
        const cita = entrada.cita_id ? proximas.find((c) => c.id === entrada.cita_id) : proximas[0];
        if (!cita) return fallo('sin-cita', `No tienes ninguna ${v.cita} pendiente.`);
        if (proximas.length > 1 && !entrada.cita_id) {
          return fallo('varias-citas',
            `Tiene ${proximas.length} ${v.citas}. Pregunta cuál quiere anular: ${proximas.map((c) => fechaYHora(config.negocio.zonaHoraria, c.inicio)).join('; ')}.`,
            { citas: proximas.map((c) => ({ id: c.id, cuando: fechaYHora(config.negocio.zonaHoraria, c.inicio) })) });
        }
        const resultado = citas.anular(db, config, { citaId: cita.id, motivo: entrada.motivo ?? '', porQuien: ctx.canal ?? 'bot', ahora });
        return {
          ok: resultado.ok, tarde: resultado.tarde, _cita: resultado.cita,
          resumen: redaccion.anulacionConfirmada(config, cita, { tarde: resultado.tarde, ahora }),
        };
      }

      case 'info_negocio': {
        const que = entrada.que ?? 'todo';
        const partes = [];
        if (que === 'horario' || que === 'todo') partes.push(`Horario: ${redaccion.horarioTexto(config).join('; ')}.`);
        if (que === 'direccion' || que === 'todo') if (config.negocio.direccion) partes.push(`Estamos en ${config.negocio.direccion}.`);
        if (que === 'telefono' || que === 'todo') if (config.negocio.telefono) partes.push(`Teléfono: ${config.negocio.telefono}.`);
        if (que === 'servicios' || que === 'precios' || que === 'todo') partes.push(`${v.servicios.charAt(0).toUpperCase()}${v.servicios.slice(1)}: ${redaccion.listaServicios(config).join('; ')}.`);
        return { ok: true, resumen: partes.join(' ') || 'No tengo ese dato.' };
      }

      case 'guardar_nombre': {
        const ficha = clienteDeContexto(ctx, { crearSiFalta: true, nombre: entrada.nombre });
        if (!ficha) return fallo('sin-contacto', 'No tengo dónde guardarlo.');
        clientes.actualizar(db, ficha.id, { nombre: entrada.nombre });
        return { ok: true, resumen: `Apuntado: ${entrada.nombre}.` };
      }

      case 'escalar': {
        if (ctx.conversacion) {
          bandeja.tomarElMando(db, ctx.conversacion.id, 'escalado');
          bandeja.nota(db, ctx.conversacion.id, `Escalado al equipo: ${entrada.motivo ?? 'sin motivo'}`);
          ctx.conversacion = bandeja.conversacionPorId(db, ctx.conversacion.id);
        }
        db.apuntar('conversacion.escalada', ctx.conversacion?.id ?? null, { motivo: entrada.motivo });
        return { ok: true, escalado: true, resumen: redaccion.escalado(config) };
      }

      default:
        return fallo('herramienta-desconocida', `No existe la herramienta "${nombre}".`);
    }
  } catch (error) {
    db.apuntar('herramienta.error', nombre, { mensaje: error.message });
    return fallo('error-interno', 'Ha fallado algo por dentro. Aviso al equipo.', { error: error.message });
  }
}

function explicarMotivo(config, resultado, servicio, ahora) {
  const alternativas = resultado.alternativas ?? [];
  // Las alternativas se dicen como se las diria una persona, no en ISO.
  const oferta = alternativas.length ? redaccion.ofertaDeHuecos(config, alternativas, { ahora }) : '';
  const cola = oferta ? ` ${oferta}` : '';
  switch (resultado.motivo) {
    case 'ocupado': return `Esa hora está cogida.${cola}`;
    case 'cerrado': return `Ese día está cerrado (${resultado.detalle ?? 'festivo'}).${cola}`;
    case 'fuera-de-horario': return `A esa hora no abrimos.${cola}`;
    case 'demasiado-justo': return `Es demasiado justo: hace falta avisar con ${config.reglas.antelacionMinimaHoras} h.${cola}`;
    case 'demasiado-lejos': return `Todavía no se puede coger para tan lejos (máximo ${config.reglas.antelacionMaximaDias} días).`;
    case 'ya-paso': return `Esa hora ya pasó.${cola}`;
    case 'recurso-no-hace-servicio': return `Ese ${config.vocabulario.recurso} no hace ${servicio.nombre.toLowerCase()}.${cola}`;
    default: return `No puede ser.${cola}`;
  }
}
