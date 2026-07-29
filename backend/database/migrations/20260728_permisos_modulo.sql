ALTER TABLE permisos
  ADD COLUMN Modulo_Permiso VARCHAR(100) NULL AFTER Descripcion;

UPDATE permisos
SET Modulo_Permiso = CASE Id_Permiso
  WHEN 1 THEN 'Inicio'
  WHEN 2 THEN 'Inicio'
  WHEN 3 THEN 'Historial'
  WHEN 4 THEN 'Informes'
  WHEN 5 THEN 'Reservas'
  WHEN 6 THEN 'Reservas'
  WHEN 7 THEN 'Reservas'
  WHEN 8 THEN 'Reservas'
  WHEN 9 THEN 'Transfers'
  WHEN 10 THEN 'Transfers'
  WHEN 11 THEN 'Transfers'
  WHEN 12 THEN 'Transfers'
  WHEN 13 THEN 'Tours'
  WHEN 14 THEN 'Tours'
  WHEN 15 THEN 'Tours'
  WHEN 16 THEN 'Tours'
  WHEN 17 THEN 'Puntos de encuentro'
  WHEN 18 THEN 'Puntos de encuentro'
  WHEN 19 THEN 'Puntos de encuentro'
  WHEN 20 THEN 'Puntos de encuentro'
  WHEN 21 THEN 'Programación'
  WHEN 22 THEN 'Programación'
  WHEN 23 THEN 'Programación'
  WHEN 24 THEN 'Programación'
  WHEN 25 THEN 'Usuarios'
  WHEN 26 THEN 'Usuarios'
  WHEN 27 THEN 'Usuarios'
  WHEN 28 THEN 'Usuarios'
  WHEN 37 THEN 'Pagos'
  WHEN 39 THEN 'Pagos'
  WHEN 40 THEN 'Pagos'
  WHEN 41 THEN 'Puntos de encuentro'
  WHEN 42 THEN 'Puntos de encuentro'
  WHEN 43 THEN 'Programación'
  WHEN 44 THEN 'Control de viaje'
  WHEN 45 THEN 'Control de viaje'
  WHEN 48 THEN 'Mensajería'
  WHEN 96 THEN 'Roles y permisos'
  WHEN 97 THEN 'Configuración'
  WHEN 106 THEN 'Seguros'
  WHEN 107 THEN 'Comisiones'
  ELSE 'Otros'
END;

UPDATE permisos
SET Descripcion = 'Desactivar usuarios'
WHERE Id_Permiso = 28;

ALTER TABLE permisos
  MODIFY COLUMN Modulo_Permiso VARCHAR(100) NOT NULL;
