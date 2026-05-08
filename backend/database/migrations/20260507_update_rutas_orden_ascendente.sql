-- Migracion de rutas para que el orden operativo coincida con orden ascendente normal.
-- Antes de ejecutar en produccion: hacer backup de la base de datos.
-- Ejecutar el SELECT de verificacion antes y despues del UPDATE.

SELECT ruta, COUNT(*) total
FROM puntos
GROUP BY ruta
ORDER BY CAST(ruta AS UNSIGNED), ruta;

UPDATE puntos
SET ruta = CASE ruta
  WHEN '0' THEN '0'
  WHEN '1' THEN '1'
  WHEN '2' THEN '2'
  WHEN '3' THEN '3'
  WHEN '4' THEN '4'
  WHEN '5' THEN '5'
  WHEN '6' THEN '6'
  WHEN '10' THEN '7'
  WHEN '11' THEN '8'
  WHEN '12' THEN '9'
  WHEN '13' THEN '10'
  WHEN '7' THEN '11'
  WHEN '8' THEN '12'
  WHEN '9' THEN '13'
  WHEN '14' THEN '14'
  ELSE ruta
END
WHERE ruta IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14');

SELECT ruta, COUNT(*) total
FROM puntos
GROUP BY ruta
ORDER BY CAST(ruta AS UNSIGNED), ruta;
