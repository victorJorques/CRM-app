// ---------------------------------------------------------------------------
// Correo, sin librerias: un cliente SMTP para mandar y uno IMAP para leer lo
// que llega. Con una contraseña de aplicacion de Gmail (o cualquier otro
// servidor) basta.
//
// Regla de oro: por correo NO se toca una cita si el remitente no cuadra con
// la ficha. Un correo es facil de falsificar; una agenda no se arregla sola.
// ---------------------------------------------------------------------------

import { connect } from 'node:tls';
import { contestar } from '../cerebro/index.js';
import { normalizarCorreo } from '../nucleo/clientes.js';

export function configurado() {
  return Boolean(process.env.CORREO_USUARIO && process.env.CORREO_CLAVE_APLICACION);
}

function abrir({ host, puerto, tiempo = 20000 }) {
  return new Promise((resolver, rechazar) => {
    const socket = connect({ host, port: puerto, servername: host }, () => resolver(socket));
    socket.setTimeout(tiempo, () => { socket.destroy(new Error(`${host} no contesta`)); });
    socket.once('error', rechazar);
  });
}

/** Lector de lineas con espera: "habla y dime cuando llegue lo que espero". */
function conversacion(socket) {
  let acumulado = '';
  const esperas = [];
  socket.setEncoding('utf8');
  socket.on('data', (trozo) => {
    acumulado += trozo;
    for (let i = esperas.length - 1; i >= 0; i -= 1) {
      if (esperas[i].condicion(acumulado)) {
        const texto = acumulado;
        acumulado = '';
        esperas.splice(i, 1)[0].resolver(texto);
      }
    }
  });
  return {
    esperar(condicion, tiempo = 20000) {
      return new Promise((resolver, rechazar) => {
        if (condicion(acumulado)) {
          const texto = acumulado;
          acumulado = '';
          resolver(texto);
          return;
        }
        const espera = { condicion, resolver };
        esperas.push(espera);
        setTimeout(() => {
          const i = esperas.indexOf(espera);
          if (i >= 0) { esperas.splice(i, 1); rechazar(new Error('El servidor de correo no contesta')); }
        }, tiempo);
      });
    },
    decir(linea) { socket.write(`${linea}\r\n`); },
  };
}

const codigo = (n) => (texto) => new RegExp(`^${n}[ -]`, 'm').test(texto.split(/\r?\n/).filter(Boolean).at(-1) ?? '');

function asuntoCodificado(asunto) {
  return /^[\x20-\x7E]*$/.test(asunto) ? asunto : `=?UTF-8?B?${Buffer.from(asunto, 'utf8').toString('base64')}?=`;
}

