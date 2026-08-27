// Un día entero de una clínica, con siete personas hablando por canales
// distintos y pisándose entre ellas. Es la prueba que más se parece a la
// realidad: lo que se libera lo coge otro, lo que se llena se rechaza, y al
// final la agenda tiene que cuadrar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contestar } from '../cerebro/index.js';
import * as clientes from '../nucleo/clientes.js';
import * as citas from '../nucleo/citas.js';
import * as bandeja from '../nucleo/bandeja.js';
import { resumenDia, citasALaMismaHora } from '../nucleo/agenda.js';
import { abrirBase } from '../datos/db.js';
import { revisarConfig } from '../nucleo/config.js';
import { plantilla, instante, AHORA, LUNES, MARTES } from './ayuda.js';

function clinica() {
  const bruta = plantilla('dentista');
  const { config, ok, errores } = revisarConfig(bruta);
  assert.ok(ok, errores.join(' | '));
  return { db: abrirBase(':memory:'), config, ahora: AHORA };
}

const GENTE = [
  ['Luis Cabrera', '+34600111225'], ['Nuria Salas', '+34600111226'],
  ['Diego Rivas', '+34600111229'], ['Carmen Ortiz', '+34600111230'],
  ['Toni Bou', '+34600111231'], ['Marta Ibáñez', '+34600111224'],
  ['Óscar Ferrer', '+34600111227'],
];

function montarClinica() {
  const entorno = clinica();
  entorno.fichas = Object.fromEntries(GENTE.map(([nombre, telefono]) => [
    nombre, clientes.buscarOCrear(entorno.db, { nombre, telefono }),
  ]));
  // De partida: tres a las 12:00 del lunes, y Carmen a las 10:00
  for (const nombre of ['Luis Cabrera', 'Nuria Salas', 'Diego Rivas']) {
    const r = citas.reservar(entorno.db, entorno.config, {
      servicioId: 'primera-visita', inicio: instante(LUNES, 12),
      clienteId: entorno.fichas[nombre].id, canal: 'whatsapp', ahora: entorno.ahora,
    });
    assert.ok(r.ok, `${nombre}: ${r.motivo}`);
  }
  citas.reservar(entorno.db, entorno.config, {
    servicioId: 'limpieza', inicio: instante(LUNES, 10),
    clienteId: entorno.fichas['Carmen Ortiz'].id, canal: 'correo', ahora: entorno.ahora,
  });
  return entorno;
}

function hablarCon(entorno) {
  return async (canal, externo, texto, contacto) => {
    const r = await contestar({
      db: entorno.db, config: entorno.config, canal, externo, texto,
      contacto: contacto ?? { telefono: externo }, ahora: entorno.ahora, forzarCerebro: 'reglas',
    });
    return r;
  };
}

