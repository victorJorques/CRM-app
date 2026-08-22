// El panel por dentro. Sin librerias: pedir datos, pintar, volver a pedir.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
let estado = null;
let diaActual = null;   // se fija con la zona horaria del negocio al arrancar
let conversacionAbierta = null;
let clienteAbierto = null;

const escapar = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    headers: { 'content-type': 'application/json' },
    ...opciones,
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  if (respuesta.status === 401) { mostrarEntrada(); throw new Error('Hay que entrar'); }
  return respuesta.json();
}

const dinero = (centimos) => (centimos == null ? '' : `${(centimos / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`);

// Las horas se pintan en la hora del NEGOCIO, no en la del ordenador que mira.
// Si no, el panel dice una hora y el bot le dice otra al cliente, que es la
// mejor manera de que alguien se plante un día a las nueve y no le toque.
let zonaNegocio = Intl.DateTimeFormat().resolvedOptions().timeZone;
let formatoHora = null;
let formatoFecha = null;
let formatoCorta = null;
let formatoDia = null;

function prepararFormatos(zona) {
  zonaNegocio = zona || zonaNegocio;
  formatoHora = new Intl.DateTimeFormat('es-ES', { timeZone: zonaNegocio, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  formatoFecha = new Intl.DateTimeFormat('es-ES', { timeZone: zonaNegocio, weekday: 'long', day: 'numeric', month: 'long' });
  formatoCorta = new Intl.DateTimeFormat('es-ES', { timeZone: zonaNegocio, day: '2-digit', month: '2-digit' });
  formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: zonaNegocio, year: 'numeric', month: '2-digit', day: '2-digit' });
}
prepararFormatos(zonaNegocio);

const horaDe = (ms) => formatoHora.format(new Date(ms));
// Sin la coma que mete el formato del sistema: el bot dice "lunes 24 de
// agosto" y el panel debe decir lo mismo.
const fechaDe = (ms) => formatoFecha.format(new Date(ms)).replace(',', '');
const fechaCorta = (ms) => formatoCorta.format(new Date(ms));
/** El día de hoy según el negocio, en formato 2026-08-24. */
const hoyDelNegocio = () => formatoDia.format(new Date());

function sumarDiasClave(clave, salto) {
  const [anio, mes, dia] = clave.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + salto);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// --- Entrar -----------------------------------------------------------------

function mostrarEntrada() {
  $('#entrada').classList.remove('oculto');
  $('#app').classList.add('oculto');
}

$('#formEntrada').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const respuesta = await fetch('/api/entrar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clave: $('#clave').value }),
  }).then((r) => r.json());
  if (respuesta.ok) { $('#errorEntrada').textContent = ''; arrancar(); }
  else $('#errorEntrada').textContent = respuesta.error ?? 'No ha entrado.';
});

// --- Navegacion -------------------------------------------------------------

$$('nav button').forEach((boton) => boton.addEventListener('click', () => {
  $$('nav button').forEach((b) => b.classList.toggle('activa', b === boton));
  $$('.vista').forEach((v) => v.classList.add('oculto'));
  $(`#vista-${boton.dataset.vista}`).classList.remove('oculto');
  if (boton.dataset.vista === 'bandeja') cargarBandeja();
  if (boton.dataset.vista === 'fichas') cargarClientes();
  if (boton.dataset.vista === 'avisos') cargarAvisos();
  if (boton.dataset.vista === 'simulador') cargarSimClientes();
}));

// --- Agenda -----------------------------------------------------------------

