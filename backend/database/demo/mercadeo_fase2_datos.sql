-- DEMOSTRACIÓN FASE 2: ejecutar solo manualmente en la base local de pruebas.
-- No crea pagos, liquidaciones ni registros de programación.
-- Identificador para los registros: MKT2D_. Para repetir la carga, revisar y ejecutar
-- primero mercadeo_fase2_borrar.sql.
START TRANSACTION;

SET @demo_prefix = 'MKT2D_';
SET @demo_creator = (SELECT Id_Usuario FROM usuarios ORDER BY Id_Usuario LIMIT 1);
SET @channel_hotel = (SELECT Id_Canal FROM canales_reservas WHERE UPPER(Nombre_Canal)='HOTEL' LIMIT 1);
SET @channel_national = (SELECT Id_Canal FROM canales_reservas WHERE UPPER(Nombre_Canal)='AGENCIA NACIONAL' LIMIT 1);
SET @channel_international = (SELECT Id_Canal FROM canales_reservas WHERE UPPER(Nombre_Canal)='AGENCIA INTERNACIONAL' LIMIT 1);
SET @channel_freelance = (SELECT Id_Canal FROM canales_reservas WHERE UPPER(Nombre_Canal)='FREELANCE' LIMIT 1);
SET @transfer_range = (SELECT Id_Rango FROM transfers_rangos WHERE Minimo >= 1 ORDER BY Minimo, Id_Rango LIMIT 1);
SET @transfer_people = (SELECT Minimo FROM transfers_rangos WHERE Id_Rango=@transfer_range LIMIT 1);
SET @transfer_service = (SELECT Id_Servicio FROM servicios_transfer ORDER BY Id_Servicio LIMIT 1);
SET @transfer_id_1 = (SELECT COALESCE(MAX(Id_Transfer), 10000) + 1 FROM transfers);
SET @transfer_id_2 = @transfer_id_1 + 1;

-- Verifica los catálogos requeridos antes de continuar. Si falta alguno, cancela con ROLLBACK.
SELECT @channel_hotel AS canal_hotel, @channel_national AS canal_agencia_nacional,
  @channel_international AS canal_agencia_internacional, @channel_freelance AS canal_freelance,
  @transfer_range AS rango_transfer, @transfer_service AS servicio_transfer,
  @demo_creator AS usuario_creador;

INSERT INTO entidades_reportantes
  (Tipo, Nombre, Nombre_Normalizado, Activo, Estado_Validacion, Creado_Por, Validado_En)
VALUES
  ('HOTEL', CONCAT(@demo_prefix,'Hotel validado reciente'), CONCAT(@demo_prefix,'hotel validado reciente'), 1, 'VALIDADA', @demo_creator, NOW()),
  ('AGENCIA_NACIONAL', CONCAT(@demo_prefix,'Agencia nacional validada'), CONCAT(@demo_prefix,'agencia nacional validada'), 1, 'VALIDADA', @demo_creator, NOW()),
  ('AGENCIA_INTERNACIONAL', CONCAT(@demo_prefix,'Agencia internacional pendiente'), CONCAT(@demo_prefix,'agencia internacional pendiente'), 1, 'PENDIENTE_VALIDACION', @demo_creator, NULL),
  ('HOTEL', CONCAT(@demo_prefix,'Hotel sin actividad antigua'), CONCAT(@demo_prefix,'hotel sin actividad antigua'), 1, 'VALIDADA', @demo_creator, DATE_SUB(NOW(), INTERVAL 150 DAY)),
  ('AGENCIA_NACIONAL', CONCAT(@demo_prefix,'Agencia validada inactiva'), CONCAT(@demo_prefix,'agencia validada inactiva'), 0, 'VALIDADA', @demo_creator, DATE_SUB(NOW(), INTERVAL 120 DAY)),
  ('AGENCIA_INTERNACIONAL', CONCAT(@demo_prefix,'Agencia rechazada'), CONCAT(@demo_prefix,'agencia rechazada'), 1, 'RECHAZADA', @demo_creator, NULL);

SET @entity_hotel = (SELECT Id_Entidad_Reportante FROM entidades_reportantes WHERE Nombre=CONCAT(@demo_prefix,'Hotel validado reciente') LIMIT 1);
SET @entity_national = (SELECT Id_Entidad_Reportante FROM entidades_reportantes WHERE Nombre=CONCAT(@demo_prefix,'Agencia nacional validada') LIMIT 1);

