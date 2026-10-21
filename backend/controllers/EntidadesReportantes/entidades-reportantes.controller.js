const service = require('../../services/EntidadesReportantes/entidades-reportantes.service');
const marketing = require('../../services/EntidadesReportantes/entidades-mercadeo.service');

const handle = work => async (req, res) => {
  try { await work(req, res); }
  catch (e) {
    console.error('Entidad reportante:', e.code || e.errorCode || e.message);
    res.status(e.status || 500).json({ success: false, data: null,
      message: e.status ? e.message : 'Error interno', errorCode: e.errorCode || 'INTERNAL_ERROR' });
  }
};

exports.list = handle(async (req, res) => {
  const data = await service.listEntities({ type: req.query.tipo || undefined, search: req.query.buscar || '',
    limit: req.query.limite, includeInactive: req.query.incluirInactivas === '1' });
  res.json({ success: true, data });
});

exports.quickCreate = handle(async (req, res) => {
  const result = await service.quickCreate({ channelId: req.body?.Id_Canal,
    name: req.body?.Nombre, actorId: req.user?.id });
  res.status(result.created ? 201 : 200).json({ success: true, data: result.entity, created: result.created });
});

exports.validate = handle(async (req, res) => {
  const data = await service.validateEntity(req.params.id, req.body?.Estado_Validacion,
    req.user?.id, req.body?.Motivo_Rechazo);
  res.json({ success: true, data });
});

exports.activity = handle(async (req, res) => {
  const permissions = req.userPermissions || [];
  const validatorOnly = permissions.includes('ENTIDADES_REPORTANTES.VALIDAR')
    && !permissions.includes('ENTIDADES_REPORTANTES.LEER');
  const query = validatorOnly ? { ...req.query, validacion: 'PENDIENTE_VALIDACION' } : req.query;
  res.json({ success: true, data: await marketing.listActivity(query) });
});
exports.detail = handle(async (req, res) => {
  const permissions = req.userPermissions || [];
  const validatorOnly = permissions.includes('ENTIDADES_REPORTANTES.VALIDAR')
    && !permissions.includes('ENTIDADES_REPORTANTES.LEER');
  const data = await marketing.detail(req.params.id, req.query);
  if (validatorOnly && data.entity.Estado_Validacion !== 'PENDIENTE_VALIDACION') {
    const denied = new Error('Entidad reportante no encontrada.');
    denied.status = 404;
    denied.errorCode = 'ENTITY_NOT_FOUND';
    throw denied;
  }
  res.json({ success: true, data });
});
exports.create = handle(async (req, res) => {
  res.status(201).json({ success: true, data: await marketing.createEntity(req.body || {}, req.user?.id) });
});
exports.update = handle(async (req, res) => {
  res.json({ success: true, data: await marketing.updateEntity(req.params.id, req.body || {}, req.user?.id) });
});
exports.setPoint = handle(async (req, res) => {
  res.json({ success: true, data: await marketing.setPoint(req.params.id, req.params.pointId,
    req.method === 'PUT', req.user?.id) });
});
exports.exportExcel = async (req, res) => {
  try {
    marketing.filters(req.query || {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="mercadeo-entidades-resumen.xlsx"');
    await marketing.streamExcel(req.query || {}, res);
  } catch (e) {
    if (res.headersSent) return res.destroy(e);
    console.error('Exportación de entidades reportantes:', e.code || e.errorCode || e.message);
    res.status(e.status || 500).json({ success: false, data: null,
      message: e.status ? e.message : 'No fue posible exportar las entidades.',
      errorCode: e.errorCode || 'EXPORT_FAILED' });
  }
};