async function cargarAgenda() {
  $('#dia').value = diaActual;
  const dia = await pedir(`/api/agenda?dia=${diaActual}`);
  $('#cifrasDia').innerHTML = `
    <div class="cifra"><b>${dia.total}</b><span>${dia.total === 1 ? 'cita' : 'citas'}</span></div>
    <div class="cifra"><b>${dinero(dia.previstoCentimos) || '—'}</b><span>previsto</span></div>
    <div class="cifra"><b>${dinero(dia.ingresosCentimos) || '—'}</b><span>cerrado</span></div>
    <div class="cifra"><b>${dia.abierto ? 'Abierto' : 'Cerrado'}</b><span>${dia.motivoCierre ?? fechaDe(Date.parse(`${diaActual}T12:00:00Z`))}</span></div>`;

  $('#agenda').innerHTML = dia.recursos.map((recurso) => {
    const tramos = recurso.tramos.map((t) => t.join('–')).join(' · ')
      || (recurso.ausencia ? escapar(recurso.ausencia) : 'no trabaja');
    const citas = recurso.citas.length
      ? recurso.citas.map(pintarCita).join('')
      : '<p class="vacio">Sin citas.</p>';
    return `<div class="recurso"><h3>${escapar(recurso.nombre)} <small>${escapar(tramos)}</small></h3>${citas}</div>`;
  }).join('') || '<p class="vacio">Nadie trabaja este día.</p>';

  $$('#agenda [data-accion]').forEach((boton) => boton.addEventListener('click', accionDeCita));
}

function pintarCita(cita) {
  const acciones = ['reservada', 'confirmada'].includes(cita.estado)
    ? `<button data-accion="atendida" data-id="${cita.id}">Vino</button>
       <button data-accion="no_vino" data-id="${cita.id}">No vino</button>
       <button data-accion="anular" data-id="${cita.id}">Anular</button>`
    : `<small class="estado">${escapar(cita.estado.replace('_', ' '))}</small>`;
  return `<div class="cita ${cita.estado}">
    <div class="hora">${horaDe(cita.inicio)}<br><small class="estado">${horaDe(cita.fin_visible)}</small></div>
    <div>
      <div class="quien">${escapar(cita.cliente_nombre || cita.cliente_telefono || 'Sin nombre')}</div>
      <div class="que">${escapar(cita.servicio_nombre)}${cita.precio_centimos ? ` · ${dinero(cita.precio_centimos)}` : ''}${cita.canal ? ` · ${escapar(cita.canal)}` : ''}${cita.notas ? ` · ${escapar(cita.notas)}` : ''}</div>
    </div>
    <div class="acciones">${acciones}</div>
  </div>`;
}

async function accionDeCita(evento) {
  const { accion, id } = evento.target.dataset;
  if (accion === 'anular') {
    if (!confirm('¿Anular esta cita?')) return;
    await pedir(`/api/citas/${id}/anular`, { method: 'POST', cuerpo: { motivo: 'desde el panel' } });
  } else {
    await pedir(`/api/citas/${id}/estado`, { method: 'POST', cuerpo: { estado: accion } });
  }
  cargarAgenda();
  cargarEstado();
}

$('#dia').addEventListener('change', (e) => { diaActual = e.target.value; cargarAgenda(); });
$('#diaAnterior').addEventListener('click', () => moverDia(-1));
$('#diaSiguiente').addEventListener('click', () => moverDia(1));
$('#diaHoy').addEventListener('click', () => { diaActual = hoyDelNegocio(); cargarAgenda(); });

function moverDia(salto) {
  diaActual = sumarDiasClave(diaActual, salto);
  cargarAgenda();
}

// --- Nueva cita -------------------------------------------------------------

