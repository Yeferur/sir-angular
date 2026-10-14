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
    limit: req.query.limite });
  res.json({ success: true, data });
});

exports.quickCreate = handle(async (req, res) => {
  const result = await service.quickCreate({ channelId: req.body?.Id_Canal,
    name: req.body?.Nombre, actorId: req.user?.id });
  res.status(result.created ? 201 : 200).json({ success: true, data: result.entity, created: result.created });
});

exports.validate = handle(async (req, res) => {
  const data = await service.validateEntity(req.params.id, req.body?.Estado_Validacion, req.user?.id);
  res.json({ success: true, data });
});

exports.activity = handle(async (req, res) => {
  res.json({ success: true, data: await marketing.listActivity(req.query) });
});
exports.detail = handle(async (req, res) => {
  res.json({ success: true, data: await marketing.detail(req.params.id, req.query) });
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
exports.exportExcel = handle(async (req, res) => {
  const buffer = await marketing.exportExcel(req.query);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="entidades-reportantes.xlsx"');
  res.send(buffer);
});