test('un día entero: siete personas, cuatro canales y la agenda cuadra', async () => {
  const entorno = montarClinica();
  const decir = hablarCon(entorno);
  const { fichas } = entorno;

  // 1. Marta pide cita nueva y la cierra
  const marta = fichas['Marta Ibáñez'].telefono;
  await decir('whatsapp', marta, 'hola, quiero una limpieza');
  await decir('whatsapp', marta, `el ${LUNES} por la mañana`);
  await decir('whatsapp', marta, 'la primera');
  const cerrada = await decir('whatsapp', marta, 'sí');
  assert.match(cerrada.texto, /Hecho, Marta/);

  // 2. Toni pide las 12:00, que están al completo
  const toni = fichas['Toni Bou'].telefono;
  const lleno = await decir('llamada', toni, `quiero una limpieza el ${LUNES} a las 12:00`);
  assert.match(lleno.texto, /máximo que cogemos a la vez/);
  assert.equal(citasALaMismaHora(entorno.db, instante(LUNES, 12)), 3);

  // 3. Luis cambia la suya y libera ese hueco
  const luis = fichas['Luis Cabrera'].telefono;
  await decir('whatsapp', luis, 'tenía cita el lunes a las 12');
  const cambiada = await decir('whatsapp', luis, 'sí');
  assert.match(cambiada.texto, /Cambiada/);
  assert.equal(citasALaMismaHora(entorno.db, instante(LUNES, 12)), 2);

  // 4. Toni lo vuelve a intentar y ahora sí entra
  await decir('llamada', toni, `pues quiero esa limpieza el ${LUNES} a las 12:00`);
  const suya = await decir('llamada', toni, 'sí');
  assert.match(suya.texto, /Hecho, Toni/);
  assert.equal(citasALaMismaHora(entorno.db, instante(LUNES, 12)), 3);

  // 5. Carmen anula, por correo, desde su dirección
  clientes.actualizar(entorno.db, fichas['Carmen Ortiz'].id, { correo: 'carmen@ejemplo.com' });
  const correo = { correo: 'carmen@ejemplo.com', nombre: 'Carmen Ortiz' };
  await decir('correo', 'carmen@ejemplo.com', 'quiero anular mi cita', correo);
  const anulada = await decir('correo', 'carmen@ejemplo.com', 'sí', correo);
  assert.match(anulada.texto, /Anulada/);

  // 6. Óscar se queja: eso no lo lleva el bot
  const oscar = fichas['Óscar Ferrer'].telefono;
  const queja = await decir('whatsapp', oscar, 'esto es una vergüenza, quiero una hoja de reclamaciones');
  assert.match(queja.texto, /Aviso a alguien del equipo/);
  assert.equal(queja.conversacion.estado, 'humano');

  // 7. Un número desconocido reserva y se le crea la ficha
  const nueva = '+34600777888';
  await decir('whatsapp', nueva, 'buenas, ¿tenéis hueco esta semana para una revisión?');
  await decir('whatsapp', nueva, 'la primera');
  await decir('whatsapp', nueva, 'sí');
  const presentada = await decir('whatsapp', nueva, 'me llamo Sonia Vidal');
  assert.match(presentada.texto, /Hecho, Sonia/);
  assert.equal(clientes.porTelefono(entorno.db, nueva).nombre, 'Sonia Vidal');

  // --- Y la agenda del lunes cuadra ---------------------------------------
  const dia = resumenDia(entorno.db, entorno.config, LUNES);
  const vivas = dia.citas.filter((c) => ['reservada', 'confirmada'].includes(c.estado));

  // Marta cerró la suya a las 09:00
  assert.equal(vivas.filter((c) => c.cliente_nombre === 'Marta Ibáñez' && c.inicio === instante(LUNES, 9)).length, 1);

  const aLasDoce = vivas.filter((c) => c.inicio === instante(LUNES, 12)).map((c) => c.cliente_nombre).sort();
  assert.deepEqual(aLasDoce, ['Diego Rivas', 'Nuria Salas', 'Toni Bou']);
  assert.ok(!aLasDoce.includes('Luis Cabrera'), 'Luis se cambió y no puede seguir a esa hora');

  assert.equal(dia.horasCompletas.length, 1);
  assert.equal(dia.horasCompletas[0].hora, '12:00');
  assert.equal(dia.horasCompletas[0].total, 3);

  // Carmen anuló: su hora ya no cuenta como viva
  assert.equal(vivas.filter((c) => c.cliente_nombre === 'Carmen Ortiz').length, 0);

  // Nadie tiene la cita de nadie
  for (const cita of vivas) {
    const suyas = citas.deCliente(entorno.db, cita.cliente_id).map((c) => c.id);
    assert.ok(suyas.includes(cita.id));
  }

  // Y la bandeja: siete conversaciones, una en manos de una persona
  const conversaciones = bandeja.listar(entorno.db, {});
  assert.equal(conversaciones.length, 6);
  assert.equal(conversaciones.filter((c) => c.estado === 'humano').length, 1);
  assert.equal(conversaciones.find((c) => c.estado === 'humano').cliente_nombre, 'Óscar Ferrer');
});

test('lo que uno libera se lo puede llevar otro, sin pasar del tope', async () => {
  const entorno = montarClinica();
  const decir = hablarCon(entorno);
  // Dos personas distintas van a por el mismo hueco liberado
  await decir('whatsapp', entorno.fichas['Luis Cabrera'].telefono, 'tenía cita el lunes a las 12');
  await decir('whatsapp', entorno.fichas['Luis Cabrera'].telefono, 'sí');
  assert.equal(citasALaMismaHora(entorno.db, instante(LUNES, 12)), 2);

  await decir('llamada', entorno.fichas['Toni Bou'].telefono, `quiero una limpieza el ${LUNES} a las 12:00`);
  await decir('llamada', entorno.fichas['Toni Bou'].telefono, 'sí');
  assert.equal(citasALaMismaHora(entorno.db, instante(LUNES, 12)), 3);

  // El siguiente ya no cabe
  const tarde = await decir('whatsapp', entorno.fichas['Marta Ibáñez'].telefono, `quiero una limpieza el ${LUNES} a las 12:00`);
  assert.match(tarde.texto, /máximo que cogemos a la vez/);
  assert.equal(citasALaMismaHora(entorno.db, instante(LUNES, 12)), 3);
});
