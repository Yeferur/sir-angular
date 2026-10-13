INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES ('LEER', 'MERCADEO.RESERVAS.LEER', 'Consultar reservas del módulo de Mercadeo', 'Mercadeo')
ON DUPLICATE KEY UPDATE
  Accion = VALUES(Accion),
  Descripcion = VALUES(Descripcion),
  Modulo_Permiso = VALUES(Modulo_Permiso);

SET @sql_idx_reservas_fecha_registro = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas'
            AND INDEX_NAME = 'idx_reservas_fecha_registro_id'),
  'DO 0',
  'ALTER TABLE reservas ADD INDEX idx_reservas_fecha_registro_id (Fecha_Registro, Id_Reserva)'
);
PREPARE stmt_idx_reservas_fecha_registro FROM @sql_idx_reservas_fecha_registro;
EXECUTE stmt_idx_reservas_fecha_registro;
DEALLOCATE PREPARE stmt_idx_reservas_fecha_registro;

SET @sql_idx_pasajeros_dni = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pasajeros'
            AND INDEX_NAME = 'idx_pasajeros_dni'),
  'DO 0',
  'ALTER TABLE pasajeros ADD INDEX idx_pasajeros_dni (DNI)'
);
PREPARE stmt_idx_pasajeros_dni FROM @sql_idx_pasajeros_dni;
EXECUTE stmt_idx_pasajeros_dni;
DEALLOCATE PREPARE stmt_idx_pasajeros_dni;

SET @sql_idx_pasajeros_nombre = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pasajeros'
            AND INDEX_NAME = 'idx_pasajeros_nombre'),
  'DO 0',
  'ALTER TABLE pasajeros ADD INDEX idx_pasajeros_nombre (Nombre_Pasajero(100))'
);
PREPARE stmt_idx_pasajeros_nombre FROM @sql_idx_pasajeros_nombre;
EXECUTE stmt_idx_pasajeros_nombre;
DEALLOCATE PREPARE stmt_idx_pasajeros_nombre;
