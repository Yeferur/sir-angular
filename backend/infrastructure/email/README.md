# Correo transaccional de SIR

SIR usa un relay SMTP autenticado para dos flujos:

- recuperación de contraseña;
- aviso individual al asesor cuando su horario semanal se publica o actualiza.

Las credenciales nunca deben guardarse en Git. Se configuran únicamente en el
`.env` del backend de cada entorno.

## Hostinger Email

Tener el VPS en Hostinger no crea por sí solo un buzón de salida. Confirma en
hPanel que el dominio tenga contratado y activo **Hostinger Email**. Si el buzón
es Titan o cPanel Email, usa los parámetros que muestre **Connect Apps &
Devices** para ese producto; el código de SIR no está acoplado a un proveedor.

Primero crea en hPanel una cuenta dedicada, por ejemplo
`notificaciones@viajesmaxitours.co`. Para Hostinger Email, la configuración
saliente habitual es:

```dotenv
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://sir.viajesmaxitours.co

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=false
SMTP_USER=notificaciones@viajesmaxitours.co
SMTP_PASS=CONTRASENA_DE_LA_CUENTA
SMTP_FROM="SIR Maxitours <notificaciones@viajesmaxitours.co>"
SMTP_TIMEOUT_MS=10000

# Cola persistente. El buzón actual permite 100 envíos en una ventana móvil de 24 h.
EMAIL_OUTBOX_ENABLED=true
EMAIL_OUTBOX_TOTAL_LIMIT_24H=100
EMAIL_OUTBOX_PASSWORD_RESERVE_24H=10
EMAIL_OUTBOX_SCHEDULE_LIMIT_24H=90
EMAIL_OUTBOX_INTERVAL_MS=10000
EMAIL_OUTBOX_BATCH_SIZE=5
EMAIL_OUTBOX_MAX_ATTEMPTS=24
EMAIL_OUTBOX_RETRY_BASE_SECONDS=60
EMAIL_OUTBOX_RETRY_MAX_SECONDS=21600
EMAIL_OUTBOX_CONFIG_RETRY_SECONDS=300
EMAIL_OUTBOX_PROVIDER_RETRY_SECONDS=3600
EMAIL_OUTBOX_LOCK_TIMEOUT_SECONDS=60
EMAIL_OUTBOX_PASSWORD_MIN_VALIDITY_SECONDS=120

# Protección de la recuperación pública.
PASSWORD_RESET_COOLDOWN_SECONDS=600
PASSWORD_RESET_IP_MAX_REQUESTS=5
PASSWORD_RESET_IP_WINDOW_MS=900000
```

En cualquier candidato temporal, prueba en puerto alterno o instancia que use
otra base de datos, configura obligatoriamente `EMAIL_OUTBOX_ENABLED=false`.
Aunque MySQL serializa cada worker, las cuotas se contabilizan por base y dos
bases activas con el mismo buzón podrían sumar más de 100 contactos. Sólo la
instancia productiva `sir-api` en puerto 4000 puede tener este worker habilitado.

Si el puerto 465 no está disponible, Hostinger también admite STARTTLS:

```dotenv
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
```

Referencia oficial: https://support.hostinger.com/en/articles/1575756-how-to-get-email-account-configuration-details-for-hostinger-email

El usuario debe ser la dirección completa. `SMTP_FROM` debe utilizar una
identidad autorizada por esa cuenta. Verifica en hPanel los registros DNS que
Hostinger indique para entrega y autenticación del dominio.

## Verificación sin enviar correo

Desde `backend`:

```bash
npm run smtp:verify
```

El resultado esperado es `SMTP_CONNECTION_OK`. El comando valida también que
`FRONTEND_URL` sea una URL absoluta HTTP(S), y comprueba conexión, TLS y
autenticación sin imprimir la contraseña ni enviar mensajes. Después, la prueba
funcional debe hacerse solicitando una recuperación para una cuenta de prueba y
comprobando que el enlace use el dominio de SIR.

## Activación segura en el VPS

La aplicación productiva usa el proceso PM2 `sir-api` en el puerto 4000. El
proceso `app` pertenece a otra aplicación y no debe reiniciarse ni modificarse.
Desde el directorio `backend` de la versión que se vaya a publicar:

```bash
APP_PID_ANTES="$(pm2 pid app)"
cp .env ".env.backup_$(date +%Y%m%d_%H%M%S)"
nano .env
chmod 600 .env
npm run smtp:verify
npm run db:migrate:email-outbox
npm run email:outbox:status
```

La contraseña del buzón se escribe directamente en `.env`; nunca se pega en
un chat, commit o comando visible. Si la verificación devuelve
`SMTP_CONNECTION_OK`, se actualiza únicamente el proceso de SIR:

```bash
pm2 restart sir-api --update-env --kill-timeout 20000
pm2 status
test "$(pm2 pid app)" = "$APP_PID_ANTES"
curl -sS -o /dev/null -w 'sir-api: HTTP %{http_code}\n' \
  -H 'Content-Type: application/json' \
  -d '{"username":"__smtp_healthcheck__","password":"invalid"}' \
  http://127.0.0.1:4000/api/login
```

El `kill-timeout` se aplica únicamente a `sir-api` y le da al worker tiempo para
terminar un contacto SMTP antes del reinicio; el valor predeterminado de PM2 es
menor que el cierre ordenado de SIR. Referencia oficial:
https://pm2.keymetrics.io/docs/usage/signals-clean-restart/

