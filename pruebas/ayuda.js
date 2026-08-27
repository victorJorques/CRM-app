// Andamios para las pruebas: una base en memoria y un negocio de mentira.
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { abrirBase } from '../datos/db.js';
import { revisarConfig } from '../nucleo/config.js';
import { aUtc } from '../nucleo/tiempo.js';

export const ZONA = 'Europe/Madrid';

/** Viernes 21 de agosto de 2026, a las 9:00 de la mañana en Madrid. */
export const AHORA = aUtc(ZONA, { anio: 2026, mes: 8, dia: 21, hora: 9, minuto: 0 });

export const LUNES = '2026-08-24';
export const MARTES = '2026-08-25';
export const DOMINGO = '2026-08-23';

// El reloj se congela en AHORA para todas las pruebas. Sin esto, las que
// hablan del lunes 24 de agosto empiezan a fallar solas cuando llega el 25:
// no porque el programa se rompa, sino porque pasa el tiempo.
mock.timers.enable({ apis: ['Date'], now: new Date(AHORA) });

/** Adelanta el reloj congelado, para lo que necesite ver pasar el tiempo. */
export function avanzarReloj(ms) {
  mock.timers.setTime(Date.now() + ms);
}

export function instante(clave, hora, minuto = 0) {
  const [anio, mes, dia] = clave.split('-').map(Number);
  return aUtc(ZONA, { anio, mes, dia, hora, minuto });
}

export function configDe(bruta) {
  const revision = revisarConfig(bruta);
  if (!revision.ok) throw new Error(`Config de prueba mal: ${revision.errores.join(' | ')}`);
  return revision.config;
}

export function plantilla(nombre) {
  return JSON.parse(readFileSync(new URL(`../plantillas/${nombre}.json`, import.meta.url), 'utf8'));
}

/** Negocio minimo y previsible: dos personas, dos servicios, mañana y tarde. */
export function negocioDePrueba(cambios = {}) {
  return configDe({
    negocio: { nombre: 'Prueba', zonaHoraria: ZONA, telefono: '+34600000000', direccion: 'Calle Falsa 1' },
    horario: {
      lunes: [['09:00', '14:00'], ['16:00', '20:00']],
      martes: [['09:00', '14:00'], ['16:00', '20:00']],
      miercoles: [['09:00', '14:00']],
      jueves: [['09:00', '14:00'], ['16:00', '20:00']],
      viernes: [['09:00', '14:00']],
      sabado: [],
      domingo: [],
    },
    reglas: { granularidadMinutos: 30, antelacionMinimaHoras: 2, antelacionMaximaDias: 60, huecosQueOfrece: 4 },
    servicios: [
      { nombre: 'Corte', duracionMinutos: 30, precio: 20, alias: ['pelo'] },
      { nombre: 'Tinte', duracionMinutos: 60, precio: 50, recursos: ['ana'] },
    ],
    recursos: [
      { nombre: 'Ana' },
      { nombre: 'Luis', horario: { lunes: [], martes: [['09:00', '14:00']], miercoles: [], jueves: [], viernes: [], sabado: [], domingo: [] } },
    ],
    ...cambios,
  });
}

export function montar(cambios = {}) {
  return { db: abrirBase(':memory:'), config: negocioDePrueba(cambios), ahora: AHORA };
}
