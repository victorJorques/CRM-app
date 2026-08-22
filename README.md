# Conserje

Un CRM con recepcionista dentro. Coge las citas, lleva las fichas y contesta
por WhatsApp, correo y teléfono. Sirve para cualquier negocio que trabaje con
cita previa: peluquería, clínica, taller, fisioterapia, asesoría… Lo que
cambia de un negocio a otro está en un fichero de configuración, no en el
código.

```
node configurar.js     # elige tu tipo de negocio y pon tus datos (2 min)
node sembrar.js --borrar   # una semana de citas de ejemplo
node arrancar.js       # levanta el panel
→ http://localhost:4180
```

Sin dependencias: solo hace falta **Node 22.5 o más nuevo**. `npm install` no
descarga nada porque no hay nada que descargar; la base de datos (SQLite) viene
dentro de Node.

---

## Qué hace ya, sin dar de alta nada

| | |
|---|---|
| **Agenda** | Por día y por persona (o silla, box, mesa, elevador…). Crear, mover, anular, marcar quién vino y quién no. |
| **Fichas de cliente** | Se crean solas con el primer mensaje. Historial, gasto acumulado, ausencias y notas internas. |
| **Bandeja única** | WhatsApp, correo, llamadas y panel en la misma lista. Si entras tú a contestar, el bot se aparta. |
| **Motor de huecos** | Horarios partidos, festivos, cierres del negocio, vacaciones o bajas de una sola persona, duración y margen por servicio, varios recursos, y el fin de semana en que cambia la hora. |
| **Recordatorios** | Aviso la víspera, repesca de quien no vino y lista de quien lleva meses sin aparecer. |
| **Simulador** | Escríbele como si fueras un cliente. Lo que pasa ahí es real y queda guardado. |
| **Cerrado por fuera** | Panel con clave, sesión firmada y freno a la fuerza bruta; webhooks con firma comprobada; y por correo no se toca una cita si el remitente no cuadra. |
| **Tus datos son tuyos** | `node exportar.js` saca clientes, citas y mensajes a CSV y copia la base entera. |

## Cómo habla

Copiado de una ejecución real. Ninguna hora está escrita a mano: todas salen
del motor de agenda.

```
cliente > buenas, quiero unas mechas el lunes por la mañana
bot     > El lunes 24 de agosto tengo 09:00, 09:15, 09:30 y 09:45. ¿Cuál te viene mejor?
cliente > a las 10:30
bot     > Perfecto: mechas con Ana el lunes 24 de agosto a las 10:30, 85 €. ¿Te la confirmo?
cliente > sí, confirmo
bot     > Hecho, Rocío: Mechas con Ana, lunes 24 de agosto a las 10:30. Te mando un recordatorio el día de antes.
```

El bot **no puede inventarse un hueco**. Solo ofrece lo que sale del motor de
agenda, y al reservar se vuelve a comprobar dentro de una transacción: si la
hora ya no está, la reserva se rechaza. Ante una queja, una reclamación o algo
que no entiende, se aparta y avisa a una persona.

### Dos cerebros

- **Con Claude** (si pones `ANTHROPIC_API_KEY`): entiende cualquier forma de
  decir las cosas.
- **De reglas** (sin clave ninguna): más seco, pero entiende castellano de
  verdad —«el lunes por la mañana», «a las 5 y media», «anúlamela»— y usa
  exactamente las mismas nueve herramientas.

Si la API se cae a media tarde, la conversación sigue con el cerebro de reglas
y queda apuntado en el registro. Un cliente no se queda sin respuesta porque
falle una API.

## Tu negocio, en un fichero

Todo lo que distingue un negocio de otro vive en `conserje.config.json`:

```jsonc
{
  "negocio":  { "nombre": "Peluquería Ana", "zonaHoraria": "Europe/Madrid" },
  "vocabulario": { "cita": "cita", "recurso": "profesional" },   // o "visita"/"doctor", "sesión"/"fisio"…
  "horario":  { "lunes": [["09:00","14:00"], ["16:00","20:00"]], "domingo": [] },
  "festivos": ["2026-12-25"],
  "cierres":  [{ "desde": "2026-08-01", "hasta": "2026-08-15", "motivo": "vacaciones" }],   // cierra el negocio
  "servicios": [
    { "nombre": "Mechas", "duracionMinutos": 120, "precio": 85, "recursos": ["ana"] }
  ],
  "recursos": [
    { "nombre": "Ana", "ausencias": [{ "desde": "2026-09-07", "hasta": "2026-09-13", "motivo": "vacaciones" }] },
    { "nombre": "Luis" }                                    // Luis sigue trabajando esos días
  ]
}
```

Hay seis plantillas listas en `plantillas/`: peluquería, clínica dental,
taller, fisioterapia, asesoría y una genérica. `node configurar.js` te copia la
que elijas y te pregunta los cuatro datos que hacen falta.

