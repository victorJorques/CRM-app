import test from 'node:test';
import assert from 'node:assert/strict';
import { definiciones, ejecutar } from '../cerebro/herramientas.js';
import * as bandeja from '../nucleo/bandeja.js';
import * as clientes from '../nucleo/clientes.js';
import * as citas from '../nucleo/citas.js';
import { montar, LUNES, MARTES, DOMINGO } from './ayuda.js';

function contexto(cambios = {}) {
  const entorno = montar();
  const conversacion = bandeja.abrir(entorno.db, { canal: 'whatsapp', externo: '+34600111222' });
  return {
    db: entorno.db,
    config: entorno.config,
    conversacion,
    contacto: { telefono: '+34600111222' },
    canal: 'whatsapp',
    ahora: entorno.ahora,
    ...cambios,
  };
}

test('el modelo recibe las nueve herramientas con su esquema', () => {
  const ctx = contexto();
  const lista = definiciones(ctx.config);
  assert.equal(lista.length, 9);
  for (const herramienta of lista) {
    assert.ok(herramienta.name);
    assert.ok(herramienta.description.length > 20);
    assert.equal(herramienta.input_schema.type, 'object');
  }
});

test('la descripción de buscar_huecos lleva los servicios del negocio', () => {
  const ctx = contexto();
  const buscar = definiciones(ctx.config).find((h) => h.name === 'buscar_huecos');
  assert.match(buscar.description, /Corte/);
  assert.match(buscar.description, /Tinte/);
});

test('buscar_huecos devuelve horas de verdad', () => {
  const ctx = contexto();
  const r = ejecutar('buscar_huecos', { servicio: 'corte', dia: 'el lunes' }, ctx);
  assert.ok(r.ok);
  assert.equal(r.huecos[0].hora, '09:00');
  assert.equal(r.huecos[0].dia, LUNES);
});

test('buscar_huecos con franja respeta la franja', () => {
  const ctx = contexto();
  const r = ejecutar('buscar_huecos', { servicio: 'corte', dia: 'el lunes', franja: 'tarde' }, ctx);
  assert.ok(r.huecos.every((h) => Number(h.hora.slice(0, 2)) >= 14));
});

test('buscar_huecos avisa si el servicio no existe', () => {
  const ctx = contexto();
  const r = ejecutar('buscar_huecos', { servicio: 'masaje tailandés' }, ctx);
  assert.ok(!r.ok);
  assert.equal(r.motivo, 'servicio-desconocido');
  assert.match(r.resumen, /Corte/);
});

test('buscar_huecos explica que ese día está cerrado', () => {
  const ctx = contexto();
  const r = ejecutar('buscar_huecos', { servicio: 'corte', dia: DOMINGO }, ctx);
  assert.equal(r.huecos.length, 0);
  assert.match(r.resumen, /no abrimos/i);
});

test('si no hay nada en esa franja, no dice que el día esté vacío', () => {
  const ctx = contexto();
  // Se llena la mañana del lunes entera con tintes de una hora.
  for (const hora of [9, 10, 11, 12, 13]) {
    ejecutar('reservar', { servicio: 'tinte', dia: LUNES, hora: `${hora}:00` }, ctx);
  }
  const r = ejecutar('buscar_huecos', { servicio: 'tinte', dia: LUNES, franja: 'manana' }, ctx);
  assert.equal(r.huecos.length, 0);
  assert.match(r.resumen, /Por la mañana no me queda nada/);
  assert.ok(r.fueraDeFranja.length > 0);
  assert.ok(r.fueraDeFranja.every((h) => Number(h.hora.slice(0, 2)) >= 14));
});

test('buscar_huecos dice quién sí hace el servicio', () => {
  const ctx = contexto();
  const r = ejecutar('buscar_huecos', { servicio: 'tinte', dia: MARTES, recurso: 'Luis' }, ctx);
  assert.match(r.resumen, /Luis no hace tinte/i);
  assert.match(r.resumen, /Ana/);
});

test('comprobar_hora confirma una hora libre', () => {
  const ctx = contexto();
  const r = ejecutar('comprobar_hora', { servicio: 'corte', dia: LUNES, hora: '10:00' }, ctx);
  assert.ok(r.libre);
});

test('comprobar_hora rechaza una hora fuera de horario y ofrece otras', () => {
  const ctx = contexto();
  const r = ejecutar('comprobar_hora', { servicio: 'corte', dia: LUNES, hora: '15:00' }, ctx);
  assert.ok(!r.libre);
  assert.match(r.resumen, /no abrimos/i);
  assert.ok(r.alternativas.length > 0);
});

test('comprobar_hora no se traga una fecha que no entiende', () => {
  const ctx = contexto();
  const r = ejecutar('comprobar_hora', { servicio: 'corte', dia: 'cuando sea', hora: '10:00' }, ctx);
  assert.ok(!r.ok);
});

test('reservar deja la cita puesta y contesta como una persona', () => {
  const ctx = contexto();
  const r = ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00', nombre: 'Rocío' }, ctx);
  assert.ok(r.ok);
  assert.match(r.resumen, /Hecho, Rocío/);
  assert.match(r.resumen, /lunes 24 de agosto a las 10:00/);
});

