const { filtrarTransfersSvc, getDetalleTransferSvc } = require('../../Transfers/transfers.service');

function parseTransferCode(rawValue) {
  const raw = String(rawValue || '').trim().toUpperCase();
  const match = raw.match(/(\d{1,10})$/);
  return match ? Number(match[1]) : null;
}

async function executeConsultarTransferPorCodigo({ input }) {
  const transferId = parseTransferCode(input.codigoTransfer);
  const data = transferId ? await getDetalleTransferSvc(transferId) : null;

  return {
    rows: data ? [data] : [],
    entityType: 'transfers',
    tables: ['transfers', 'pagos_transfers'],
    expectedAction: 'ver_transfers',
    filters: { query: input.codigoTransfer },
  };
}

async function executeConsultarTransfersFecha({ input }) {
  const fecha = String(input.fecha || '').trim();
  const includePending = Boolean(input.includePending);
  const rows = await filtrarTransfersSvc({
    Fecha_Transfer: fecha,
    ...(includePending ? { Estado: ['Pendiente', 'Pendiente de pago', 'Pendiente Pago'] } : {}),
  });

  return {
    rows,
    total: rows.length,
    entityType: 'transfers',
    tables: ['transfers', 'servicios_transfer'],
    expectedAction: 'ver_transfers',
    filters: { date: fecha, includePending },
  };
}

async function executeConsultarTransfersPendientesPago({ input }) {
  const fecha = String(input.fecha || '').trim();
  const rows = await filtrarTransfersSvc({
    Fecha_Transfer: fecha,
    Estado: ['Pendiente de pago', 'Pendiente Pago', 'Pendiente'],
  });

  return {
    rows,
    total: rows.length,
    entityType: 'transfers',
    tables: ['transfers', 'servicios_transfer'],
    expectedAction: 'ver_transfers',
    filters: { date: fecha, paymentStatus: 'pending' },
  };
}

const transfersTools = [
  {
    name: 'consultar_transfer_por_codigo',
    description: 'Consulta un transfer específico por su código.',
    inputSchema: {
      type: 'object',
      properties: {
        codigoTransfer: { type: 'string', minLength: 3, maxLength: 40 },
      },
      required: ['codigoTransfer'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TRANSFERS.LEER',
    module: 'transfers',
    execute: executeConsultarTransferPorCodigo,
  },
  {
    name: 'consultar_transfers_fecha',
    description: 'Consulta transfers de una fecha específica.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        includePending: { type: 'boolean' },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TRANSFERS.LEER',
    module: 'transfers',
    execute: executeConsultarTransfersFecha,
  },
  {
    name: 'consultar_transfers_pendientes_pago',
    description: 'Consulta transfers pendientes de pago por fecha.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['fecha'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TRANSFERS.LEER',
    module: 'transfers',
    execute: executeConsultarTransfersPendientesPago,
  },
];

module.exports = {
  transfersTools,
};
