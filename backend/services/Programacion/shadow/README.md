# Optimizador de programación en modo sombra

Este módulo compara una propuesta nueva con el generador operativo sin guardar,
confirmar ni reemplazar listados.

## Reglas aplicadas

1. La capacidad automática es siempre de 38 pasajeros.
2. Una reserva es indivisible, incluso cuando contiene varios puntos de encuentro.
3. Se busca la menor flota factible. `ceil(pasajeros / 38)` se conserva como límite
   teórico, pero puede requerirse otro bus si los tamaños de las reservas no caben
   sin dividirlas.
4. Se maximiza la cantidad de buses llenos, dentro de una solución geográficamente
   coherente.
5. Las rutas son preferencias suaves; no son fronteras obligatorias.
6. La posición manual es una señal suave porque todavía debe auditarse.
7. Las reservas en inglés se concentran en la menor cantidad coherente de buses.
   Los pasajeros en español pueden completar esos buses.
8. Datos incompletos de idioma, ruta o coordenadas producen alertas visibles.

## Endpoint

`POST /api/programacion/plan-logistico-shadow`

Requiere autenticación y permiso `PROGRAMACION.CREAR`.

```json
{
  "fecha": "2026-06-30",
  "idsTours": [1, 5],
  "maxGuiasBilingues": 3
}
```

También acepta `idTour` para ejecutar un solo tour. La respuesta contiene:

- métricas del motor actual;
- plan completo del motor sombra;
- cargas, buses completos, sillas vacías y buses bilingües;
- alternativas según la cantidad de buses bilingües;
- razones de las decisiones y alertas de calidad de datos;
- `persisteCambios: false`.

Las distancias del motor actual y del motor sombra no se restan entre sí porque
pueden usar fuentes distintas. Si `PROGRAMACION_OSRM_URL` está configurada, el
motor sombra construye por bloques una matriz vial local de OSRM. En caso contrario,
o si el servidor falla, usa Haversine y reporta el motivo del fallback.

La instalación local está documentada en
`backend/infrastructure/osrm/README.md`.

## Pruebas

Desde `backend`:

```bash
npm run test:programacion-shadow
```

Las pruebas cubren capacidad, flota mínima factible, reservas multipunto, idioma,
determinismo y alertas de datos incompletos.