test('reservar guarda el nombre en la ficha', () => {
  const ctx = contexto();
  ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00', nombre: 'Rocío' }, ctx);
  assert.equal(clientes.porTelefono(ctx.db, '+34600111222').nombre, 'Rocío');
});

test('una hora inventada no llega a la agenda', () => {
  const ctx = contexto();
  const r = ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '04:00' }, ctx);
  assert.ok(!r.ok);
  assert.equal(ctx.db.valor('SELECT COUNT(*) FROM citas'), 0);
});

test('reservar dos veces la misma hora falla la segunda', () => {
  const ctx = contexto();
  assert.ok(ejecutar('reservar', { servicio: 'tinte', dia: LUNES, hora: '10:00' }, ctx).ok);
  const otro = contexto({ db: ctx.db, config: ctx.config });
  const conversacion = bandeja.abrir(ctx.db, { canal: 'whatsapp', externo: '+34600333444' });
  const segunda = ejecutar('reservar', { servicio: 'tinte', dia: LUNES, hora: '10:00' },
    { ...ctx, conversacion, contacto: { telefono: '+34600333444' } });
  assert.ok(!segunda.ok);
  assert.match(segunda.resumen, /cogida/i);
});

test('mis_citas trae solo las próximas de quien escribe', () => {
  const ctx = contexto();
  ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00' }, ctx);
  const r = ejecutar('mis_citas', {}, ctx);
  assert.equal(r.citas.length, 1);
  assert.match(r.resumen, /Corte/);
});

test('mis_citas no enseña las de otro', () => {
  const ctx = contexto();
  ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00' }, ctx);
  const otra = bandeja.abrir(ctx.db, { canal: 'whatsapp', externo: '+34600999888' });
  const r = ejecutar('mis_citas', {}, { ...ctx, conversacion: otra, contacto: { telefono: '+34600999888' } });
  assert.equal(r.citas.length, 0);
});

test('mover_cita cambia la hora', () => {
  const ctx = contexto();
  ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00' }, ctx);
  const r = ejecutar('mover_cita', { dia: LUNES, hora: '12:00' }, ctx);
  assert.ok(r.ok);
  assert.match(r.resumen, /12:00/);
});

test('mover_cita pregunta cuál si hay varias', () => {
  const ctx = contexto();
  ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00' }, ctx);
  ejecutar('reservar', { servicio: 'corte', dia: MARTES, hora: '10:00' }, ctx);
  const r = ejecutar('mover_cita', { dia: MARTES, hora: '12:00' }, ctx);
  assert.ok(!r.ok);
  assert.equal(r.motivo, 'varias-citas');
});

test('anular_cita anula la que hay', () => {
  const ctx = contexto();
  const reserva = ejecutar('reservar', { servicio: 'corte', dia: LUNES, hora: '10:00' }, ctx);
  const r = ejecutar('anular_cita', { motivo: 'me surgió algo' }, ctx);
  assert.ok(r.ok);
  assert.equal(citas.porId(ctx.db, reserva._cita.id).estado, 'anulada');
});

test('anular_cita sin cita lo dice sin romperse', () => {
  const ctx = contexto();
  const r = ejecutar('anular_cita', {}, ctx);
  assert.ok(!r.ok);
  assert.match(r.resumen, /ninguna cita/i);
});

test('info_negocio contesta con lo que hay en la configuración', () => {
  const ctx = contexto();
  assert.match(ejecutar('info_negocio', { que: 'horario' }, ctx).resumen, /lunes/);
  assert.match(ejecutar('info_negocio', { que: 'direccion' }, ctx).resumen, /Calle Falsa/);
  assert.match(ejecutar('info_negocio', { que: 'servicios' }, ctx).resumen, /Corte/);
});

test('guardar_nombre escribe en la ficha', () => {
  const ctx = contexto();
  ejecutar('guardar_nombre', { nombre: 'Javier' }, ctx);
  assert.equal(clientes.porTelefono(ctx.db, '+34600111222').nombre, 'Javier');
});

test('escalar aparta al bot de esa conversación', () => {
  const ctx = contexto();
  const r = ejecutar('escalar', { motivo: 'una queja' }, ctx);
  assert.ok(r.escalado);
  assert.equal(bandeja.conversacionPorId(ctx.db, ctx.conversacion.id).estado, 'humano');
});

test('una herramienta que no existe no rompe nada', () => {
  const ctx = contexto();
  const r = ejecutar('pedir_pizza', {}, ctx);
  assert.ok(!r.ok);
  assert.equal(r.motivo, 'herramienta-desconocida');
});

test('el modelo no ve los objetos internos de la respuesta', () => {
  const ctx = contexto();
  const r = ejecutar('buscar_huecos', { servicio: 'corte', dia: LUNES }, ctx);
  assert.ok(r._huecos);
  const paraElModelo = JSON.parse(JSON.stringify(Object.fromEntries(
    Object.entries(r).filter(([k]) => !k.startsWith('_')),
  )));
  assert.equal(paraElModelo._huecos, undefined);
  assert.ok(paraElModelo.huecos.length > 0);
});
