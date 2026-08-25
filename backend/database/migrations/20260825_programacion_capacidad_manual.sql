ALTER TABLE programacion_buses
  ADD COLUMN Capacidad_Manual tinyint(1) NOT NULL DEFAULT 0 AFTER Capacidad;