$('#nuevaCita').addEventListener('click', async () => {
  const servicios = estado.servicios.map((s) => `<option value="${s.id}">${escapar(s.nombre)} (${s.duracion} min)</option>`).join('');
  $('#formDialogo').innerHTML = `
    <h3>Nueva cita</h3>
    <p><label>Servicio<br><select id="ncServicio">${servicios}</select></label></p>
    <p><label>Día<br><input type="date" id="ncDia" value="${diaActual}"></label></p>
    <p><label>Hueco<br><select id="ncHueco"><option>Elige servicio y día</option></select></label></p>
    <p><label>Teléfono<br><input id="ncTelefono" placeholder="+34600111222"></label></p>
    <p><label>Nombre<br><input id="ncNombre" placeholder="Nombre del cliente"></label></p>
    <p class="error" id="ncError"></p>
    <menu><button value="cancelar">Cancelar</button><button id="ncGuardar" class="principal" value="guardar">Reservar</button></menu>`;
  $('#dialogo').showModal();
  const cargarHuecos = async () => {
    const datos = await pedir(`/api/huecos?servicio=${$('#ncServicio').value}&dia=${$('#ncDia').value}&dias=1&limite=40`);
    $('#ncHueco').innerHTML = datos.huecos.length
      ? datos.huecos.map((h) => `<option value="${h.inicio}|${h.recursoId}">${h.hora} · ${escapar(h.recursoNombre)}</option>`).join('')
      : '<option value="">No queda nada libre ese día</option>';
  };
  $('#ncServicio').addEventListener('change', cargarHuecos);
  $('#ncDia').addEventListener('change', cargarHuecos);
  await cargarHuecos();
  $('#ncGuardar').addEventListener('click', async (evento) => {
    evento.preventDefault();
    const [inicio, recurso] = ($('#ncHueco').value || '').split('|');
    if (!inicio) { $('#ncError').textContent = 'Elige un hueco.'; return; }
    if (!$('#ncTelefono').value.trim() && !$('#ncNombre').value.trim()) {
      $('#ncError').textContent = 'Pon al menos un teléfono o un nombre, o luego no sabrás de quién es.';
      return;
    }
    const resultado = await pedir('/api/citas', {
      method: 'POST',
      cuerpo: {
        servicio: $('#ncServicio').value,
        inicio: Number(inicio),
        recurso,
        cliente: { telefono: $('#ncTelefono').value, nombre: $('#ncNombre').value },
      },
    });
    if (!resultado.ok) {
      const explicaciones = {
        ocupado: 'Esa hora ya está cogida.',
        'fuera-de-horario': 'A esa hora no se trabaja.',
        cerrado: 'Ese día está cerrado.',
        'sin-contacto': 'Pon al menos un teléfono o un nombre.',
        'demasiado-justo': 'Es demasiado justo para la antelación que pide la configuración.',
      };
      $('#ncError').textContent = explicaciones[resultado.motivo] ?? `No se ha podido: ${resultado.motivo}`;
      return;
    }
    $('#dialogo').close();
    cargarAgenda();
    cargarEstado();
  });
});

// --- Bandeja ----------------------------------------------------------------

async function cargarBandeja() {
  const conversaciones = await pedir('/api/bandeja');
  $('#conversaciones').innerHTML = conversaciones.length ? conversaciones.map((c) => `
    <div class="fila ${c.id === conversacionAbierta ? 'activa' : ''}" data-id="${c.id}">
      <b>${escapar(c.cliente_nombre || c.externo)}${c.sin_leer ? ' •' : ''}</b>
      <span>${escapar(c.ultimo_texto ?? '')}</span>
      <span class="marca-canal">${escapar(c.canal)}${c.estado === 'humano' ? ' · lo llevas tú' : ''}</span>
    </div>`).join('') : '<p class="vacio">Nada por ahora.</p>';
  $$('#conversaciones .fila').forEach((fila) => fila.addEventListener('click', () => abrirConversacion(fila.dataset.id)));
}

