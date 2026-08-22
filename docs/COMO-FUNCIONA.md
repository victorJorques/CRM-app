# Cómo funciona por dentro

Notas para quien tenga que tocar el código dentro de seis meses (o para ti
mismo, que serás otro para entonces).

## La idea

Hay una sola fuente de verdad sobre las horas —el **motor de agenda**— y todo
lo demás le pregunta. El bot no reserva: pide. El panel no calcula: pide. Eso
es lo que hace que un modelo de lenguaje pueda llevar la recepción sin poder
romper la agenda.

```
   WhatsApp ─┐
   correo   ─┤                                        ┌─ agenda (huecos)
   llamada  ─┼─→ bandeja ─→ cerebro ─→ herramientas ──┼─ citas
   panel    ─┘              (Claude o reglas)         ├─ clientes
                                                      └─ recordatorios
                                                            │
                                                          SQLite
```

## Reglas que sostienen todo

1. **Las horas solo salen de `nucleo/agenda.js`.** Ni el cerebro ni el panel
   inventan huecos. Si un modelo alucina una hora, `citas.reservar` la rechaza.
2. **Reservar es una transacción.** `BEGIN IMMEDIATE`, se vuelve a comprobar el
   hueco dentro y solo entonces se escribe. Dos personas no se llevan la misma
   hora ni preguntando a la vez.
3. **Los instantes se guardan en milisegundos UTC.** La hora local (la del
   negocio) solo aparece al hablar con personas, y la traducción vive entera en
   `nucleo/tiempo.js`, incluido el fin de semana del cambio de hora: las horas
   que no existen se descartan y las que existen dos veces se resuelven por la
   primera.
4. **El dinero, en céntimos.** Enteros, sin decimales flotando.
5. **Nunca se finge que un mensaje salió.** Si no hay canal, el recordatorio
   queda en estado `a_mano` y aparece en el panel como tarea.
6. **Lo que lee un cliente está en `nucleo/redaccion.js`.** Un solo sitio para
   cambiar el tono, y el vocabulario del negocio se aplica solo.

## Los dos cerebros

Ambos usan las mismas nueve herramientas de `cerebro/herramientas.js`
(`buscar_huecos`, `comprobar_hora`, `reservar`, `mis_citas`, `mover_cita`,
`anular_cita`, `info_negocio`, `guardar_nombre`, `escalar`).

- `cerebro/claude.js` — bucle de *tool use* contra la API. Si falla, tarda más
  de 25 s o se queda dando vueltas, lanza.
- `cerebro/reglas.js` — máquina de estados con la memoria guardada en la
  conversación (`paso`, `servicioId`, `dia`, `huecos`, `propuesta`). Entiende
  castellano con `cerebro/entender.js`.

`cerebro/index.js` elige, y si Claude falla se pasa a reglas y lo apunta en
`eventos`. Quien escribe no se entera.

## Detalles que cuestan de recordar

- Una cita ocupa `duracionMinutos + margenDespuesMinutos + margenEntreCitas`
  (`fin`), pero al cliente se le dice `fin_visible`, que es solo lo suyo.
- El último hueco de un tramo tiene que **caber entero** en el tramo; el margen
  de después sí puede pasarse de la hora de cierre (es recoger, no atender).
- Cuando varias personas pueden hacer un servicio a la misma hora, se ofrece
  una sola vez y se reparte hacia quien menos carga tiene ese día. El resto
  queda en `alternativas`.
- `capacidad` en un recurso permite atender a varios a la vez (mesas, salas).
- Hay dos formas de cerrar: `cierres` para el negocio entero y `ausencias`
  dentro de cada recurso para las vacaciones o la baja de uno solo. Las citas
  ya puestas **no** se borran al declarar unas vacaciones: siguen en la agenda
  para que alguien las mueva a mano, que es lo que hay que hacer.
- Si una conversación pasa a `humano`, el cerebro no vuelve a hablar en ella
  hasta que alguien la devuelva al bot desde el panel.
- Los mensajes entrantes se guardan **siempre**, aunque el bot calle.

## La base de datos

SQLite dentro de Node (`node:sqlite`, sin dependencias). Tablas: `clientes`,
`citas`, `conversaciones`, `mensajes`, `recordatorios`, `eventos`, `ajustes`.
El esquema está en `datos/db.js` como una lista de migraciones; para cambiarlo,
añade un elemento nuevo al final de `ESQUEMA` y no toques los anteriores:
`PRAGMA user_version` lleva la cuenta.

`eventos` es el registro de todo lo que pasa (citas, escalados, caídas del
modelo, errores de canal). Es lo primero que hay que mirar cuando algo raro
ocurre en producción.

## Seguridad

- Panel: clave + sesión firmada con HMAC y caducidad. Sin clave, solo desde el
  propio ordenador.
- WhatsApp: firma `X-Hub-Signature-256` comprobada sobre el cuerpo **crudo**.
- Twilio: firma `X-Twilio-Signature` sobre la URL pública y los parámetros.
- Correo: identifica por remitente; quien no cuadra no puede tocar citas
  ajenas.
- El `.env` y la base de datos están fuera del repositorio (`.gitignore`).

## Probar

```
npm test            # 295 pruebas, sin red
node demo.js        # el sistema entero en la terminal, base en memoria
node demo.js plantillas/taller.json   # con otro tipo de negocio
```

Las pruebas usan una base en memoria y un negocio de mentira
(`pruebas/ayuda.js`), con el reloj fijado en el viernes 21 de agosto de 2026
para que los resultados no cambien según el día.
