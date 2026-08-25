ALTER TABLE tours
  ADD COLUMN Latitud_Primera_Parada decimal(10,7) NULL AFTER Nombre_Primera_Parada,
  ADD COLUMN Longitud_Primera_Parada decimal(10,7) NULL AFTER Latitud_Primera_Parada;

UPDATE tours
SET Latitud_Primera_Parada = Latitud,
    Longitud_Primera_Parada = Longitud
WHERE Id_Tour IN (2, 3, 4, 5, 8, 10);

UPDATE tours
SET Latitud = CASE Id_Tour
      WHEN 2 THEN 6.2343110
      WHEN 3 THEN 6.2539330
      WHEN 4 THEN 6.5567630
      WHEN 5 THEN 5.9115980
      WHEN 8 THEN 6.2107740
      WHEN 10 THEN 6.3447100
    END,
    Longitud = CASE Id_Tour
      WHEN 2 THEN -75.1617250
      WHEN 3 THEN -75.5687160
      WHEN 4 THEN -75.8277640
      WHEN 5 THEN -74.7251700
      WHEN 8 THEN -75.5580550
      WHEN 10 THEN -75.7027800
    END
WHERE Id_Tour IN (2, 3, 4, 5, 8, 10);
