-- Referencia del listado diario realmente exportado. No reconstruir referencias
-- antiguas a partir del estado actual: no representan un listado preparado.
CREATE TABLE IF NOT EXISTS programacion_transfers_listados (
  Fecha_Operacion DATE NOT NULL,
  Revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  Firma CHAR(64) DEFAULT NULL,
  Confirmado_En DATETIME(3) DEFAULT NULL,
  Confirmado_Por BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (Fecha_Operacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_transfers_snapshot (
  Fecha_Operacion DATE NOT NULL,
  Revision_Listado BIGINT UNSIGNED NOT NULL,
  Id_Transfer BIGINT UNSIGNED NOT NULL,
  Datos_Snapshot JSON NOT NULL,
  PRIMARY KEY (Fecha_Operacion, Revision_Listado, Id_Transfer),
  KEY idx_programacion_transfer_referencia (Id_Transfer, Fecha_Operacion),
  CONSTRAINT fk_programacion_transfers_listado FOREIGN KEY (Fecha_Operacion)
    REFERENCES programacion_transfers_listados (Fecha_Operacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Sin FK a transfers: una eliminación debe conservar su referencia y permitir
-- detectar la diferencia. Se mantienen snapshots de versiones anteriores.
