-- Conciliacion contra "users sir antiguo.sql" (fuente autoritativa confirmada).
-- Para usuarios existentes se conserva siempre el hash de contraseña actual.

INSERT INTO usuarios
  (Id_Usuario, Nombres_Apellidos, Telefono_Usuario, Usuario, Correo, Contrasena, Id_Rol, Id_Canal, Activo)
VALUES
  (1000537194, 'Ana Sofia Daza Muñoz', '3217017429', 'Asesor14Maxi', 'daza4914@gmail.com',
   '$2a$08$shXw04G4z0O5vD8nkCocG.ZcLtKnknk3LXE/RAT01TJCgIDIaX5cC',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Asesor' LIMIT 1),
   (SELECT Id_Canal FROM canales_turno WHERE Nombre_Canal = 'Medios Digitales' LIMIT 1), 1),
  (1146441965, 'Luna Ramirez Gomez', '3113577689', 'Medellin26', 'lunaprecalificacion@gmail.com',
   '$2a$08$Sba0yxd/KBk5rBcrxp9zfuPo6rgF4m.TLH1z9zI7v6wJLv3.eT42C',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Cliente' LIMIT 1), NULL, 1),
  (1027661397, 'Isabella Suárez Suárez', '3224347068', '1027661397', 'isabellaasuarezz17@gmail.com',
   '$2a$08$K8HjrHh9MsM/OOK3NAyisemsTZ3Ep50GZfS1HYCYZRPMGkTdD.T/e',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Asesor' LIMIT 1), NULL, 1),
  (1000405114, 'Angie Lorena Aguilar Raigosa', '3023007308', 'Asesor15Maxi', 'Angieraigoza2824@gmail.com',
   '$2a$08$89cD4/PejFnr68PCcmD0XOJF.2i3K8H4PfOs4AsdOCL.qs7jbF7tu',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Asesor' LIMIT 1),
   (SELECT Id_Canal FROM canales_turno WHERE Nombre_Canal = 'Hoteles y Agencias' LIMIT 1), 1),
  (1032014627, 'Jimena Chica Vasco', '573128493523', '1032014627', 'jimenachica8272@icloud.com',
   '$2a$08$mFsUKx5D2Q/xu9se9MnLiuX5wlkw3clGwSItssxU.a7wCHnaFH75i',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Asesor' LIMIT 1),
   (SELECT Id_Canal FROM canales_turno WHERE Nombre_Canal = 'Medios Digitales' LIMIT 1), 1),
  (1035426830, 'Luisa Fernanda Orrego Cardona', '3008786986', '1035426830', 'Lufdaorregoc330@hotmail.com',
   '$2a$08$5mje5bY0Hmo3JE5yOgABcO1tEvYJleMHs0Apm30Ap0RwGEpBnayEu',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Asesor' LIMIT 1), NULL, 1),
  (43917211, 'Julieth Natalia López Flórez', '3015625912', 'n.lopez@viajesmaxitours.com', 'n.lopez@viajesmaxitours.com',
   '$2a$08$OW8nAnSQnVtRwO3XF1Wo9.YkZG8rAlVia5EbJdK3Sc2nLV8CYPUxu',
   (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Administrador' LIMIT 1), NULL, 1)
ON DUPLICATE KEY UPDATE
  Nombres_Apellidos = VALUES(Nombres_Apellidos),
  Telefono_Usuario = VALUES(Telefono_Usuario),
  Usuario = VALUES(Usuario),
  Correo = VALUES(Correo),
  Id_Rol = VALUES(Id_Rol),
  Id_Canal = COALESCE(VALUES(Id_Canal), Id_Canal),
  Activo = 1;

-- Estas dos personas siguen siendo asesoras aunque el sistema antiguo les
-- diera rol Administrador para suplir la falta de permisos granulares.
UPDATE usuarios
SET Id_Rol = (SELECT Id_Rol FROM roles WHERE Nombre_Rol = 'Asesor' LIMIT 1), Activo = 1
WHERE Id_Usuario IN (1006209620, 1000099025);

-- Eliminacion confirmada: no tiene reservas en la version nueva.
DELETE FROM usuarios
WHERE Id_Usuario = 1047496358
  AND Nombres_Apellidos = 'Sharon Daniela Velaides Orellano';

-- Eliminacion confirmada: no tiene reservas en la version nueva.
DELETE FROM usuarios
WHERE Id_Usuario = 1128436633
  AND Nombres_Apellidos = 'Alejandra García Villada';
