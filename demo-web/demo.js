// ---------------------------------------------------------------------------
// La demostración web: Conserje entero dentro de una página, sin servidor.
//
// No es una maqueta ni un vídeo: es el mismo motor de agenda, las mismas
// herramientas y el mismo cerebro de reglas que corren en el servidor. Lo
// único distinto son dos cosas:
//   · la base de datos vive en la memoria del navegador (demo-web/db-web.js)
//   · las llamadas a /api/... no salen a la red: se atienden aquí mismo
//     con el mismo enrutador que usa el servidor (canales/api.js)
//
// Al recargar la página se empieza de cero. Nada sale del navegador.
// ---------------------------------------------------------------------------

import { prepararSql, abrirBase } from './db-web.js';
import { revisarConfig } from '../nucleo/config.js';
import { api } from '../canales/api.js';
import * as clientes from '../nucleo/clientes.js';
import * as citas from '../nucleo/citas.js';
import * as bandeja from '../nucleo/bandeja.js';
import { buscarHuecos } from '../nucleo/agenda.js';
import { claveDia, sumarDias, diaSemana, instanteDe } from '../nucleo/tiempo.js';
import { NEGOCIOS } from './negocios.js';

const NOMBRES = [
  ['Rocío Márquez', '+34600111222'], ['Javier Peña', '+34600111223'],
  ['Marta Ibáñez', '+34600111224'], ['Luis Cabrera', '+34600111225'],
  ['Nuria Salas', '+34600111226'], ['Óscar Ferrer', '+34600111227'],
  ['Elena Prado', '+34600111228'], ['Diego Rivas', '+34600111229'],
  ['Carmen Ortiz', '+34600111230'], ['Toni Bou', '+34600111231'],
];

/**
 * A quién le toca la siguiente cita. Reparte de verdad: siempre a quien menos
 * tenga, y nunca más de dos por semana a la misma persona. Antes rotaba con
 * una cuenta y podía darle cuatro citas seguidas al mismo, que en un dentista
 * no se lo cree nadie y encima parece que se mezclen las fichas.
 */
function aQuienLeToca(fichas, cuenta, tope = 2) {
  const libres = fichas.filter((f) => (cuenta.get(f.id) ?? 0) < tope);
  if (libres.length === 0) return null;
  return libres.reduce((menos, f) => (
    (cuenta.get(f.id) ?? 0) < (cuenta.get(menos.id) ?? 0) ? f : menos
  ), libres[0]);
}

/**
 * Una escena a propósito: tres personas con cita a la misma hora el lunes que
 * viene a mediodía. Sirve para ver dos cosas de un vistazo: que la agenda
 * enseña los tres nombres juntos, y que a la cuarta persona ya no se le da esa
 * hora, porque el tope son tres.
 */
function tresALaMismaHora(db, config, fichas, ahora) {
  const zona = config.negocio.zonaHoraria;
  const tope = config.reglas.maxPorHora ?? 3;
  let clave = claveDia(zona, ahora);
  for (let i = 1; i <= 14; i += 1) {          // el próximo lunes
    clave = sumarDias(claveDia(zona, ahora), i);
    if (diaSemana(zona, clave) === 'lunes') break;
  }
  const servicio = config.servicios.find((s) => s.activo) ?? config.servicios[0];
  const puestas = [];
  for (const ficha of fichas) {
    if (puestas.length >= tope) break;
    const inicio = instanteDe(zona, clave, 12 * 60);
    if (inicio === null) break;
    const r = citas.reservar(db, config, {
      servicioId: servicio.id, inicio, clienteId: ficha.id, canal: 'whatsapp', ahora,
    });
    if (r.ok) puestas.push(ficha.nombre);
  }
  return { clave, puestas };
}