INSERT INTO reservas
  (Id_Reserva, Tipo_Reserva, Fecha_Tour, Fecha_Registro, Id_Canal, Id_Entidad_Reportante,
   Nombre_Reportante, Telefono_Reportante, Estado, Creado_Por, Actualizado_Por)
VALUES
  (CONCAT(@demo_prefix,'R01'), 'Grupal', DATE_ADD(CURDATE(), INTERVAL 14 DAY), DATE_SUB(NOW(), INTERVAL 120 DAY), @channel_hotel, @entity_hotel, 'Contacto demostración hotel', '3000000001', 'Pendiente', @demo_creator, @demo_creator),
  (CONCAT(@demo_prefix,'R02'), 'Grupal', DATE_ADD(CURDATE(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 12 DAY), @channel_national, @entity_national, 'Contacto demostración agencia', '3000000002', 'Pendiente', @demo_creator, @demo_creator),
  (CONCAT(@demo_prefix,'R03'), 'Grupal', DATE_ADD(CURDATE(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), @channel_freelance, NULL, 'Contacto canal freelance', '3000000003', 'Pendiente', @demo_creator, @demo_creator),
  (CONCAT(@demo_prefix,'R04'), 'Grupal', DATE_ADD(CURDATE(), INTERVAL 3 DAY), NOW(), @channel_hotel, @entity_hotel, 'Contacto reserva eliminada', '3000000004', 'Pendiente', @demo_creator, @demo_creator);

INSERT INTO pasajeros (Id_Reserva, Nombre_Pasajero, DNI)
VALUES
  (CONCAT(@demo_prefix,'R01'), 'Pasajero demo uno', 'MKT2D-P01'),
  (CONCAT(@demo_prefix,'R01'), 'Pasajero demo dos', 'MKT2D-P02'),
  (CONCAT(@demo_prefix,'R02'), 'Pasajero demo tres', 'MKT2D-P03'),
  (CONCAT(@demo_prefix,'R03'), 'Pasajero demo cuatro', 'MKT2D-P04'),
  (CONCAT(@demo_prefix,'R04'), 'Pasajero demo eliminado', 'MKT2D-P05');

-- Marca una reserva como eliminada para comprobar que no aparece en la consulta.
UPDATE reservas SET Eliminada_En=NOW(), Motivo_Eliminacion='Registro de demostración'
WHERE Id_Reserva=CONCAT(@demo_prefix,'R04');

INSERT INTO transfers
  (Id_Transfer, Id_Canal, Id_Entidad_Reportante, Nombre_Titular, DNI, Telefono_Titular,
   Cantidad_Personas, Id_Rango, Id_Servicio, Punto_Salida, Punto_Destino, Fecha_Transfer,
   Hora_Recogida, Nombre_Reportante, Telefono_Reportante, Valor, Id_Moneda, Estado,
   Observaciones, Creado_Por, Actualizado_Por, Fecha_Registro)
VALUES
  (@transfer_id_1, @channel_hotel, @entity_hotel, CONCAT(@demo_prefix,'Titular hotel'), 'MKT2D-T01', '3000000011',
   @transfer_people, @transfer_range, @transfer_service, 'Hotel demostración', 'Aeropuerto', DATE_ADD(CURDATE(), INTERVAL 8 DAY),
   '08:00:00', 'Contacto transfer hotel', '3000000012', 0, NULL, 'Pendiente',
   CONCAT(@demo_prefix,' Transfer con entidad hotel'), @demo_creator, @demo_creator, DATE_SUB(NOW(), INTERVAL 100 DAY)),
  (@transfer_id_2, @channel_national, @entity_national, CONCAT(@demo_prefix,'Titular agencia'), 'MKT2D-T02', '3000000021',
   @transfer_people, @transfer_range, @transfer_service, 'Agencia demostración', 'Centro', DATE_ADD(CURDATE(), INTERVAL 3 DAY),
   '09:30:00', 'Contacto transfer agencia', '3000000022', 0, NULL, 'Pendiente',
   CONCAT(@demo_prefix,' Transfer con entidad nacional'), @demo_creator, @demo_creator, DATE_SUB(NOW(), INTERVAL 8 DAY));

COMMIT;
