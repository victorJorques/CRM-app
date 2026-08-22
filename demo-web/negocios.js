// Los negocios que se pueden ver en la demostración. Son las mismas plantillas
// que se reparten con Conserje, metidas en el fichero para que la página no
// tenga que pedir nada por la red.
import peluqueria from '../plantillas/peluqueria.json' with { type: 'json' };
import dentista from '../plantillas/dentista.json' with { type: 'json' };
import taller from '../plantillas/taller.json' with { type: 'json' };
import fisioterapia from '../plantillas/fisioterapia.json' with { type: 'json' };
import asesoria from '../plantillas/asesoria.json' with { type: 'json' };

export const NEGOCIOS = [
  { id: 'peluqueria', etiqueta: 'Peluquería', config: peluqueria },
  { id: 'clinica', etiqueta: 'Clínica dental', config: dentista },
  { id: 'taller', etiqueta: 'Taller', config: taller },
  { id: 'fisioterapia', etiqueta: 'Fisioterapia', config: fisioterapia },
  { id: 'asesoria', etiqueta: 'Asesoría', config: asesoria },
];
