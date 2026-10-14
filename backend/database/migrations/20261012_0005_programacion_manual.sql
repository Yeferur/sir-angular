CREATE TABLE IF NOT EXISTS programacion_importaciones (
  Id_Importacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Usuario BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  Estado ENUM('RECIBIDA','PROCESANDO','PARCIAL','COMPLETADA','FALLIDA') NOT NULL,
  Cantidad_Archivos SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  Error_Resumen VARCHAR(1000) NULL,
  PRIMARY KEY (Id_Importacion),
  KEY ix_prog_imp_usuario_fecha (Id_Usuario, Fecha_Creacion),
  CONSTRAINT fk_prog_imp_usuario FOREIGN KEY (Id_Usuario) REFERENCES usuarios(Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_importacion_archivos (
  Id_Archivo BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Importacion BIGINT UNSIGNED NOT NULL,
  Nombre_Original VARCHAR(255) NOT NULL,
  Storage_Key VARCHAR(500) NOT NULL,
  SHA256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Tamano_Bytes BIGINT UNSIGNED NOT NULL,
  Mime_Detectado VARCHAR(127) NOT NULL,
  Estado ENUM('RECIBIDO','DUPLICADO','ACEPTADO','PROCESANDO','INTERPRETADO','FALLIDO') NOT NULL,
  Id_Archivo_Duplicado_De BIGINT UNSIGNED NULL,
  Id_Archivo_Anterior BIGINT UNSIGNED NULL,
  Fecha_Tour DATE NULL,
  Id_Tour BIGINT UNSIGNED NULL,
  Version_Listado VARCHAR(80) NULL,
  Parser_Version VARCHAR(80) NULL,
  Error_Resumen VARCHAR(1000) NULL,
  Creado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Archivo),
  KEY ix_prog_arch_import (Id_Importacion, Id_Archivo),
  KEY ix_prog_arch_hash (SHA256),
  KEY ix_prog_arch_fecha_tour (Fecha_Tour, Id_Tour),
  KEY ix_prog_arch_previo (Id_Archivo_Anterior),
  CONSTRAINT fk_prog_arch_import FOREIGN KEY (Id_Importacion) REFERENCES programacion_importaciones(Id_Importacion)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_arch_duplicado FOREIGN KEY (Id_Archivo_Duplicado_De) REFERENCES programacion_importacion_archivos(Id_Archivo)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_prog_arch_anterior FOREIGN KEY (Id_Archivo_Anterior) REFERENCES programacion_importacion_archivos(Id_Archivo)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_prog_arch_tour FOREIGN KEY (Id_Tour) REFERENCES tours(Id_Tour)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_arch_actor FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_listados_manual (
  Id_Listado BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Archivo BIGINT UNSIGNED NOT NULL,
  Id_Listado_Anterior BIGINT UNSIGNED NULL,
  Numero_Intento SMALLINT UNSIGNED NOT NULL,
  Parser_Version VARCHAR(80) NOT NULL,
  Fecha_Tour DATE NULL,
  Id_Tour BIGINT UNSIGNED NULL,
  Total_Pasajeros_Declarado INT UNSIGNED NULL,
  Total_Pasajeros_Calculado INT UNSIGNED NULL,
  Estado ENUM('INTERPRETADO','REQUIERE_REVISION','ACEPTADO','RECHAZADO','FALLIDO') NOT NULL,
  Metadata_JSON JSON NULL,
  Creado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Listado),
  UNIQUE KEY uq_prog_listado_intento (Id_Archivo, Numero_Intento),
  KEY ix_prog_listado_fecha_tour (Fecha_Tour, Id_Tour, Estado),
  CONSTRAINT fk_prog_listado_arch FOREIGN KEY (Id_Archivo) REFERENCES programacion_importacion_archivos(Id_Archivo)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_listado_previo FOREIGN KEY (Id_Listado_Anterior) REFERENCES programacion_listados_manual(Id_Listado)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_prog_listado_tour FOREIGN KEY (Id_Tour) REFERENCES tours(Id_Tour)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_listado_actor FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_listado_filas_raw (
  Id_Fila_Raw BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Listado BIGINT UNSIGNED NOT NULL,
  Indice_Hoja SMALLINT UNSIGNED NOT NULL,
  Nombre_Hoja VARCHAR(128) NOT NULL,
  Numero_Fila INT UNSIGNED NOT NULL,
  Tipo_Fila ENUM('CABECERA','RUTA','ITEM','PASAJERO','SUBTOTAL','OTRA') NOT NULL,
  Datos_JSON JSON NOT NULL,
  PRIMARY KEY (Id_Fila_Raw),
  UNIQUE KEY uq_prog_raw_pos (Id_Listado, Indice_Hoja, Numero_Fila),
  CONSTRAINT fk_prog_raw_listado FOREIGN KEY (Id_Listado) REFERENCES programacion_listados_manual(Id_Listado)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_listado_rutas (
  Id_Listado_Ruta BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Listado BIGINT UNSIGNED NOT NULL,
  Codigo_Ruta VARCHAR(80) NOT NULL,
  Orden_Bloque SMALLINT UNSIGNED NOT NULL,
  Total_Pasajeros_Declarado INT UNSIGNED NULL,
  Total_Pasajeros_Calculado INT UNSIGNED NOT NULL DEFAULT 0,
  Metadata_JSON JSON NULL,
  PRIMARY KEY (Id_Listado_Ruta),
  UNIQUE KEY uq_prog_ruta_orden (Id_Listado, Orden_Bloque),
  KEY ix_prog_ruta_codigo (Codigo_Ruta, Id_Listado),
  CONSTRAINT fk_prog_ruta_listado FOREIGN KEY (Id_Listado) REFERENCES programacion_listados_manual(Id_Listado)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_listado_items (
  Id_Listado_Item BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Listado_Ruta BIGINT UNSIGNED NOT NULL,
  Id_Reserva VARCHAR(20) NULL,
  Id_Punto BIGINT UNSIGNED NULL,
  Orden_En_Ruta SMALLINT UNSIGNED NOT NULL,
  Cantidad_Pasajeros INT UNSIGNED NOT NULL DEFAULT 0,
  Punto_Nombre_Snapshot VARCHAR(255) NULL,
  Observaciones_Snapshot TEXT NULL,
  Datos_Originales_JSON JSON NULL,
  Estado_Match ENUM('SIN_INTENTAR','MATCH_EXACTO','MATCH_AMBIGUO','SIN_MATCH','REFERENCIA_INVALIDA') NOT NULL DEFAULT 'SIN_INTENTAR',
  PRIMARY KEY (Id_Listado_Item),
  UNIQUE KEY uq_prog_item_orden (Id_Listado_Ruta, Orden_En_Ruta),
  KEY ix_prog_item_sir (Id_Reserva),
  KEY ix_prog_item_punto (Id_Punto),
  CONSTRAINT fk_prog_item_ruta FOREIGN KEY (Id_Listado_Ruta) REFERENCES programacion_listado_rutas(Id_Listado_Ruta)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_item_reserva FOREIGN KEY (Id_Reserva) REFERENCES reservas(Id_Reserva)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_prog_item_punto FOREIGN KEY (Id_Punto) REFERENCES puntos(Id_Punto)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_listado_pasajeros (
  Id_Listado_Pasajero BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Listado_Item BIGINT UNSIGNED NOT NULL,
  Id_Pasajero BIGINT UNSIGNED NULL,
  Orden SMALLINT UNSIGNED NOT NULL,
  Nombre_Snapshot VARCHAR(255) NULL,
  DNI_Snapshot VARCHAR(40) NULL,
  Telefono_Snapshot VARCHAR(50) NULL,
  Datos_Originales_JSON JSON NULL,
  Estado_Match ENUM('SIN_INTENTAR','MATCH_EXACTO','MATCH_AMBIGUO','SIN_MATCH') NOT NULL DEFAULT 'SIN_INTENTAR',
  PRIMARY KEY (Id_Listado_Pasajero),
  UNIQUE KEY uq_prog_pasajero_orden (Id_Listado_Item, Orden),
  KEY ix_prog_pasajero_sir (Id_Pasajero),
  CONSTRAINT fk_prog_lp_item FOREIGN KEY (Id_Listado_Item) REFERENCES programacion_listado_items(Id_Listado_Item)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_lp_pasajero FOREIGN KEY (Id_Pasajero) REFERENCES pasajeros(Id_Pasajero)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_exportaciones (
  Id_Exportacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Fecha_Tour DATE NULL,
  Id_Tour BIGINT UNSIGNED NULL,
  Id_Usuario BIGINT UNSIGNED NULL,
  Version_Formato VARCHAR(80) NOT NULL,
  Estado ENUM('GENERADA','REIMPORTADA','CERRADA','FALLIDA') NOT NULL,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Exportacion),
  KEY ix_prog_exp_tour_fecha (Id_Tour, Fecha_Tour),
  KEY ix_prog_exp_usuario_fecha (Id_Usuario, Fecha_Creacion),
  CONSTRAINT fk_prog_exp_tour FOREIGN KEY (Id_Tour) REFERENCES tours(Id_Tour)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_exp_usuario FOREIGN KEY (Id_Usuario) REFERENCES usuarios(Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS programacion_exportacion_filas (
  Id_Row CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Id_Exportacion CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Ordinal INT UNSIGNED NOT NULL,
  Id_Reserva VARCHAR(20) NULL,
  Id_Pasajero BIGINT UNSIGNED NULL,
  Id_Punto BIGINT UNSIGNED NULL,
  Snapshot_JSON JSON NOT NULL,
  PRIMARY KEY (Id_Row),
  UNIQUE KEY uq_prog_export_ordinal (Id_Exportacion, Ordinal),
  KEY ix_prog_export_reserva (Id_Reserva),
  KEY ix_prog_export_pasajero (Id_Pasajero),
  KEY ix_prog_export_punto (Id_Punto),
  CONSTRAINT fk_prog_export_row_export FOREIGN KEY (Id_Exportacion) REFERENCES programacion_exportaciones(Id_Exportacion)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_prog_export_row_reserva FOREIGN KEY (Id_Reserva) REFERENCES reservas(Id_Reserva)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_prog_export_row_pasajero FOREIGN KEY (Id_Pasajero) REFERENCES pasajeros(Id_Pasajero)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_prog_export_row_punto FOREIGN KEY (Id_Punto) REFERENCES puntos(Id_Punto)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
