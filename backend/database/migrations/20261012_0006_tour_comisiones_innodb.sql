-- Preflight requerido antes de aplicar: backup verificado, ENGINE/row count,
-- columnas, índices, FKs, tamaño y ensayo sobre copia temporal.
-- Esta migración sólo convierte la tabla activa de negocio tour_comisiones.
ALTER TABLE tour_comisiones ENGINE=InnoDB;