El **vocabulario** manda en cómo habla: donde una peluquería dice «tu cita con
Ana», una clínica dice «tu visita con la Dra. Gómez» y un taller dice «tu cita
en el elevador 2». Los **recursos** son personas o cosas, lo que haga falta
reservar; cada uno puede tener su propio horario, sus vacaciones (`ausencias`) y
atender a más de uno a la vez (`capacidad`).

## Lo que te toca a ti

Cuatro cosas que piden tarjeta o verificación de identidad, así que hay que
pasar por sus formularios. Van en orden y cada una funciona sin las siguientes.
El paso a paso está en **[CONECTAR.md](CONECTAR.md)**.

1. **Poner tu negocio** (5 min) · `node configurar.js`. Es lo único imprescindible.
2. **La clave de Claude** (10 min) · sin ella funciona con el cerebro de reglas.
3. **WhatsApp** (1-2 h) · lo más pesado y lo que más se nota.
4. **Correo y llamadas** (1 h) · opcionales y por separado.

## Lo que cuesta

| Concepto | Aproximado | Nota |
|---|---|---|
| Cerebro de reglas | 0 € | Es el que va sin clave. |
| Modelo de Claude | 0,10–0,20 € | Por conversación completa hasta cerrar una cita. |
| WhatsApp (Meta) | ~0 € | Responder a quien escribe primero. Escribir tú el primero se paga. |
| Llamadas (Twilio) | céntimos/min | Más 3–5 € al mes por el número. |
| Servidor | 5 €/mes | Un VPS cualquiera. En tu ordenador, gratis. |

Con quinientas conversaciones al mes, el modelo anda por 50–100 €. En
`conserje.config.json` puedes cambiar `modelo.nombre` por uno más barato.

## Lo que no hace

- **No cobra.** Ni pasarelas de pago ni señales: eso pide decisiones tuyas.
- **No entiende las notas de voz.** Las registra y avisa de que ha llegado un
  audio, pero no las transcribe.
- **No factura ni lleva contabilidad.**
- **No escribe el primero** por su cuenta: los recordatorios que no puede
  mandar quedan en el panel como tarea, nunca se dan por enviados.

## Por dentro

```
arrancar.js        comprueba lo que suele fallar y levanta el panel
configurar.js      asistente de configuración
sembrar.js         datos de ejemplo
demo.js            el sistema entero en la terminal, sin tocar tus datos

nucleo/            agenda, citas, clientes, bandeja, recordatorios, reloj,
                   configuración, tiempo (zona horaria y cambio de hora) y
                   redacción (todo lo que lee un cliente)
cerebro/           herramientas + los dos cerebros + el que entiende castellano
canales/           panel (HTTP y API), whatsapp, correo (SMTP e IMAP), llamadas
datos/             SQLite: esquema y acceso
panel/             la interfaz
plantillas/        seis tipos de negocio listos
exportar.js        saca los datos a CSV y copia la base
demo-web/          empaqueta todo en una página web que funciona sin servidor
pruebas/           331 pruebas
```

Más detalle en [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).

## Sacar tus datos

```
node exportar.js                          # todo, a copias/2026-08-22/
node exportar.js --desde 2026-01-01       # solo las citas de este año
node exportar.js --cliente +34600111222   # todo lo de una persona
```

Deja los CSV listos para abrir con doble clic (con los acentos bien) y una
copia de la base entera. **Esa copia es la que importa**: con ese único fichero
Conserje vuelve a arrancar exactamente como estaba. Guárdala donde no esté el
ordenador que la generó.

Lo de `--cliente` es para cuando alguien pregunta qué tienes suyo: sale su
ficha, sus citas y sus mensajes, y nada de nadie más.

## Verlo sin instalar nada

`demo-web/` empaqueta Conserje entero en una sola página web: el mismo motor de
agenda, las mismas herramientas y el mismo cerebro de reglas, con SQLite
compilado a JavaScript y la base en la memoria del navegador. No es una
maqueta: las citas se reservan de verdad, solo que al recargar se empieza de
cero y nada sale de tu ordenador.

```
npm install --no-save sql.js esbuild    # solo para construir la demostración
node demo-web/construir.mjs
→ demo-web/salida/conserje-demo.html    # ábrelo con doble clic
```

Conserje no depende de nada para funcionar; esas dos herramientas hacen falta
solo para construir la demostración, y por eso no están en `package.json`.

## Pruebas

```
npm test     # 331 pruebas, sin red y sin tocar tu base
```

Cubren el motor de huecos (incluido el fin de semana del cambio de hora), que
dos personas no se lleven el mismo hueco, las conversaciones enteras del
cerebro de reglas, la API del panel, las firmas de los webhooks y la lectura
de correos con acentos.