async function abrirConversacion(id) {
  conversacionAbierta = id;
  const datos = await pedir(`/api/bandeja/${id}`);
  const turnos = datos.mensajes.map((m) => `<div class="turno ${m.autor}">${escapar(m.texto)}</div>`).join('');
  const humano = datos.conversacion.estado === 'humano';
  $('#conversacion').innerHTML = `
    <div class="barra">
      <b>${escapar(datos.cliente?.nombre || datos.conversacion.externo)}</b>
      <span class="etiqueta">${escapar(datos.conversacion.canal)}</span>
      <span class="separador"></span>
      <button id="cambiarMando">${humano ? 'Que siga el bot' : 'Contesto yo'}</button>
    </div>
    ${datos.cliente ? `<p class="nota">${datos.cliente.atendidas} visitas · ${dinero(datos.cliente.gastoCentimos)} · ${datos.cliente.noVino} ausencias</p>` : ''}
    <div class="chat">${turnos}</div>
    <form class="escribir" id="responder">
      <input id="respuesta" placeholder="Escribe y contesta tú…" autocomplete="off">
      <button class="principal">Enviar</button>
    </form>`;
  $('#cambiarMando').addEventListener('click', async () => {
    await pedir(`/api/bandeja/${id}/mando`, { method: 'POST', cuerpo: { estado: humano ? 'bot' : 'humano' } });
    abrirConversacion(id);
    cargarBandeja();
  });
  $('#responder').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = $('#respuesta').value.trim();
    if (!texto) return;
    const resultado = await pedir(`/api/bandeja/${id}/responder`, { method: 'POST', cuerpo: { texto } });
    if (resultado.enviado && !resultado.enviado.ok) {
      alert(`Queda apuntado, pero no ha salido por ${resultado.enviado.motivo === 'sin-canal' ? 'ningún canal configurado' : resultado.enviado.motivo}.`);
    }
    abrirConversacion(id);
    cargarBandeja();
  });
  cargarEstado();
}

// --- Fichas -----------------------------------------------------------------

async function cargarClientes() {
  const lista = await pedir(`/api/clientes?busqueda=${encodeURIComponent($('#buscarCliente').value)}`);
  $('#clientes').innerHTML = lista.length ? lista.map((c) => `
    <div class="fila ${c.id === clienteAbierto ? 'activa' : ''}" data-id="${c.id}">
      <b>${escapar(c.nombre || 'Sin nombre')}</b>
      <span>${escapar(c.telefono ?? c.correo ?? '')} · ${c.citas} citas</span>
    </div>`).join('') : '<p class="vacio">Nadie todavía.</p>';
  $$('#clientes .fila').forEach((fila) => fila.addEventListener('click', () => abrirFicha(fila.dataset.id)));
}

async function abrirFicha(id) {
  clienteAbierto = id;
  const ficha = await pedir(`/api/clientes/${id}`);
  $('#ficha').innerHTML = `
    <h3>${escapar(ficha.nombre || 'Sin nombre')}</h3>
    <p class="resumen">${escapar(ficha.telefono ?? '')} ${escapar(ficha.correo ?? '')}</p>
    <div class="cifras">
      <div class="cifra"><b>${ficha.atendidas}</b><span>visitas</span></div>
      <div class="cifra"><b>${dinero(ficha.gastoCentimos) || '—'}</b><span>gastado</span></div>
      <div class="cifra"><b>${ficha.noVino}</b><span>ausencias</span></div>
      <div class="cifra"><b>${ficha.proxima ? horaDe(ficha.proxima.inicio) : '—'}</b><span>${ficha.proxima ? fechaDe(ficha.proxima.inicio) : 'sin próxima cita'}</span></div>
    </div>
    <p><label>Notas internas<br><textarea id="notasCliente" rows="3" style="width:100%">${escapar(ficha.notas ?? '')}</textarea></label>
      <button id="guardarNotas">Guardar notas</button></p>
    <table>${ficha.citas.map((c) => `<tr>
      <td>${fechaDe(c.inicio)} ${horaDe(c.inicio)}</td>
      <td>${escapar(c.servicio_nombre)}</td>
      <td>${escapar(c.estado.replace('_', ' '))}</td>
      <td style="text-align:right">${dinero(c.precio_centimos)}</td></tr>`).join('') || '<tr><td>Sin historial</td></tr>'}</table>`;
  $('#guardarNotas').addEventListener('click', async () => {
    await pedir(`/api/clientes/${id}`, { method: 'POST', cuerpo: { notas: $('#notasCliente').value } });
    $('#guardarNotas').textContent = 'Guardado';
    setTimeout(() => { $('#guardarNotas').textContent = 'Guardar notas'; }, 1500);
  });
}

