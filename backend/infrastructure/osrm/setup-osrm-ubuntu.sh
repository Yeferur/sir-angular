#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"
PBF_PATH="${DATA_DIR}/colombia-latest.osm.pbf"
PARTIAL_PATH="${PBF_PATH}.part"
IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"
DOWNLOAD_URL="https://download.geofabrik.de/south-america/colombia-latest.osm.pbf"

for command_name in docker curl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Falta el comando requerido: ${command_name}" >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker está instalado, pero el motor no está iniciado o el usuario no tiene acceso." >&2
  exit 1
fi

available_kb="$(df --output=avail "${SCRIPT_DIR}" | tail -n 1 | tr -d ' ')"
if (( available_kb < 15728640 )); then
  echo "Se requieren al menos 15 GB libres para descargar y procesar el mapa." >&2
  exit 1
fi

swap_kb="$(awk '/^SwapTotal:/ { print $2 }' /proc/meminfo)"
if (( swap_kb == 0 )); then
  echo "ADVERTENCIA: el servidor no tiene swap; créala antes de procesar Colombia para reducir el riesgo de OOM." >&2
fi

mkdir -p "${DATA_DIR}"

if [[ ! -s "${PBF_PATH}" ]]; then
  echo "Descargando el extracto vigente de OpenStreetMap para Colombia..."
  rm -f -- "${PARTIAL_PATH}"
  curl --fail --location --retry 3 --output "${PARTIAL_PATH}" "${DOWNLOAD_URL}"
  mv -- "${PARTIAL_PATH}" "${PBF_PATH}"
fi

echo "Extrayendo la red vial con el perfil de automóvil..."
docker run --rm --tty \
  --volume "${DATA_DIR}:/data" \
  "${IMAGE}" \
  osrm-extract -p /opt/car.lua /data/colombia-latest.osm.pbf

echo "Construyendo el índice CH optimizado para matrices..."
docker run --rm --tty \
  --volume "${DATA_DIR}:/data" \
  "${IMAGE}" \
  osrm-contract /data/colombia-latest.osrm

docker compose --file "${SCRIPT_DIR}/docker-compose.yml" up --detach

echo "Esperando que OSRM responda..."
for _ in {1..30}; do
  if curl --fail --silent \
    "http://127.0.0.1:5001/nearest/v1/driving/-75.57759,6.21276?number=1" \
    >/dev/null; then
    echo "OSRM está disponible en http://127.0.0.1:5001"
    echo "Configura PROGRAMACION_OSRM_URL=http://127.0.0.1:5001 en el entorno del backend."
    exit 0
  fi
  sleep 2
done

echo "OSRM no respondió a tiempo. Revisa: docker compose -f ${SCRIPT_DIR}/docker-compose.yml logs" >&2
exit 1
