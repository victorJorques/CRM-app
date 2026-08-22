#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Empaqueta Conserje en una sola página web que funciona sin servidor.
//
//   npm install --no-save sql.js esbuild     (solo para construir)
//   node demo-web/construir.mjs
//   node demo-web/construir.mjs --motor=wasm  (más rápido, pero pide permiso
//                                              de WebAssembly en la página)
//   → demo-web/salida/conserje-demo.html
//
// Por defecto se usa el SQLite compilado a JavaScript puro (asm.js): pesa más
// y va algo más lento, pero funciona incluso donde WebAssembly está prohibido,
// que es el caso de las páginas publicadas con reglas de seguridad estrictas.
//
// Conserje no depende de nada para funcionar; estas dos herramientas hacen
// falta solo para construir la demostración, y por eso no están en
// package.json: se piden con npx cuando se usan.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const SALIDA = join(AQUI, 'salida');
const argumentos = process.argv.slice(2);
const motor = (argumentos.find((a) => a.startsWith('--motor=')) ?? '--motor=asm').split('=')[1];
const sqlJs = resolve(argumentos.find((a) => !a.startsWith('--')) ?? join(RAIZ, 'node_modules/sql.js/dist'));
if (!['asm', 'wasm'].includes(motor)) throw new Error('El motor solo puede ser asm o wasm');

const cambiarLaBase = {
  name: 'base-en-el-navegador',
  setup(constructor) {
    // Todo el programa habla con SQLite por un solo sitio. Aquí se cambia ese
    // sitio por la versión de navegador, y el resto del código va tal cual.
    constructor.onResolve({ filter: /datos\/db\.js$/ }, () => ({
      path: join(AQUI, 'db-web.js'),
    }));
  },
};

const resultado = await build({
  entryPoints: [join(AQUI, 'demo.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
  minify: false,
  write: false,
  plugins: [cambiarLaBase],
  banner: { js: 'globalThis.__proceso = { env: {} };' },
  define: { process: 'globalThis.__proceso' },
  loader: { '.json': 'json' },
});

const paquete = resultado.outputFiles[0].text;
const conWasm = motor === 'wasm';
const wasm = conWasm ? readFileSync(join(sqlJs, 'sql-wasm.wasm')).toString('base64') : '';
const sqlCargador = readFileSync(join(sqlJs, conWasm ? 'sql-wasm.js' : 'sql-asm.js'), 'utf8');
const css = readFileSync(join(RAIZ, 'panel/panel.css'), 'utf8');
const html = readFileSync(join(RAIZ, 'panel/index.html'), 'utf8');

// Del panel se coge el cuerpo tal cual: es la misma interfaz, sin retoques.
const cuerpo = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace('<script src="/panel.js" type="module"></script>', '')
  .replace('<div id="app" class="oculto">', '<div id="app" class="oculto">\n    <div id="demoBarra" class="demo-barra"></div>');

const estilosDemo = `
/* Añadido solo en la demostración: la barra de arriba y el aviso. */
.demo-barra {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 9px 20px; background: var(--ocre-suave); border-bottom: 1px solid var(--linea2);
  font-size: 13.5px; margin: 0 -20px 0;
}
.demo-aviso { color: var(--ocre); font-weight: 600; }
.demo-elige { display: flex; align-items: center; gap: 6px; color: var(--tinta2); }
.demo-barra select, .demo-barra button { padding: 4px 8px; font-size: 13.5px; }
.demo-cargando {
  display: grid; place-items: center; min-height: 100vh; gap: 10px;
  color: var(--tinta2); text-align: center; padding: 24px;
}
.demo-cargando b { font-size: 22px; color: var(--tinta); letter-spacing: -.02em; }
.demo-error { max-width: 40ch; margin: 18vh auto; text-align: center; color: var(--tinta); }
`;

// Dos salidas del mismo material:
//  · suelta.html  — página completa, para abrirla en tu ordenador
//  · incrustable.html — solo el contenido, para publicarla dentro de otra cosa
//    (una página publicada envuelve ella misma el doctype y la cabecera)
const contenido = `<title>Panel de Conserje</title>
<style>${css}${estilosDemo}</style>
<div id="demoCargando" class="demo-cargando"><b>Conserje</b><span>Montando el negocio de ejemplo…</span></div>
${cuerpo}
<script>${sqlCargador}</script>
<script>globalThis.__CONSERJE_WASM = "${wasm}";</script>
<script type="module">
${paquete}
</script>
`;

const suelta = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>🛎️</text></svg>">
</head>
<body>
${contenido.replace('<title>Panel de Conserje</title>', '<title>Conserje</title>')}</body>
</html>
`;

mkdirSync(SALIDA, { recursive: true });
writeFileSync(join(SALIDA, 'conserje-demo.html'), suelta, 'utf8');
writeFileSync(join(SALIDA, 'conserje-incrustable.html'), contenido, 'utf8');
console.log(`${join(SALIDA, 'conserje-demo.html')} · ${(suelta.length / 1024 / 1024).toFixed(2)} MB · motor ${motor}`);
console.log(`${join(SALIDA, 'conserje-incrustable.html')} · para publicar dentro de otra página`);
