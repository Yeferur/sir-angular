START TRANSACTION;
SELECT 'Puntos ANTES' AS tabla, Ruta, COUNT(*) total
FROM Puntos
GROUP BY Ruta
ORDER BY CAST(Ruta AS UNSIGNED), Ruta;

SELECT 'Horarios ANTES' AS tabla, Ruta, COUNT(*) total
FROM Horarios
GROUP BY Ruta
ORDER BY CAST(Ruta AS UNSIGNED), Ruta;

SELECT 'Reservas ANTES' AS tabla, Ruta, COUNT(*) total
FROM Reservas
GROUP BY Ruta
ORDER BY CAST(Ruta AS UNSIGNED), Ruta;

SELECT 'Puntos rutas fuera de rango' AS revision, Ruta, COUNT(*) total
FROM Puntos
WHERE Ruta IS NOT NULL
  AND TRIM(Ruta) <> ''
  AND Ruta NOT IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14')
GROUP BY Ruta;

SELECT 'Horarios rutas fuera de rango' AS revision, Ruta, COUNT(*) total
FROM Horarios
WHERE Ruta IS NOT NULL
  AND TRIM(Ruta) <> ''
  AND Ruta NOT IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14')
GROUP BY Ruta;

SELECT 'Reservas rutas fuera de rango' AS revision, Ruta, COUNT(*) total
FROM Reservas
WHERE Ruta IS NOT NULL
  AND TRIM(Ruta) <> ''
  AND Ruta NOT IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14')
GROUP BY Ruta;


UPDATE Puntos
SET Ruta = CASE TRIM(Ruta)
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
  ELSE Ruta
END
WHERE TRIM(Ruta) IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14');

UPDATE Horarios
SET Ruta = CASE TRIM(Ruta)
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
  ELSE Ruta
END
WHERE TRIM(Ruta) IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14');

UPDATE Reservas
SET Ruta = CASE TRIM(Ruta)
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
  ELSE Ruta
END
WHERE TRIM(Ruta) IN ('0','1','2','3','4','5','6','7','8','9','10','11','12','13','14');

SELECT 'Puntos DESPUÉS' AS tabla, Ruta, COUNT(*) total
FROM Puntos
GROUP BY Ruta
ORDER BY CAST(Ruta AS UNSIGNED), Ruta;

SELECT 'Horarios DESPUÉS' AS tabla, Ruta, COUNT(*) total
FROM Horarios
GROUP BY Ruta
ORDER BY CAST(Ruta AS UNSIGNED), Ruta;

SELECT 'Reservas DESPUÉS' AS tabla, Ruta, COUNT(*) total
FROM Reservas
GROUP BY Ruta
ORDER BY CAST(Ruta AS UNSIGNED), Ruta;

COMMIT;
