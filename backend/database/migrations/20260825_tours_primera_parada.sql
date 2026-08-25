ALTER TABLE tours
  ADD COLUMN Nombre_Primera_Parada varchar(255) NULL AFTER Cupo_Base;

UPDATE tours
SET Nombre_Primera_Parada = CASE Id_Tour
      WHEN 2 THEN 'Restaurante Porto Madero, Marinilla'
      WHEN 3 THEN 'Plaza Botero, Medellín'
      WHEN 4 THEN 'Restaurante Porto Madero, Laureles'
      WHEN 5 THEN 'Restaurante El Bohío, entrada Parque Temático Hacienda Nápoles'
      WHEN 8 THEN 'Parque de la Inflexión, Medellín'
      WHEN 10 THEN 'D''Arrieros Coffee Farm, Palmitas'
    END,
    Latitud = CASE Id_Tour
      WHEN 2 THEN 6.2076963
      WHEN 3 THEN 6.2522570
      WHEN 4 THEN 6.2491212
      WHEN 5 THEN 5.9014587
      WHEN 8 THEN 6.1915064
      WHEN 10 THEN 6.3446600
    END,
    Longitud = CASE Id_Tour
      WHEN 2 THEN -75.2824310
      WHEN 3 THEN -75.5686141
      WHEN 4 THEN -75.5943729
      WHEN 5 THEN -74.7239828
      WHEN 8 THEN -75.5775938
      WHEN 10 THEN -75.7026407
    END
WHERE Id_Tour IN (2, 3, 4, 5, 8, 10);
