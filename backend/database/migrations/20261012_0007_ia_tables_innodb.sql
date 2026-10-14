-- Migración separada de Comisiones. Confirmar en preflight que ambas tablas
-- existen y que el ensayo temporal preservó conteos, índices y restricciones.
ALTER TABLE ia_interacciones ENGINE=InnoDB;
ALTER TABLE ia_tool_runs ENGINE=InnoDB;