/** Manda un correo de texto plano. */
export async function enviar(para, texto, { asunto = null, config = null, enRespuestaA = null } = {}) {
  if (!configurado()) return { ok: false, motivo: 'correo-sin-configurar' };
  const usuario = process.env.CORREO_USUARIO;
  const host = process.env.CORREO_SMTP ?? 'smtp.gmail.com';
  const puerto = Number(process.env.CORREO_SMTP_PUERTO ?? 465);
  const socket = await abrir({ host, puerto });
  const charla = conversacion(socket);
  try {
    await charla.esperar(codigo(220));
    charla.decir('EHLO conserje');
    await charla.esperar(codigo(250));
    charla.decir('AUTH LOGIN');
    await charla.esperar(codigo(334));
    charla.decir(Buffer.from(usuario).toString('base64'));
    await charla.esperar(codigo(334));
    charla.decir(Buffer.from(process.env.CORREO_CLAVE_APLICACION).toString('base64'));
    await charla.esperar(codigo(235));
    charla.decir(`MAIL FROM:<${usuario}>`);
    await charla.esperar(codigo(250));
    charla.decir(`RCPT TO:<${para}>`);
    await charla.esperar(codigo(250));
    charla.decir('DATA');
    await charla.esperar(codigo(354));

    const nombre = config?.negocio?.nombre ?? 'Conserje';
    const cabeceras = [
      `From: ${asuntoCodificado(nombre)} <${usuario}>`,
      `To: ${para}`,
      `Subject: ${asuntoCodificado(asunto ?? `${nombre}: tu cita`)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ];
    if (enRespuestaA) {
      cabeceras.push(`In-Reply-To: ${enRespuestaA}`, `References: ${enRespuestaA}`);
    }
    const cuerpo = Buffer.from(texto, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    socket.write(`${cabeceras.join('\r\n')}\r\n\r\n${cuerpo}\r\n.\r\n`);
    await charla.esperar(codigo(250));
    charla.decir('QUIT');
    return { ok: true, canal: 'correo' };
  } finally {
    socket.end();
  }
}

// --- Leer (IMAP) ------------------------------------------------------------

function decodificarCabecera(valor) {
  return String(valor ?? '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (todo, juego, tipo, dato) => {
    try {
      if (tipo.toUpperCase() === 'B') return Buffer.from(dato, 'base64').toString('utf8');
      return deQuotedPrintable(dato.replace(/_/g, ' '));
    } catch { return todo; }
  });
}

/** quoted-printable son bytes, no caracteres: hay que armar el buffer y luego
 *  leerlo como UTF-8, o los acentos salen partidos. */
function deQuotedPrintable(texto) {
  const plano = texto.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < plano.length; i += 1) {
    if (plano[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(plano.slice(i + 1, i + 3))) {
      bytes.push(parseInt(plano.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(plano.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodificarCuerpo(texto, codificacion) {
  const tipo = (codificacion ?? '').toLowerCase();
  if (tipo === 'base64') return Buffer.from(texto.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (tipo === 'quoted-printable') return deQuotedPrintable(texto);
  return texto;
}

/** Saca de un correo crudo lo que necesitamos: quien, que asunto y que dice. */
export function analizarCorreo(crudo) {
  const corte = crudo.search(/\r?\n\r?\n/);
  const cabeceras = crudo.slice(0, corte < 0 ? crudo.length : corte);
  let cuerpo = corte < 0 ? '' : crudo.slice(corte).replace(/^\r?\n\r?\n/, '');
  const plegadas = cabeceras.replace(/\r?\n[ \t]+/g, ' ');
  const buscar = (nombre) => {
    const m = new RegExp(`^${nombre}:\\s*(.*)$`, 'im').exec(plegadas);
    return m ? m[1].trim() : '';
  };
  const de = buscar('From');
  const correo = normalizarCorreo((/<([^>]+)>/.exec(de)?.[1]) ?? de.split(/\s+/).at(-1));
  const nombre = decodificarCabecera(de.replace(/<[^>]*>/, '').replace(/^"|"$/g, '').trim()) || null;
  const tipoContenido = buscar('Content-Type');

  const limite = /boundary="?([^";]+)"?/i.exec(tipoContenido)?.[1];
  if (limite) {
    const partes = cuerpo.split(`--${limite}`);
    const plana = partes.find((p) => /content-type:\s*text\/plain/i.test(p));
    const elegida = plana ?? partes.find((p) => /content-type:\s*text\//i.test(p)) ?? '';
    const corteParte = elegida.search(/\r?\n\r?\n/);
    const cabParte = elegida.slice(0, corteParte < 0 ? 0 : corteParte);
    cuerpo = decodificarCuerpo(
      corteParte < 0 ? '' : elegida.slice(corteParte).replace(/^\r?\n\r?\n/, ''),
      /content-transfer-encoding:\s*(\S+)/i.exec(cabParte)?.[1],
    );
    if (/content-type:\s*text\/html/i.test(cabParte)) cuerpo = cuerpo.replace(/<[^>]+>/g, ' ');
  } else {
    cuerpo = decodificarCuerpo(cuerpo, buscar('Content-Transfer-Encoding'));
  }

  // Fuera la parte citada: lo que interesa es lo que ha escrito ahora.
  const limpio = cuerpo
    .split(/\r?\n/)
    .reduce((lineas, linea) => {
      if (/^\s*>/.test(linea)) return lineas;
      // El acento de "escribió" no siempre llega entero, asi que no lo miramos.
      if (/^\s*El .{0,120}escrib/i.test(linea) || /^\s*On .{0,120}wrote:/i.test(linea)
        || /^-{2,}\s*Mensaje original/i.test(linea)) {
        lineas.corte = true;
        return lineas;
      }
      if (!lineas.corte) lineas.push(linea);
      return lineas;
    }, Object.assign([], { corte: false }))
    .join('\n').trim();

  return {
    de: correo,
    nombre,
    asunto: decodificarCabecera(buscar('Subject')),
    id: buscar('Message-ID') || null,
    texto: limpio.slice(0, 4000),
  };
}

/** Mira el buzon, contesta lo que haya y marca como leido lo que atiende. */
export async function revisarBuzon(estado, { maximo = 10 } = {}) {
  if (!configurado()) return { ok: false, motivo: 'correo-sin-configurar', atendidos: 0 };
  const { db, config } = estado;
  const host = process.env.CORREO_IMAP ?? 'imap.gmail.com';
  const puerto = Number(process.env.CORREO_IMAP_PUERTO ?? 993);
  const socket = await abrir({ host, puerto });
  const charla = conversacion(socket);
  const atendidos = [];
  let etiqueta = 0;
  const mandar = async (orden, tiempo = 25000) => {
    etiqueta += 1;
    const marca = `a${etiqueta}`;
    charla.decir(`${marca} ${orden}`);
    return charla.esperar((t) => new RegExp(`^${marca} (OK|NO|BAD)`, 'm').test(t), tiempo);
  };

  try {
    await charla.esperar((t) => /^\* OK/m.test(t));
    const entrada = await mandar(`LOGIN "${process.env.CORREO_USUARIO}" "${process.env.CORREO_CLAVE_APLICACION}"`);
    if (!/OK/.test(entrada)) throw new Error('El servidor de correo no acepta el usuario o la contraseña');
    await mandar('SELECT INBOX');
    const busqueda = await mandar('UID SEARCH UNSEEN');
    const uids = (/^\* SEARCH([\d ]*)/m.exec(busqueda)?.[1] ?? '').trim().split(/\s+/).filter(Boolean).slice(0, maximo);

    for (const uid of uids) {
      const respuesta = await mandar(`UID FETCH ${uid} (BODY.PEEK[])`);
      const inicio = respuesta.indexOf('}\r\n');
      const crudo = inicio < 0 ? respuesta : respuesta.slice(inicio + 3);
      const correo = analizarCorreo(crudo);
      if (!correo.de) { await mandar(`UID STORE ${uid} +FLAGS (\\Seen)`); continue; }
      if (correo.de === normalizarCorreo(process.env.CORREO_USUARIO)) {
        await mandar(`UID STORE ${uid} +FLAGS (\\Seen)`);
        continue;
      }
      const resultado = await contestar({
        db,
        config,
        canal: 'correo',
        externo: correo.de,
        texto: correo.texto || `(sin texto) ${correo.asunto}`,
        contacto: { correo: correo.de, nombre: correo.nombre },
      });
      if (resultado.texto) {
        await enviar(correo.de, resultado.texto, {
          asunto: correo.asunto?.startsWith('Re:') ? correo.asunto : `Re: ${correo.asunto || config.negocio.nombre}`,
          config,
          enRespuestaA: correo.id,
        });
      }
      await mandar(`UID STORE ${uid} +FLAGS (\\Seen)`);
      atendidos.push(correo.de);
    }
    await mandar('LOGOUT', 5000).catch(() => {});
    return { ok: true, atendidos: atendidos.length, de: atendidos };
  } finally {
    socket.end();
  }
}
