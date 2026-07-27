# OSRM local para SIR

El optimizador sombra puede obtener distancias viales desde un servidor OSRM local.
No usa Google Maps, no consulta tráfico en tiempo real y no envía reservas a
servicios externos.

## Preparación en el VPS Ubuntu

Antes de procesar el mapa se recomienda disponer de swap y realizar la operación
en una ventana de mantenimiento.

Desde la raíz del proyecto:

```bash
chmod +x backend/infrastructure/osrm/setup-osrm-ubuntu.sh
./backend/infrastructure/osrm/setup-osrm-ubuntu.sh
```

El servicio queda enlazado exclusivamente a `127.0.0.1:5001` para no interferir
con SIR (`5000`) ni con el backend de SIR Angular (`4000`).

## Preparación en Windows para desarrollo

1. Instalar Docker Desktop.
2. Desde PowerShell, ejecutar:

```powershell
.\backend\infrastructure\osrm\setup-osrm.ps1
```

El script descarga el extracto vigente de Colombia desde Geofabrik, procesa la red
con el perfil de automóvil y levanta OSRM solamente en `127.0.0.1:5001`.
La preparación inicial puede tardar y requiere varios GB libres.

Después se agregan estas variables al entorno del proceso backend:

```dotenv
PROGRAMACION_OSRM_URL=http://127.0.0.1:5001
PROGRAMACION_OSRM_PROFILE=driving
PROGRAMACION_OSRM_BATCH_SIZE=40
PROGRAMACION_OSRM_TIMEOUT_MS=5000
```

Reinicia el backend después de cambiar las variables.

## Operación

```bash
docker compose -f backend/infrastructure/osrm/docker-compose.yml up -d
docker compose -f backend/infrastructure/osrm/docker-compose.yml stop
docker compose -f backend/infrastructure/osrm/docker-compose.yml logs -f
```

Los archivos descargados y procesados están en `data/` y no se versionan.

Si OSRM no está configurado o deja de responder, el banco de pruebas continúa con
Haversine y devuelve el motivo del fallback en `metadataDistancias` y en la alerta
`OSRM_NO_DISPONIBLE`.
