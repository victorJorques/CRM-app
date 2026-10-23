import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutosDeHora, horaDeMinutos, duracionDicha, rangoDelDia, enCarriles,
  fueraDeHorario, lineasDeHoras, alturaDe,
} from '../panel/calendario.js';

test('las horas van y vienen de minutos sin perderse por el camino', () => {
  assert.equal(minutosDeHora('09:30'), 570);
  assert.equal(minutosDeHora('00:00'), 0);
  assert.equal(horaDeMinutos(570), '09:30');
  assert.equal(horaDeMinutos(1440), '24:00');
});

test('los huecos se dicen como los diría una persona', () => {
  assert.equal(duracionDicha(45), '45 min');
  assert.equal(duracionDicha(60), '1 h');
  assert.equal(duracionDicha(135), '2 h 15 min');
});

test('el calendario va de la primera hora que se abre a la última que se cierra', () => {
  const rango = rangoDelDia([
    { tramos: [[570, 1200]], bloques: [] },
    { tramos: [[600, 840]], bloques: [] },
  ]);
  assert.deepEqual(rango, { desde: 540, hasta: 1200 });
});

test('una cita fuera de horario también entra en el calendario', () => {
  // Si alguien metió una cita a las ocho y se abre a las nueve, se pinta:
  // esconderla sería la manera más rápida de que nadie la atienda.
  const rango = rangoDelDia([{ tramos: [[540, 840]], bloques: [{ desde: 480, hasta: 510 }] }]);
  assert.deepEqual(rango, { desde: 480, hasta: 840 });
});

test('un día sin nadie no tiene calendario que pintar', () => {
  assert.equal(rangoDelDia([{ tramos: [], bloques: [] }]), null);
});

test('un rato muy corto se estira para que se pueda leer', () => {
  const rango = rangoDelDia([{ tramos: [[600, 660]], bloques: [] }]);
  assert.equal(rango.hasta - rango.desde, 240);
  assert.equal(rango.desde, 600);
});

test('dos citas a la vez se reparten el ancho, y la de después no', () => {
  const puestos = enCarriles([
    { id: 'a', desde: 720, hasta: 780 },
    { id: 'b', desde: 720, hasta: 750 },
    { id: 'c', desde: 900, hasta: 945 },
  ]);
  const porId = Object.fromEntries(puestos.map((p) => [p.id, p]));
  assert.notEqual(porId.a.carril, porId.b.carril);
  assert.equal(porId.a.carriles, 2);
  assert.equal(porId.b.carriles, 2);
  // La de las tres de la tarde no se estrecha por lo que pasara a mediodía.
  assert.equal(porId.c.carriles, 1);
  assert.equal(porId.c.carril, 0);
});

test('tres a la misma hora caben una al lado de otra', () => {
  const puestos = enCarriles([
    { id: 'luis', desde: 720, hasta: 750 },
    { id: 'nuria', desde: 720, hasta: 750 },
    { id: 'diego', desde: 720, hasta: 750 },
  ]);
  assert.deepEqual(puestos.map((p) => p.carril).sort(), [0, 1, 2]);
  assert.deepEqual([...new Set(puestos.map((p) => p.carriles))], [3]);
});

test('una cita que acaba cuando empieza la otra no las pone en dos carriles', () => {
  const puestos = enCarriles([
    { id: 'a', desde: 600, hasta: 645 },
    { id: 'b', desde: 645, hasta: 690 },
  ]);
  assert.deepEqual(puestos.map((p) => p.carriles), [1, 1]);
});

test('lo que cae fuera del horario se marca, incluida la comida', () => {
  const fuera = fueraDeHorario([[540, 840], [960, 1200]], { desde: 480, hasta: 1260 });
  assert.deepEqual(fuera, [[480, 540], [840, 960], [1200, 1260]]);
});

test('quien no trabaja ese día tiene la columna entera fuera de horario', () => {
  assert.deepEqual(fueraDeHorario([], { desde: 540, hasta: 1200 }), [[540, 1200]]);
});

test('las rayas son las horas en punto, de la primera a la última', () => {
  const lineas = lineasDeHoras({ desde: 540, hasta: 720 });
  assert.deepEqual(lineas.map((l) => l.etiqueta), ['09:00', '10:00', '11:00', '12:00']);
  assert.equal(lineas[0].arriba, 0);
  assert.equal(lineas[3].arriba, 100);
});

test('cada cita cae donde le toca, en tanto por ciento del alto', () => {
  const rango = { desde: 540, hasta: 1140 };          // de 9:00 a 19:00
  const { arriba, alto } = alturaDe(600, 645, rango);  // de 10:00 a 10:45
  assert.equal(Math.round(arriba), 10);
  assert.equal(Math.round(alto * 100) / 100, 7.5);
});

test('lo que se sale del calendario se recorta, no se desborda', () => {
  const rango = { desde: 540, hasta: 1140 };
  const { arriba, alto } = alturaDe(480, 1260, rango);
  assert.equal(arriba, 0);
  assert.equal(alto, 100);
});