function sembrar(db, config) {
  const zona = config.negocio.zonaHoraria;
  const ahora = Date.now();
  const fichas = NOMBRES.map(([nombre, telefono]) => clientes.buscarOCrear(db, { nombre, telefono }));
  let puestas = 0;
  let pasadas = 0;

  for (let dia = 14; dia >= 1; dia -= 1) {
    const clave = sumarDias(claveDia(zona, ahora), -dia);
    for (const servicio of config.servicios.slice(0, 3)) {
      const { huecos } = buscarHuecos(db, config, {
        servicioId: servicio.id, desde: clave, dias: 1, limite: 10,
        ahora: Date.parse(`${clave}T00:00:00Z`) - 86400000,
      });
      for (const hueco of huecos.filter((_, i) => i % 4 === 0).slice(0, 2)) {
        const ficha = fichas[(puestas + pasadas) % fichas.length];
        const reserva = citas.reservar(db, config, {
          servicioId: servicio.id, inicio: hueco.inicio, recursoId: hueco.recursoId,
          clienteId: ficha.id, canal: ['whatsapp', 'panel', 'llamada'][pasadas % 3],
          ahora: hueco.inicio - 3 * 86400000,
        });
        if (!reserva.ok) continue;
        citas.marcar(db, config, { citaId: reserva.cita.id, estado: pasadas % 9 === 0 ? 'no_vino' : 'atendida' });
        pasadas += 1;
      }
    }
  }

  const porVenir = new Map();
  for (let dia = 0; dia < 7; dia += 1) {
    const clave = sumarDias(claveDia(zona, ahora), dia);
    for (const servicio of config.servicios) {
      const { huecos } = buscarHuecos(db, config, { servicioId: servicio.id, desde: clave, dias: 1, limite: 8, ahora });
      for (const hueco of huecos.filter((_, i) => i % 3 === 0).slice(0, 2)) {
        const ficha = aQuienLeToca(fichas, porVenir);
        if (!ficha) continue;
        const reserva = citas.reservar(db, config, {
          servicioId: servicio.id, inicio: hueco.inicio, recursoId: hueco.recursoId,
          clienteId: ficha.id, canal: ['whatsapp', 'panel', 'correo'][puestas % 3], ahora,
        });
        if (!reserva.ok) continue;
        porVenir.set(ficha.id, (porVenir.get(ficha.id) ?? 0) + 1);
        puestas += 1;
      }
    }
  }

  // Luis Cabrera y dos más, a la misma hora: es la escena que enseña el tope.
  const luis = fichas.find((f) => f.nombre.startsWith('Luis')) ?? fichas[3];
  tresALaMismaHora(db, config, [luis, fichas[4], fichas[7]], ahora);

  const uno = bandeja.abrir(db, { canal: 'whatsapp', externo: fichas[0].telefono, clienteId: fichas[0].id });
  bandeja.entrante(db, uno.id, '¿tenéis hueco esta semana?');
  bandeja.saliente(db, uno.id, 'Sí, mañana por la mañana me queda sitio. ¿Te va bien?');
  const dos = bandeja.abrir(db, { canal: 'correo', externo: 'nuria@ejemplo.com', clienteId: fichas[4].id });
  bandeja.entrante(db, dos.id, 'Quería cambiar la cita del jueves, si puede ser por la tarde.');
  const tres = bandeja.abrir(db, { canal: 'llamada', externo: fichas[3].telefono, clienteId: fichas[3].id });
  bandeja.entrante(db, tres.id, 'Llamo para anular la de mañana, que me ha surgido algo.');
  bandeja.saliente(db, tres.id, 'Hecho, queda anulada. Cuando quieras otra, aquí estoy.');
}

/** Estado vivo de la demostración: base, configuración y negocio elegido. */
const demo = {
  db: null,
  config: null,
  negocio: NEGOCIOS[0],
};

function montarNegocio(elegido) {
  demo.negocio = elegido;
  const revision = revisarConfig(elegido.config);
  if (!revision.ok) throw new Error(revision.errores.join(' | '));
  demo.config = revision.config;
  demo.db?.cerrar();
  demo.db = abrirBase();
  sembrar(demo.db, demo.config);
}

/** Las llamadas a /api/... no salen a la red: las atiende el mismo enrutador. */
function interceptarRed() {
  const original = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = async (entrada, opciones = {}) => {
    const ruta = typeof entrada === 'string' ? entrada : entrada.url;
    const url = new URL(ruta, 'http://demo.local');
    if (!url.pathname.startsWith('/api/')) {
      if (original) return original(entrada, opciones);
      throw new Error(`Fuera de la demostración: ${url.pathname}`);
    }
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : {};
    const respuesta = await api(url.pathname, {
      metodo: opciones.method ?? 'GET',
      url,
      cuerpo,
    }, { db: demo.db, config: demo.config, canales: {} });
    return new Response(JSON.stringify(respuesta.datos ?? null), {
      status: respuesta.codigo,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function pintarSelector() {
  const barra = document.querySelector('#demoBarra');
  barra.innerHTML = `
    <span class="demo-aviso">Demostración · datos inventados, solo en tu navegador</span>
    <label class="demo-elige">Negocio
      <select id="demoNegocio">
        ${NEGOCIOS.map((n, i) => `<option value="${i}">${n.etiqueta}</option>`).join('')}
      </select>
    </label>
    <button id="demoReiniciar" type="button">Empezar de cero</button>`;

  document.querySelector('#demoNegocio').addEventListener('change', (evento) => {
    montarNegocio(NEGOCIOS[Number(evento.target.value)]);
    location.hash = `#${NEGOCIOS[Number(evento.target.value)].id}`;
    location.reload();
  });
  document.querySelector('#demoReiniciar').addEventListener('click', () => location.reload());

  const guardado = NEGOCIOS.findIndex((n) => `#${n.id}` === location.hash);
  if (guardado > 0) document.querySelector('#demoNegocio').value = String(guardado);
}

async function arrancarDemo() {
  // Con el motor de JavaScript puro no hay nada que cargar; con WebAssembly,
  // los bytes vienen incrustados en la propia página, sin pedir nada a la red.
  const wasm = globalThis.__CONSERJE_WASM;
  await prepararSql(() => globalThis.initSqlJs(wasm
    ? { wasmBinary: Uint8Array.from(atob(wasm), (c) => c.charCodeAt(0)) }
    : {}));
  document.querySelector('#demoCargando')?.remove();
  const porHash = NEGOCIOS.find((n) => `#${n.id}` === location.hash);
  montarNegocio(porHash ?? NEGOCIOS[0]);
  interceptarRed();
  pintarSelector();
  // El panel de verdad, tal cual: se arranca cuando ya hay datos que enseñar.
  await import('../panel/panel.js');
}

arrancarDemo().catch((error) => {
  document.body.innerHTML = `<div class="demo-error"><h1>No ha podido arrancar</h1><p>${error.message}</p></div>`;
});
