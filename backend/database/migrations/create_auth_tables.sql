-- Crear tabla roles
CREATE TABLE IF NOT EXISTS `roles` (
  `Id_Rol` int(11) NOT NULL AUTO_INCREMENT,
  `Nombre_Rol` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`Id_Rol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crear tabla permisos
CREATE TABLE IF NOT EXISTS `permisos` (
  `Id_Permiso` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Nombre_Permiso` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`Id_Permiso`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crear tabla permisos_usuarios
CREATE TABLE IF NOT EXISTS `permisos_usuarios` (
  `Id_Usuario` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Id_Permiso` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Fecha_Asignacion` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id_Usuario`, `Id_Permiso`),
  KEY `Id_Permiso` (`Id_Permiso`),
  CONSTRAINT `fk_perm_user_usuario` FOREIGN KEY (`Id_Usuario`) REFERENCES `usuarios` (`Id_Usuario`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_perm_user_permiso` FOREIGN KEY (`Id_Permiso`) REFERENCES `permisos` (`Id_Permiso`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar roles básicos si no existen
INSERT IGNORE INTO `roles` (`Id_Rol`, `Nombre_Rol`) VALUES
(1, 'Administrador'),
(2, 'Operador'),
(3, 'Usuario');

-- Insertar permisos básicos si no existen
INSERT IGNORE INTO `permisos` (`Id_Permiso`, `Nombre_Permiso`, `Descripcion`) VALUES
('USUARIOS.LEER', 'Ver Usuarios', 'Permite ver la lista de usuarios'),
('USUARIOS.CREAR', 'Crear Usuarios', 'Permite crear nuevos usuarios'),
('USUARIOS.EDITAR', 'Editar Usuarios', 'Permite editar usuarios existentes'),
('USUARIOS.ELIMINAR', 'Eliminar Usuarios', 'Permite eliminar usuarios'),
('INICIO.ACTUALIZAR_AFORO', 'Actualizar Aforo', 'Permite modificar cupos en el dashboard');
