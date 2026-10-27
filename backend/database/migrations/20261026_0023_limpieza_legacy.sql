-- Retira el almacenamiento legacy de beneficiarios y las tablas de mensajería antigua.
-- Los datos de pago de liquidaciones quedan conservados en sus columnas snapshot.
ALTER TABLE reservas DROP FOREIGN KEY fk_reservas_beneficiario_comision;
ALTER TABLE reservas DROP INDEX idx_reservas_beneficiario_comision;
ALTER TABLE reservas DROP COLUMN Id_Beneficiario_Comision;

ALTER TABLE liquidaciones DROP FOREIGN KEY fk_liquidaciones_beneficiario_comision;
ALTER TABLE liquidaciones DROP INDEX idx_liquidaciones_beneficiario;
ALTER TABLE liquidaciones DROP COLUMN Id_Beneficiario_Comision;

DROP TABLE beneficiarios_comision_documentos;
DROP TABLE beneficiarios_comision;
DROP TABLE mensaje_destinatario;
DROP TABLE mensajes;
