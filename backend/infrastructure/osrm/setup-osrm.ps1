$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $scriptRoot 'data'
$pbfPath = Join-Path $dataDir 'colombia-latest.osm.pbf'
$image = 'ghcr.io/project-osrm/osrm-backend:v5.27.1'
$downloadUrl = 'https://download.geofabrik.de/south-america/colombia-latest.osm.pbf'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker no está instalado. Instala Docker Desktop y vuelve a ejecutar este script.'
}

docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker está instalado, pero el motor no está iniciado.'
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (-not (Test-Path -LiteralPath $pbfPath)) {
    Write-Host 'Descargando el extracto vigente de OpenStreetMap para Colombia...'
    $partialPath = "$pbfPath.part"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $partialPath
    Move-Item -LiteralPath $partialPath -Destination $pbfPath -Force
}

$mount = "$($dataDir):/data"

Write-Host 'Extrayendo la red vial con el perfil de automóvil...'
docker run --rm -t -v $mount $image `
    osrm-extract -p /opt/car.lua /data/colombia-latest.osm.pbf
if ($LASTEXITCODE -ne 0) { throw 'Falló osrm-extract.' }

Write-Host 'Construyendo el índice CH optimizado para matrices...'
docker run --rm -t -v $mount $image `
    osrm-contract /data/colombia-latest.osrm
if ($LASTEXITCODE -ne 0) { throw 'Falló osrm-contract.' }

docker compose -f (Join-Path $scriptRoot 'docker-compose.yml') up -d
if ($LASTEXITCODE -ne 0) { throw 'No fue posible iniciar OSRM.' }

Write-Host 'OSRM quedó disponible en http://127.0.0.1:5001'
Write-Host 'Configura PROGRAMACION_OSRM_URL=http://127.0.0.1:5001 en backend/env/.env.'
