-- =====================================================
-- SISTEMA DE PERMISOS BASADO EN ROLES (RBAC)
-- =====================================================

-- Limpiar tablas existentes (en orden para evitar FK conflicts)
DROP TABLE IF EXISTS `permisos_usuarios`;
DROP TABLE IF EXISTS `rol_permisos`;
DROP TABLE IF EXISTS `permisos`;
DROP TABLE IF EXISTS `modulos`;
DROP TABLE IF EXISTS `roles`;

-- Tabla: roles
CREATE TABLE IF NOT EXISTS `roles` (
  `Id_Rol` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `Nombre_Rol` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Activo` tinyint(1) DEFAULT 1,
  `Fecha_Creacion` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id_Rol`),
  UNIQUE KEY `ux_roles_nombre` (`Nombre_Rol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: modulos (recursos de la aplicación)
CREATE TABLE IF NOT EXISTS `modulos` (
  `Id_Modulo` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `Nombre_Modulo` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Codigo_Modulo` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Icono` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Ruta` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Orden` int DEFAULT 0,
  `Activo` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`Id_Modulo`),
  UNIQUE KEY `ux_modulos_codigo` (`Codigo_Modulo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: permisos (acciones sobre módulos)
CREATE TABLE IF NOT EXISTS `permisos` (
  `Id_Permiso` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `Id_Modulo` bigint UNSIGNED NOT NULL,
  `Accion` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Codigo_Permiso` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`Id_Permiso`),
  UNIQUE KEY `ux_permisos_codigo` (`Codigo_Permiso`),
  KEY `idx_permisos_modulo` (`Id_Modulo`),
  CONSTRAINT `fk_permisos_modulo` FOREIGN KEY (`Id_Modulo`) REFERENCES `modulos` (`Id_Modulo`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: rol_permisos (relación muchos a muchos)
CREATE TABLE IF NOT EXISTS `rol_permisos` (
  `Id_Rol_Permiso` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `Id_Rol` bigint UNSIGNED NOT NULL,
  `Id_Permiso` bigint UNSIGNED NOT NULL,
  `Fecha_Asignacion` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id_Rol_Permiso`),
  UNIQUE KEY `ux_rol_permiso` (`Id_Rol`, `Id_Permiso`),
  KEY `idx_rol_permisos_rol` (`Id_Rol`),
  KEY `idx_rol_permisos_permiso` (`Id_Permiso`),
  CONSTRAINT `fk_rol_permisos_rol` FOREIGN KEY (`Id_Rol`) REFERENCES `roles` (`Id_Rol`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_rol_permisos_permiso` FOREIGN KEY (`Id_Permiso`) REFERENCES `permisos` (`Id_Permiso`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Modificar tabla usuarios para usar FK a roles
-- (Primero verificamos que exista la columna Rol como varchar)
ALTER TABLE `usuarios` 
  ADD COLUMN `Id_Rol` bigint UNSIGNED DEFAULT NULL AFTER `Rol`,
  ADD KEY `idx_usuarios_rol` (`Id_Rol`);

-- =====================================================
-- SEED DATA: Roles predefinidos
-- =====================================================
INSERT INTO `roles` (`Id_Rol`, `Nombre_Rol`, `Descripcion`, `Activo`) VALUES
(1, 'Administrador', 'Acceso total al sistema', 1),
(2, 'Asesor', 'Gestión de reservas y consultas', 1),
(3, 'Consultor_TG_CTG_SF_CT', 'Consultor especializado en tours específicos', 1),
(4, 'Operador', 'Operador de tours y programación', 1),
(5, 'Solo_Lectura', 'Solo puede ver información, sin editar', 1);

-- =====================================================
-- SEED DATA: Módulos de la aplicación
-- =====================================================
INSERT INTO `modulos` (`Id_Modulo`, `Nombre_Modulo`, `Codigo_Modulo`, `Descripcion`, `Icono`, `Ruta`, `Orden`, `Activo`) VALUES
(1, 'Inicio', 'INICIO', 'Dashboard principal', 'home', '/Inicio', 1, 1),
(2, 'Reservas', 'RESERVAS', 'Gestión de reservas', 'calendar', '/Reservas', 2, 1),
(3, 'Tours', 'TOURS', 'Gestión de tours', 'map', '/Tours', 3, 1),
(4, 'Puntos', 'PUNTOS', 'Gestión de puntos de encuentro', 'location', '/Puntos', 4, 1),
(5, 'Programación', 'PROGRAMACION', 'Programación de rutas y buses', 'route', '/Programacion', 5, 1),
(6, 'Transfers', 'TRANSFERS', 'Gestión de transfers', 'car', '/Transfers', 6, 1),
(7, 'Usuarios', 'USUARIOS', 'Gestión de usuarios y permisos', 'users', '/Usuarios', 7, 1),
(8, 'Historial', 'HISTORIAL', 'Historial de cambios', 'history', '/Historial', 8, 1),
(9, 'Reportes', 'REPORTES', 'Reportes y descargas', 'download', '/Reportes', 9, 1);

-- =====================================================
-- SEED DATA: Permisos (CRUD + Descargar para cada módulo)
-- =====================================================
-- Acciones estándar: CREAR, LEER, ACTUALIZAR, ELIMINAR, DESCARGAR
-- Formato: MODULO.ACCION

-- INICIO
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(1, 'LEER', 'INICIO.LEER', 'Ver dashboard de inicio'),
(1, 'ACTUALIZAR_AFORO', 'INICIO.ACTUALIZAR_AFORO', 'Modificar aforos de tours');

-- RESERVAS
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(2, 'CREAR', 'RESERVAS.CREAR', 'Crear nuevas reservas'),
(2, 'LEER', 'RESERVAS.LEER', 'Ver listado de reservas'),
(2, 'ACTUALIZAR', 'RESERVAS.ACTUALIZAR', 'Editar reservas existentes'),
(2, 'ELIMINAR', 'RESERVAS.ELIMINAR', 'Eliminar reservas'),
(2, 'DESCARGAR', 'RESERVAS.DESCARGAR', 'Descargar comprobantes y reportes de reservas');

-- TOURS
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(3, 'CREAR', 'TOURS.CREAR', 'Crear nuevos tours'),
(3, 'LEER', 'TOURS.LEER', 'Ver listado de tours'),
(3, 'ACTUALIZAR', 'TOURS.ACTUALIZAR', 'Editar tours existentes'),
(3, 'ELIMINAR', 'TOURS.ELIMINAR', 'Eliminar tours'),
(3, 'DESCARGAR', 'TOURS.DESCARGAR', 'Descargar datos de tours');

-- PUNTOS
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(4, 'CREAR', 'PUNTOS.CREAR', 'Crear nuevos puntos de encuentro'),
(4, 'LEER', 'PUNTOS.LEER', 'Ver listado de puntos'),
(4, 'ACTUALIZAR', 'PUNTOS.ACTUALIZAR', 'Editar puntos existentes'),
(4, 'ELIMINAR', 'PUNTOS.ELIMINAR', 'Eliminar puntos'),
(4, 'DESCARGAR', 'PUNTOS.DESCARGAR', 'Descargar datos de puntos');

-- PROGRAMACION
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(5, 'CREAR', 'PROGRAMACION.CREAR', 'Crear programación de rutas'),
(5, 'LEER', 'PROGRAMACION.LEER', 'Ver programación'),
(5, 'ACTUALIZAR', 'PROGRAMACION.ACTUALIZAR', 'Editar programación'),
(5, 'ELIMINAR', 'PROGRAMACION.ELIMINAR', 'Eliminar programación'),
(5, 'DESCARGAR', 'PROGRAMACION.DESCARGAR', 'Descargar plan logístico');

-- TRANSFERS
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(6, 'CREAR', 'TRANSFERS.CREAR', 'Crear transfers'),
(6, 'LEER', 'TRANSFERS.LEER', 'Ver listado de transfers'),
(6, 'ACTUALIZAR', 'TRANSFERS.ACTUALIZAR', 'Editar transfers'),
(6, 'ELIMINAR', 'TRANSFERS.ELIMINAR', 'Eliminar transfers'),
(6, 'DESCARGAR', 'TRANSFERS.DESCARGAR', 'Descargar datos de transfers');

-- USUARIOS
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(7, 'CREAR', 'USUARIOS.CREAR', 'Crear nuevos usuarios'),
(7, 'LEER', 'USUARIOS.LEER', 'Ver listado de usuarios'),
(7, 'ACTUALIZAR', 'USUARIOS.ACTUALIZAR', 'Editar usuarios'),
(7, 'ELIMINAR', 'USUARIOS.ELIMINAR', 'Eliminar usuarios'),
(7, 'GESTIONAR_ROLES', 'USUARIOS.GESTIONAR_ROLES', 'Asignar roles y permisos');

-- HISTORIAL
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(8, 'LEER', 'HISTORIAL.LEER', 'Ver historial de cambios'),
(8, 'DESCARGAR', 'HISTORIAL.DESCARGAR', 'Descargar historial');

-- REPORTES
INSERT INTO `permisos` (`Id_Modulo`, `Accion`, `Codigo_Permiso`, `Descripcion`) VALUES
(9, 'LEER', 'REPORTES.LEER', 'Ver reportes'),
(9, 'DESCARGAR', 'REPORTES.DESCARGAR', 'Descargar reportes y exportar datos');

-- =====================================================
-- SEED DATA: Asignación de permisos a roles
-- =====================================================

-- ROL: Administrador (ID 1) - TODOS LOS PERMISOS
INSERT INTO `rol_permisos` (`Id_Rol`, `Id_Permiso`)
SELECT 1, Id_Permiso FROM permisos;

-- ROL: Asesor (ID 2) - Reservas completo + lectura de otros
INSERT INTO `rol_permisos` (`Id_Rol`, `Id_Permiso`)
SELECT 2, Id_Permiso FROM permisos WHERE Codigo_Permiso IN (
  'INICIO.LEER',
  'RESERVAS.CREAR', 'RESERVAS.LEER', 'RESERVAS.ACTUALIZAR', 'RESERVAS.DESCARGAR',
  'TOURS.LEER',
  'PUNTOS.LEER',
  'TRANSFERS.LEER',
  'HISTORIAL.LEER'
);

-- ROL: Consultor_TG_CTG_SF_CT (ID 3) - Solo lectura general
INSERT INTO `rol_permisos` (`Id_Rol`, `Id_Permiso`)
SELECT 3, Id_Permiso FROM permisos WHERE Codigo_Permiso IN (
  'INICIO.LEER',
  'RESERVAS.LEER',
  'TOURS.LEER',
  'PUNTOS.LEER',
  'PROGRAMACION.LEER'
);

-- ROL: Operador (ID 4) - Programación + lectura
INSERT INTO `rol_permisos` (`Id_Rol`, `Id_Permiso`)
SELECT 4, Id_Permiso FROM permisos WHERE Codigo_Permiso IN (
  'INICIO.LEER', 'INICIO.ACTUALIZAR_AFORO',
  'RESERVAS.LEER', 'RESERVAS.ACTUALIZAR',
  'TOURS.LEER',
  'PUNTOS.LEER', 'PUNTOS.ACTUALIZAR',
  'PROGRAMACION.CREAR', 'PROGRAMACION.LEER', 'PROGRAMACION.ACTUALIZAR', 'PROGRAMACION.DESCARGAR'
);

-- ROL: Solo_Lectura (ID 5) - Solo lectura
INSERT INTO `rol_permisos` (`Id_Rol`, `Id_Permiso`)
SELECT 5, Id_Permiso FROM permisos WHERE Accion = 'LEER';

-- =====================================================
-- Migrar usuarios existentes al nuevo sistema de roles
-- =====================================================
UPDATE usuarios SET Id_Rol = 1 WHERE Rol = 'Administrador';
UPDATE usuarios SET Id_Rol = 2 WHERE Rol = 'Asesor';
UPDATE usuarios SET Id_Rol = 3 WHERE Rol = 'Consultor_TG_CTG_SF_CT';
UPDATE usuarios SET Id_Rol = 4 WHERE Rol = 'Operador';
UPDATE usuarios SET Id_Rol = 5 WHERE Rol = 'Solo_Lectura';

-- Asignar rol por defecto (Asesor) a usuarios sin rol
UPDATE usuarios SET Id_Rol = 2 WHERE Id_Rol IS NULL;

-- Finalmente, agregar constraint FK (después de migrar datos)
ALTER TABLE `usuarios`
  ADD CONSTRAINT `fk_usuarios_rol` FOREIGN KEY (`Id_Rol`) REFERENCES `roles` (`Id_Rol`) ON DELETE SET NULL ON UPDATE CASCADE;
