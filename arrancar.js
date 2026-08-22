#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Un comando. Comprueba lo que suele fallar, lo dice en castellano y levanta
// el panel. Si algo está mal, te lo enseña antes de que lo descubra un cliente.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { cargarEntorno } from './nucleo/entorno.js';
import { cargarConfig } from './nucleo/config-fichero.js';
import { abrirBase } from './datos/db.js';
import { crearServidor } from './canales/panel.js';
import { arrancarReloj } from './nucleo/reloj.js';
import { canalesEncendidos, mandar } from './canales/enviar.js';
import { cerebroDisponible } from './cerebro/index.js';
import { revisarBuzon, configurado as correoConfigurado } from './canales/correo.js';
import { horarioTexto } from './nucleo/redaccion.js';

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const ocre = (t) => `\x1b[33m${t}\x1b[0m`;
const rojo = (t) => `\x1b[31m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const bien = (t) => console.log(`${verde('✓')} ${t}`);
const ojo = (t) => console.log(`${ocre('!')} ${t}`);
const mal = (t) => console.log(`${rojo('✗')} ${t}`);

function comprobarNode() {
  const [mayor, menor] = process.versions.node.split('.').map(Number);
  if (mayor > 22 || (mayor === 22 && menor >= 5)) return true;
  mal(`Tienes Node ${process.versions.node} y hace falta 22.5 o más nuevo (la base de datos viene dentro de Node).`);
  console.log(gris('  Descárgalo en https://nodejs.org y vuelve a probar.'));
  return false;
}

async function principal() {
  console.log('');
  console.log('  Conserje');
  console.log(gris('  ────────'));

  if (!comprobarNode()) process.exit(1);
  cargarEntorno();

  if (!existsSync('conserje.config.json')) {
    mal('No encuentro conserje.config.json, que es donde va tu negocio.');
    console.log(gris('  Ejecuta:  node configurar.js     (te lo monta en dos minutos)'));
    process.exit(1);
  }

  let config;
  let avisos = [];
  try {
    const cargada = cargarConfig('conserje.config.json');
    config = cargada.config;
    avisos = cargada.avisos;
  } catch (error) {
    mal('La configuración tiene problemas:');
    for (const linea of error.errores ?? [error.message]) console.log(`   · ${linea}`);
    console.log(gris('\n  Arréglalo en conserje.config.json y vuelve a arrancar.'));
    process.exit(1);
  }

  bien(`Configuración de ${config.negocio.nombre}: ${config.servicios.length} servicios, ${config.recursos.length} ${config.vocabulario.recursos}.`);
  for (const aviso of avisos) ojo(aviso);
  const diasAbiertos = Object.values(config.horario).filter((t) => t.length).length;
  console.log(gris(`  Abierto ${diasAbiertos} días por semana · ${horarioTexto(config)[0] ?? ''}`));

  const db = abrirBase(process.env.CONSERJE_BASE ?? 'datos/conserje.db');
  bien(`Base de datos lista (${db.valor('SELECT COUNT(*) FROM citas') ?? 0} citas guardadas).`);

  const cerebro = cerebroDisponible();
  if (cerebro === 'claude') bien(`Cerebro: Claude (modelo ${config.modelo.nombre}).`);
  else ojo('Cerebro de reglas: sin ANTHROPIC_API_KEY. Coge citas igual, pero entiende menos frases raras.');

  const canales = canalesEncendidos();
  const encendidos = Object.entries(canales).filter(([, v]) => v).map(([k]) => k);
  if (encendidos.length) bien(`Canales encendidos: ${encendidos.join(', ')}.`);
  else ojo('Ningún canal de fuera configurado: se usa entero desde el panel y el simulador.');

  if (!process.env.CONSERJE_CLAVE) {
    ojo('Sin CONSERJE_CLAVE: el panel solo se abre desde este ordenador.');
  } else if (process.env.CONSERJE_CLAVE.length < 8) {
    ojo('La clave del panel es muy corta. Ocho caracteres o más, por favor.');
  } else {
    bien('Panel con clave y sesión firmada.');
  }
  if (process.env.CONSERJE_CLAVE && !process.env.CONSERJE_SECRETO) {
    ojo('Sin CONSERJE_SECRETO: cada vez que reinicies habrá que volver a entrar.');
  }

  const puerto = Number(process.env.CONSERJE_PUERTO ?? 4180);
  const servidor = crearServidor({
    db,
    config,
    canales,
    enviar: (conversacion, texto) => mandar({
      telefono: conversacion.canal === 'whatsapp' || conversacion.canal === 'llamada' ? conversacion.externo : null,
      correo: conversacion.canal === 'correo' ? conversacion.externo : null,
      canalPreferido: conversacion.canal,
    }, texto, { config }),
  });

  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      mal(`El puerto ${puerto} ya está ocupado. Cambia CONSERJE_PUERTO en .env o cierra lo que lo esté usando.`);
      process.exit(1);
    }
    throw error;
  });

  servidor.listen(puerto, () => {
    arrancarReloj(db, config);
    if (correoConfigurado()) {
      const mirar = () => revisarBuzon({ db, config }).catch((error) => db.apuntar('correo.error', null, { mensaje: error.message }));
      mirar();
      setInterval(mirar, 120000).unref?.();
      bien('Mirando el correo cada dos minutos.');
    }
    console.log('');
    console.log(`  → http://localhost:${puerto}`);
    console.log(gris('  Ctrl+C para parar.\n'));
  });

  const cerrar = () => {
    console.log(gris('\n  Cerrando…'));
    servidor.close(() => { db.cerrar(); process.exit(0); });
    setTimeout(() => process.exit(0), 2000).unref?.();
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}

principal().catch((error) => {
  console.error(rojo(`\nAlgo ha fallado al arrancar: ${error.message}`));
  process.exit(1);
});