$('#buscarCliente').addEventListener('input', () => cargarClientes());

// --- Avisos -----------------------------------------------------------------

async function cargarAvisos() {
  const [pendientes, aMano, inactivos, porCerrar] = await Promise.all([
    pedir('/api/recordatorios?estado=pendiente'),
    pedir('/api/recordatorios?estado=a_mano'),
    pedir('/api/inactivos'),
    pedir('/api/citas/por-cerrar'),
  ]);
  const bloque = (titulo, filas, vacio) => `
    <div class="recurso"><h3>${titulo}</h3>${filas.length ? filas.join('') : `<p class="vacio">${vacio}</p>`}</div>`;
  $('#avisos').innerHTML = [
    bloque('Por cerrar (¿vino o no vino?)', porCerrar.map((c) => `<div class="cita">
      <div class="hora">${horaDe(c.inicio)}</div>
      <div><div class="quien">${escapar(c.cliente_nombre || c.cliente_telefono)}</div><div class="que">${escapar(c.servicio_nombre)} · ${fechaDe(c.inicio)}</div></div>
      <div class="acciones"><button data-accion="atendida" data-id="${c.id}">Vino</button><button data-accion="no_vino" data-id="${c.id}">No vino</button></div>
    </div>`), 'Todo cerrado.'),
    bloque('Hay que mandarlo a mano', aMano.map((r) => `<div class="cita">
      <div class="hora">${escapar(r.tipo)}</div>
      <div><div class="quien">${escapar(r.cliente_nombre || r.cliente_telefono || '')}</div><div class="que">${escapar(r.detalle || 'sin canal configurado')}</div></div>
      <div class="acciones"><button data-accion="hecho" data-id="${r.id}">Hecho</button></div>
    </div>`), 'Nada pendiente.'),
    bloque('Programados', pendientes.map((r) => `<div class="cita">
      <div class="hora">${fechaCorta(r.cuando)}</div>
      <div><div class="quien">${escapar(r.cliente_nombre || '')}</div><div class="que">${escapar(r.tipo)}</div></div>
      <div class="acciones"><small class="estado">${escapar(r.estado)}</small></div>
    </div>`), 'Nada programado.'),
    bloque('Hace mucho que no vienen', inactivos.map((c) => `<div class="cita">
      <div class="hora">${c.ultimaVisita ? fechaCorta(c.ultimaVisita) : ''}</div>
      <div><div class="quien">${escapar(c.nombre || 'Sin nombre')}</div><div class="que">${escapar(c.telefono ?? '')}</div></div>
      <div class="acciones"></div>
    </div>`), 'Nadie por ahora.'),
  ].join('');
  $$('#avisos [data-accion]').forEach((boton) => boton.addEventListener('click', async (evento) => {
    const { accion, id } = evento.target.dataset;
    if (accion === 'hecho') await pedir(`/api/recordatorios/${id}/enviado`, { method: 'POST' });
    else await pedir(`/api/citas/${id}/estado`, { method: 'POST', cuerpo: { estado: accion } });
    cargarAvisos();
    cargarEstado();
  }));
}

// --- Simulador --------------------------------------------------------------

// El simulador escribe COMO alguien: o un cliente que ya está en las fichas
// —con su historial y sus citas— o alguien que llama por primera vez. Probar
// con un teléfono inventado es justo lo que hace que el bot conteste "no me
// consta ninguna cita" cuando el cliente jura que la tiene.
let simTelefono = null;

async function cargarSimClientes() {
  const lista = await pedir('/api/clientes?limite=60');
  const conTelefono = lista.filter((c) => c.telefono);
  $('#simCliente').innerHTML = [
    ...conTelefono.map((c) => `<option value="${escapar(c.telefono)}" data-id="${c.id}">${escapar(c.nombre || 'Sin nombre')} · ${escapar(c.telefono)}</option>`),
    '<option value="nuevo">Alguien que llama por primera vez</option>',
  ].join('');
  await elegirSimCliente();
}

