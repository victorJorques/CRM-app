# Conectar Conserje con el mundo

Cuatro cosas que no puedo hacer por ti: son cuentas con tarjeta y verificación
de identidad, y hay que pasar por sus formularios en persona.

Van **en orden**: cada una funciona sin las siguientes. Puedes parar donde
quieras.

Todo lo que aquí se pide va al fichero `.env` (cópialo de `.env.example` si no
lo tienes). Después de tocar `.env`, para Conserje con Ctrl+C y vuelve a
arrancarlo.

---

## 1. Poner tu negocio · 5 minutos · imprescindible

```
node configurar.js
```

Eliges el tipo de negocio, pones nombre, teléfono y dirección, y ya tienes
`conserje.config.json`. Los servicios, los precios y el horario se cambian
luego en ese mismo fichero: es una lista normal, no hay que tocar código.

Al arrancar, Conserje revisa la configuración y te dice en castellano lo que
esté mal (un tramo que termina antes de empezar, alguien que no existe, una
hora imposible) antes de que lo descubra un cliente.

**Y ya está funcionando**: panel, agenda, fichas, bandeja y simulador. Lo demás
es abrir puertas al exterior.

---

## 2. La clave de Claude · 10 minutos · opcional

Sin ella, contesta el cerebro de reglas: coge citas, las mueve y las anula,
pero entiende menos frases raras.

1. Entra en **console.anthropic.com** y crea una cuenta.
2. Mete saldo (con 5 € vas sobrado para empezar).
3. **API Keys → Create Key**. Cópiala: solo se enseña una vez.
4. En `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Al arrancar verás `✓ Cerebro: Claude`. Si un día la API falla, Conserje se pasa
solo al cerebro de reglas y sigue contestando.

Para gastar menos, cambia el modelo en `conserje.config.json`:

```json
"modelo": { "nombre": "claude-sonnet-5" }
```

---

## 3. WhatsApp · 1 o 2 horas · lo que más se nota

Necesitas un **número que no esté dado de alta en la app normal de WhatsApp**
(ni en WhatsApp Business). Si usas tu número de siempre, lo pierdes en la app.

1. **developers.facebook.com** → *Mis apps* → **Crear app** → tipo *Empresa*.
2. Dentro de la app, añade el producto **WhatsApp**.
3. En *Configuración de la API* verás un número de pruebas. Sirve para probar;
   para el número de tu negocio, **Añadir número de teléfono** y verifícalo por
   SMS o llamada.
4. Apunta el **identificador del número de teléfono** (`Phone number ID`).
5. Genera un **token permanente**: *Configuración de la empresa → Usuarios del
   sistema* → crea uno con permiso `whatsapp_business_messaging` → *Generar
   token*.
6. En `.env`:

```
WHATSAPP_TOKEN=EAAG...
WHATSAPP_ID_NUMERO=123456789012345
WHATSAPP_VERIFICACION=una-palabra-que-te-inventes
WHATSAPP_SECRETO_APP=el-secreto-de-la-app     # en Configuración → Básica
```

7. **El webhook.** Meta necesita llegar a tu Conserje desde fuera. Si lo tienes
   en tu ordenador, abre un túnel:

```
npx cloudflared tunnel --url http://localhost:4180
```

   Te dará una dirección `https://algo.trycloudflare.com`. En la app de Meta:
   *WhatsApp → Configuración → Webhooks → Editar*:

   - **URL de devolución de llamada**: `https://algo.trycloudflare.com/webhook/whatsapp`
   - **Token de verificación**: el mismo `WHATSAPP_VERIFICACION` de arriba
   - Suscríbete al campo **messages**

8. Escríbele al número desde tu móvil. Debería contestarte.

> El secreto de la app no es opcional de verdad: sin él, Conserje no puede
> comprobar que lo que llega viene de Meta. Ponlo.

---

## 4. Correo · 30 minutos · opcional

Con Gmail hace falta una **contraseña de aplicación** (no vale la tuya).

1. Activa la verificación en dos pasos en tu cuenta de Google.
2. **myaccount.google.com/apppasswords** → crea una para «Conserje».
3. En `.env`:

```
CORREO_USUARIO=citas@tunegocio.com
CORREO_CLAVE_APLICACION=abcd efgh ijkl mnop
CORREO_SMTP=smtp.gmail.com
CORREO_SMTP_PUERTO=465
CORREO_IMAP=imap.gmail.com
CORREO_IMAP_PUERTO=993
```

Con otro proveedor, cambia los cuatro últimos valores por los suyos.

Conserje mira el buzón cada dos minutos, contesta lo que llega y marca como
leído lo que ha atendido.

> **Por correo no se toca una cita si el remitente no cuadra con la ficha.** Un
> correo es fácil de falsificar y una agenda no se arregla sola: si escribe una
> dirección que no conocemos, se le atiende como a alguien nuevo, no como al
> dueño de una cita existente.

---

## 5. Llamadas · 30 minutos · opcional

1. Crea una cuenta en **twilio.com** y mete saldo.
2. Compra un número español con capacidad de **voz** (3–5 € al mes).
3. En `.env`:

```
TWILIO_SID=AC...
TWILIO_TOKEN=...
TWILIO_NUMERO=+34...
CONSERJE_URL_PUBLICA=https://algo.trycloudflare.com
```

4. En la consola de Twilio, en el número comprado, sección *Voice*:
   **A call comes in** → *Webhook* → `https://algo.trycloudflare.com/webhook/llamada`
   (método POST).

Quien llame hablará con el mismo cerebro que en WhatsApp. Si la conversación
está en manos de una persona, la llamada se corta con un «te llamamos en un
momento» en vez de seguir sola.

---

## 6. Dejarlo funcionando siempre · opcional

En tu ordenador, Conserje deja de funcionar cuando lo apagas. Para tenerlo
siempre disponible, cualquier VPS de 5 € al mes vale:

1. Copia la carpeta al servidor e instala Node 22 o más nuevo.
2. Pon una clave de panel de verdad en `.env`:

```
CONSERJE_CLAVE=una-clave-larga-y-tuya
CONSERJE_SECRETO=otra-cadena-larga-al-azar
```

   Sin `CONSERJE_CLAVE`, el panel solo se abre desde el propio ordenador. Es a
   propósito: más vale no llegar que llegar abierto.

3. Arráncalo como servicio (systemd, pm2, lo que uses) y ponle un dominio con
   HTTPS por delante. Esa dirección es la que va en los webhooks, en vez del
   túnel.

---

## Si algo no va

| Lo que ves | Qué suele ser |
|---|---|
| `No encuentro conserje.config.json` | Ejecuta `node configurar.js`. |
| `La configuración tiene problemas` | Lo dice en castellano y con el nombre del campo. Arréglalo y arranca otra vez. |
| `El puerto 4180 ya está ocupado` | Tienes otro Conserje abierto, o cambia `CONSERJE_PUERTO`. |
| WhatsApp no contesta | Mira que el webhook esté suscrito a **messages** y que el túnel siga abierto (cambia de dirección cada vez que lo reinicias). |
| El correo no entra | Contraseña de aplicación, no la de tu cuenta. Y comprueba que el IMAP esté activado en tu proveedor. |
| Contesta más seco de lo normal | Te has quedado sin saldo o sin clave: está tirando del cerebro de reglas. |