El último `curl` debe obtener una respuesta HTTP controlada del API (por
ejemplo 401), no un error de conexión. Después se hace una recuperación de
contraseña hacia una cuenta de prueba y se revisan bandeja de entrada, spam,
remitente y URL del botón.

## Semántica de horarios

- Editar el borrador no crea notificaciones ni correos.
- La primera publicación crea una notificación interna y programa un correo
  individual para cada asesor activo incluido en la semana.
- Al republicar desde el estado `publicado`, sólo se avisa a los asesores cuyo
  horario, canal semanal, condición de supernumerario o vacaciones cambiaron.
- Si un aviso anterior de esa misma semana seguía pendiente, se reemplaza por
  la versión más reciente para no entregar después un horario obsoleto.
- Un reintento con el mismo contenido no crea avisos duplicados.
- El estado legado `pendiente_republicacion` no conserva el listado granular de
  personas modificadas; por seguridad, al publicarlo se avisa a toda la semana.
- Las notificaciones internas y los trabajos de correo se guardan en la misma
  transacción que publica la semana. Después del commit, el worker entrega los
  pendientes con reintentos; un fallo SMTP no pierde el trabajo ni revierte una
  semana ya publicada.

El panel de notificaciones permanece disponible para todos los perfiles
internos. Los intercambios y horarios se muestran únicamente a sus asesores
destinatarios; el backend y la tabla siguen siendo genéricos para añadir
recordatorios u otros avisos en el futuro.

## Cola, reintentos y límite del buzón

Los correos no se envían dentro de la petición HTTP. Se guardan en
`email_outbox` y un worker del mismo proceso `sir-api` los entrega de forma
secuencial. La publicación de horarios y sus correos se guardan en una sola
transacción: si la operación confirma, los trabajos no se pierden aunque SMTP
esté caído o el proceso se reinicie.

La cuenta gratuita mostrada en hPanel admite 100 envíos por buzón en cada
ventana móvil de 24 horas. Por defecto SIR permite como máximo 90 avisos de
horario y reserva los 10 restantes para recuperaciones de contraseña. El total
de ambas categorías nunca supera 100 según el registro de la cola. Este buzón
debe ser exclusivo de SIR: los mensajes enviados manualmente desde webmail no
son visibles para el contador local.

El techo de 100, el máximo de 90 horarios y la reserva mínima de 10
recuperaciones también están fijados en código: una variable de entorno puede
reducir esos valores, pero no aumentarlos ni eliminar la reserva.

- Recuperación tiene prioridad alta, expira junto con el token (10 minutos) y
  no inicia SMTP si quedan menos de 2 minutos de vigencia.
- Horarios tienen prioridad normal y se aplazan automáticamente cuando ya se
  enviaron 90 durante las últimas 24 horas.
- Los errores temporales usan espera exponencial; autenticación y cuota del
  proveedor se aplazan sin destruir el trabajo. Los rechazos permanentes de
  destinatario sí terminan el trabajo.
- Un rechazo de autenticación, configuración o cuota abre un circuito global:
  el worker detiene el lote y no vuelve a contactar el buzón hasta que venza la
  pausa. Esto evita multiplicar intentos contra Hostinger cuando hay muchos
  horarios pendientes.
- Un trabajo bloqueado por un cierre inesperado se recupera después de un
  minuto. Un lock asesor de MySQL evita que dos workers consuman la cuota a la
  vez, incluso si PM2 levanta accidentalmente más de una instancia.
- Si falta SMTP, la tabla o conectividad, `sir-api` continúa ejecutándose. Sin
  SMTP configurado los trabajos permanecen pendientes y no consumen intentos.
- Si `FRONTEND_URL`, la autenticación SMTP o el remitente están mal configurados,
  el worker conserva los trabajos y tampoco reserva cuota ni consume intentos;
  corrige la configuración y valida con `npm run smtp:verify`.
- El `Payload` se elimina al enviar, expirar o declarar un fallo permanente para
  no conservar enlaces de recuperación utilizables en el historial.
- La ruta pública admite por defecto cinco solicitudes por IP cada 15 minutos,
  y una cuenta conocida sólo puede generar un enlace cada diez minutos (la
  vigencia completa del token). Una nueva solicitud limpia cualquier correo
  anterior que aún estuviera pendiente. La
  respuesta sigue siendo genérica para no revelar qué correos están registrados.

Cada contacto con SMTP se reserva primero en `email_outbox_dispatches`. Así, si
el proceso cae justo después de que el proveedor acepta un mensaje, ese intento
sigue contando durante 24 horas y la aplicación no supera su límite local. La
entrega es de tipo **al menos una vez**: en ese caso excepcional el correo podría
repetirse, pero la cuota queda contabilizada de forma conservadora. El buzón debe
seguir siendo exclusivo de SIR, pues un envío manual desde webmail no aparece en
esta tabla. Si el proveedor rechaza inequívocamente el contacto antes de aceptar
el mensaje (por ejemplo credenciales incorrectas, cuota externa o destinatario
inválido), SIR libera esa reserva; los cortes de transporte ambiguos la conservan.

La migración es idempotente y debe aplicarse **antes** de reiniciar `sir-api`:

```bash
cd /ruta/de/la/release/backend
npm run db:migrate:email-outbox
npm run email:outbox:status
```

El segundo comando muestra los pendientes, enviados y fallidos, además del
consumo de la ventana móvil de 24 horas, sin imprimir destinatarios ni payloads.

El baseline `database/sir.sql` también contiene la tabla para instalaciones
nuevas. No se debe volver a importar ese baseline sobre una base productiva.
