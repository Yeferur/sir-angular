const DEFAULT_DIAS_SIN_REPORTAR = 90;
const CONFIGURACION_REGLA_KEY = 'diasSinReportar';

function resolverDiasSinReportar(configuracionRegla = null) {
  const configuracion = configuracionRegla && typeof configuracionRegla === 'object'
    ? configuracionRegla[CONFIGURACION_REGLA_KEY]
    : null;
  const candidato = configuracion ?? process.env.ENTIDADES_REPORTANTES_DIAS_SIN_REPORTAR;
  const dias = Number(candidato);
  return Number.isSafeInteger(dias) && dias >= 1 && dias <= 36500
    ? dias
    : DEFAULT_DIAS_SIN_REPORTAR;
}

module.exports = {
  DEFAULT_DIAS_SIN_REPORTAR,
  CONFIGURACION_REGLA_KEY,
  resolverDiasSinReportar,
  DIAS_SIN_REPORTAR_ALERTA: resolverDiasSinReportar(),
};
