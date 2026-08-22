#!/usr/bin/env node
// ---------------------------------------------------------------------------
// El sistema entero en la terminal, sin servidor y sin tocar tus datos: base
// en memoria. Sirve para ver de un vistazo que hace Conserje, y para probar
// que sigue haciéndolo despues de cambiar algo.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { cargarEntorno } from './nucleo/entorno.js';
import { revisarConfig } from './nucleo/config.js';
import { abrirBase } from './datos/db.js';
import { contestar, cerebroDisponible } from './cerebro/index.js';
import { resumenDia } from './nucleo/agenda.js';
import * as clientes from './nucleo/clientes.js';
import * as recordatorios from './nucleo/recordatorios.js';
import { pasada } from './nucleo/reloj.js';
import { claveDia, sumarDias, fechaLarga } from './nucleo/tiempo.js';
import { dinero } from './nucleo/redaccion.js';

const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const ocre = (t) => `\x1b[33m${t}\x1b[0m`;
const negrita = (t) => `\x1b[1m${t}\x1b[0m`;

const rutaConfig = process.argv[2]
  ?? (existsSync('conserje.config.json') ? 'conserje.config.json' : 'plantillas/peluqueria.json');
cargarEntorno();
const { config, ok, errores } = revisarConfig(JSON.parse(readFileSync(rutaConfig, 'utf8')));
if (!ok) { console.error(errores.join('\n')); process.exit(1); }

const db = abrirBase(':memory:');
const zona = config.negocio.zonaHoraria;
const ahora = Date.now();
const cerebro = process.env.ANTHROPIC_API_KEY ? cerebroDisponible() : 'reglas';

console.log(`\n${negrita('Conserje')} ${gris(`· ${config.negocio.nombre} · cerebro: ${cerebro}`)}`);
console.log(gris(`  Configuración: ${rutaConfig} · base en memoria, no se toca nada tuyo\n`));

const guion = [
  'buenas, ¿qué precio tiene un corte?',
  `quiero uno ${sumarDias(claveDia(zona, ahora), 3)} por la mañana`,
  'la primera',
  'sí, confirmo',
  'me llamo Rocío',
];

console.log(negrita('1. Una conversación entera'));
for (const linea of guion) {
  const respuesta = await contestar({
    db, config, canal: 'whatsapp', externo: '+34600111222', texto: linea,
    contacto: { telefono: '+34600111222' }, ahora,
  });
  console.log(`   ${gris('cliente >')} ${linea}`);
  console.log(`   ${verde('bot     >')} ${respuesta.texto}`);
  if (respuesta.acciones?.length) {
    console.log(`   ${gris(`          ${respuesta.acciones.map((a) => a.herramienta).join(' → ')}`)}`);
  }
}

console.log(`\n${negrita('2. Lo que ha pasado por dentro')}`);
const ficha = clientes.listar(db)[0];
const completa = clientes.ficha(db, ficha.id);
console.log(`   Ficha creada sola: ${completa.nombre || 'sin nombre'} · ${completa.telefono} · ${completa.total} cita(s)`);
const proxima = completa.proxima;
if (proxima) {
  console.log(`   Cita: ${proxima.servicio_nombre} con ${proxima.recurso_nombre}, ${fechaLarga(zona, proxima.inicio)} · ${dinero(config, proxima.precio_centimos)}`);
  const dia = resumenDia(db, config, claveDia(zona, proxima.inicio));
  console.log(`   Agenda de ese día: ${dia.total} cita(s), ${dinero(config, dia.previstoCentimos)} previstos`);
}

console.log(`\n${negrita('3. El recordatorio de la víspera')}`);
const programados = recordatorios.listar(db, {});
if (programados.length) {
  for (const r of programados) {
    console.log(`   ${r.tipo}: ${new Date(r.cuando).toLocaleString('es-ES', { timeZone: zona })} (${r.estado})`);
  }
  const hecho = await pasada(db, config, {
    ahora: programados[0].cuando + 1000,
    enviar: async () => ({ ok: false, motivo: 'sin-canal' }),
  });
  console.log(gris(`   Sin canales configurados: ${hecho.aMano} queda(n) en el panel como "hay que mandarlo a mano".`));
} else {
  console.log(gris('   Nada programado (la cita cae hoy o los recordatorios están apagados).'));
}

console.log(`\n${negrita('4. Lo que el bot NO hace solo')}`);
const queja = await contestar({
  db, config, canal: 'whatsapp', externo: '+34600999111',
  texto: 'esto es una vergüenza, quiero hablar con el encargado y poner una reclamación',
  contacto: { telefono: '+34600999111' }, ahora,
});
console.log(`   ${gris('cliente >')} esto es una vergüenza, quiero hablar con el encargado…`);
console.log(`   ${ocre('bot     >')} ${queja.texto}`);
console.log(gris(`   La conversación pasa a "${queja.conversacion.estado}": el bot ya no vuelve a hablar ahí.`));

console.log(`\n${negrita('5. Una hora inventada no cuela')}`);
const inventada = await contestar({
  db, config, canal: 'simulador', externo: 'prueba-inventada',
  texto: `quiero un corte el ${sumarDias(claveDia(zona, ahora), 3)} a las 04:00`,
  contacto: { telefono: '+34600999112' }, ahora,
});
console.log(`   ${gris('cliente >')} un corte a las 04:00`);
console.log(`   ${verde('bot     >')} ${inventada.texto}`);

console.log(`\n${gris('Fin. Para verlo con panel:  node arrancar.js')}\n`);
db.cerrar();