async function elegirSimCliente() {
  const opcion = $('#simCliente').selectedOptions[0];
  if (!opcion) return;
  if (opcion.value === 'nuevo') {
    simTelefono = `+34600${String(Math.floor(Math.random() * 900000) + 100000)}`;
    $('#simFicha').textContent = `Nadie conocido: ${simTelefono}. El bot no tiene historial suyo.`;
  } else {
    simTelefono = opcion.value;
    const ficha = await pedir(`/api/clientes/${opcion.dataset.id}`);
    const proxima = ficha.proxima
      ? `tiene ${ficha.proxima.servicio_nombre} el ${fechaDe(ficha.proxima.inicio)} a las ${horaDe(ficha.proxima.inicio)}`
      : 'no tiene ninguna cita pendiente';
    $('#simFicha').textContent = `${ficha.nombre || 'Sin nombre'} ${proxima} · ${ficha.atendidas} visitas · ${dinero(ficha.gastoCentimos) || '0 €'}`;
  }
  await cargarSimHistorial();
}

/** Si ya se ha hablado con esa persona en el simulador, se sigue por donde iba. */
async function cargarSimHistorial() {
  $('#simChat').innerHTML = '';
  const conversaciones = await pedir('/api/bandeja?canal=simulador&limite=60');
  const suya = conversaciones.find((c) => c.externo === simTelefono);
  if (!suya) return;
  const datos = await pedir(`/api/bandeja/${suya.id}`);
  for (const mensaje of datos.mensajes) {
    if (mensaje.autor === 'sistema') añadirRastro(mensaje.texto);
    else añadirTurno(mensaje.autor === 'cliente' ? 'cliente' : 'bot', mensaje.texto);
  }
}

$('#simCliente').addEventListener('change', () => { elegirSimCliente(); });

$('#simForm').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const texto = $('#simTexto').value.trim();
  if (!texto || !simTelefono) return;
  $('#simTexto').value = '';
  añadirTurno('cliente', texto);
  const respuesta = await pedir('/api/simulador', {
    method: 'POST',
    cuerpo: { texto, externo: simTelefono, telefono: simTelefono },
  });
  if (respuesta.acciones?.length) {
    añadirRastro(respuesta.acciones.map((a) => a.herramienta).join(' → '));
  }
  añadirTurno('bot', respuesta.texto ?? '(el bot no contesta: lo lleva una persona)');
  elegirSimCliente();
  cargarEstado();
});

$('#simReiniciar').addEventListener('click', () => { cargarSimClientes(); });

function añadirTurno(quien, texto) {
  const div = document.createElement('div');
  div.className = `turno ${quien}`;
  div.textContent = texto;
  $('#simChat').append(div);
  $('#simChat').scrollTop = $('#simChat').scrollHeight;
}

function añadirRastro(texto) {
  const div = document.createElement('div');
  div.className = 'rastro';
  div.textContent = texto;
  $('#simChat').append(div);
}

// --- Estado general ---------------------------------------------------------

async function cargarEstado() {
  estado = await pedir('/api/estado');
  prepararFormatos(estado.negocio.zonaHoraria);
  if (!diaActual) diaActual = hoyDelNegocio();
  $('#negocio').textContent = estado.negocio.nombre;
  $('#cerebro').textContent = estado.cerebro === 'claude' ? 'con Claude' : 'cerebro de reglas';
  $('#contadorBandeja').textContent = estado.sinLeer || '';
  $('#contadorAvisos').textContent = (estado.porCerrar + estado.recordatorios) || '';
  document.title = `Conserje · ${estado.negocio.nombre}`;
}

async function arrancar() {
  try {
    await cargarEstado();
  } catch { return; }
  $('#entrada').classList.add('oculto');
  $('#app').classList.remove('oculto');
  await cargarAgenda();
  setInterval(() => { cargarEstado().catch(() => {}); }, 30000);
}

arrancar();
