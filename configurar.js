#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Te monta conserje.config.json preguntando cuatro cosas. Es lo unico
// imprescindible para que Conserje sirva para TU negocio, y no hay que tocar
// codigo en ningun momento.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { revisarConfig } from './nucleo/config.js';

const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const verde = (t) => `\x1b[32m${t}\x1b[0m`;

const ETIQUETAS = {
  peluqueria: 'Peluquería o barbería',
  dentista: 'Clínica (dental, médica, veterinaria)',
  taller: 'Taller o servicio técnico',
  fisioterapia: 'Fisioterapia, psicología, terapias',
  asesoria: 'Asesoría, despacho, consultoría',
  general: 'Otra cosa (empiezo de cero)',
};

async function principal() {
  const consola = createInterface({ input: stdin, output: stdout });
  const preguntar = async (texto, porDefecto = '') => {
    const respuesta = (await consola.question(`${texto}${porDefecto ? gris(` [${porDefecto}]`) : ''}: `)).trim();
    return respuesta || porDefecto;
  };

  console.log('\n  Conserje · configuración');
  console.log(gris('  ────────────────────────\n'));

  if (existsSync('conserje.config.json')) {
    const seguir = await preguntar('Ya hay una configuración. ¿La reemplazo? (s/n)', 'n');
    if (!/^s/i.test(seguir)) { console.log('\n  Lo dejo como está.\n'); consola.close(); return; }
    copyFileSync('conserje.config.json', 'conserje.config.anterior.json');
    console.log(gris('  Guardo la anterior en conserje.config.anterior.json'));
  }

  const plantillas = readdirSync('plantillas').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  console.log('  ¿Qué tipo de negocio es?\n');
  plantillas.forEach((nombre, i) => console.log(`   ${i + 1}) ${ETIQUETAS[nombre] ?? nombre}`));
  console.log('');
  const elegido = Number(await preguntar('Número', '1'));
  const plantilla = plantillas[(Number.isFinite(elegido) ? elegido : 1) - 1] ?? plantillas[0];
  const config = JSON.parse(readFileSync(join('plantillas', `${plantilla}.json`), 'utf8'));

  console.log('');
  config.negocio.nombre = await preguntar('Nombre del negocio', config.negocio.nombre);
  config.negocio.telefono = await preguntar('Teléfono', config.negocio.telefono);
  config.negocio.direccion = await preguntar('Dirección', config.negocio.direccion);
  config.negocio.zonaHoraria = await preguntar('Zona horaria', config.negocio.zonaHoraria);

  console.log(gris('\n  Servicios de la plantilla:'));
  for (const servicio of config.servicios) {
    console.log(gris(`   · ${servicio.nombre} — ${servicio.duracionMinutos} min${servicio.precio != null ? `, ${servicio.precio} €` : ''}`));
  }
  console.log(gris('  Los cambias luego en conserje.config.json, es una lista normal.\n'));

  const revision = revisarConfig(config);
  if (!revision.ok) {
    console.log('  No ha quedado bien:');
    for (const error of revision.errores) console.log(`   · ${error}`);
    consola.close();
    process.exit(1);
  }

  writeFileSync('conserje.config.json', `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`${verde('  ✓')} Escrito conserje.config.json`);
  for (const aviso of revision.avisos) console.log(gris(`  ! ${aviso}`));

  if (!existsSync('.env') && existsSync('.env.example')) {
    copyFileSync('.env.example', '.env');
    console.log(`${verde('  ✓')} Creado .env (vacío: Conserje arranca igual)`);
  }

  console.log(`
  Ya está. Ahora:

    node sembrar.js --borrar   ${gris('# una semana de citas de ejemplo')}
    node arrancar.js           ${gris('# levanta el panel')}

  Y cuando quieras enchufar WhatsApp, correo o llamadas, mira CONECTAR.md.
`);
  consola.close();
}

principal().catch((error) => { console.error(error.message); process.exit(1); });
