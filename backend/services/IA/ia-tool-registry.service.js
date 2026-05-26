const { inicioTools } = require('./tools/ia-inicio.tools');
const { dashboardTools } = require('./tools/ia-dashboard.tools');
const { programacionTools } = require('./tools/ia-programacion.tools');
const { reservasTools } = require('./tools/ia-reservas.tools');
const { transfersTools } = require('./tools/ia-transfers.tools');
const { toursTools } = require('./tools/ia-tours.tools');
const { puntosTools } = require('./tools/ia-puntos.tools');

function findTool(tools, name) {
  return tools.find((tool) => tool.name === name);
}

const reservaPorCodigoTool = findTool(reservasTools, 'consultar_reserva_por_codigo');
const reservasFechaTool = findTool(reservasTools, 'consultar_reservas_fecha_tour');
const reservasPendientesTool = findTool(reservasTools, 'consultar_reservas_pendientes_pago');
const transferPorCodigoTool = findTool(transfersTools, 'consultar_transfer_por_codigo');
const transfersFechaTool = findTool(transfersTools, 'consultar_transfers_fecha');
const cuposTourFechaTool = findTool(toursTools, 'consultar_cupos_tour_fecha');
const consultarTourTool = findTool(toursTools, 'consultar_tour');
const diagnosticarOperacionTool = findTool(dashboardTools, 'diagnosticar_operacion');

const legacyAliasTools = [
  {
    name: 'consultar_reservas',
    description: 'Alias legacy para consultar reservas por fecha o tour.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        tourLike: { type: 'string', minLength: 2, maxLength: 120 },
        status: { type: 'string', minLength: 2, maxLength: 60 },
        paymentStatus: { type: 'string', enum: ['pending'] },
        countOnly: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'RESERVAS.LEER',
    module: 'reservas',
    execute: async ({ input, user, context, helpers }) => {
      if (input.paymentStatus === 'pending') {
        return reservasPendientesTool.execute({
          input: {
            fecha: input.date,
            tourName: input.tourLike || null,
          },
          user,
          context,
          helpers,
        });
      }

      return reservasFechaTool.execute({
        input: {
          fecha: input.date,
          tourName: input.tourLike || null,
        },
        user,
        context,
        helpers,
      });
    },
  },
  {
    name: 'consultar_pagos',
    description: 'Alias legacy para consultar reservas pendientes de pago.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string', enum: ['reservas'] },
        paymentStatus: { type: 'string', enum: ['pending'] },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        tourLike: { type: 'string', minLength: 2, maxLength: 120 },
        countOnly: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'RESERVAS.LEER',
    module: 'reservas',
    execute: async ({ input, user, context, helpers }) => reservasPendientesTool.execute({
      input: {
        fecha: input.date,
        tourName: input.tourLike || null,
      },
      user,
      context,
      helpers,
    }),
  },
  {
    name: 'consultar_transfers',
    description: 'Alias legacy para consultar transfers por fecha.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        status: { type: 'string', minLength: 2, maxLength: 60 },
        countOnly: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TRANSFERS.LEER',
    module: 'transfers',
    execute: async ({ input, user, context, helpers }) => transfersFechaTool.execute({
      input: {
        fecha: input.date,
        includePending: /pendiente/i.test(String(input.status || '')),
      },
      user,
      context,
      helpers,
    }),
  },
  {
    name: 'consultar_cupos',
    description: 'Alias legacy para consultar cupos por tour y fecha.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        tourLike: { type: 'string', minLength: 2, maxLength: 120 },
      },
      required: ['date'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TOURS.LEER',
    module: 'tours',
    execute: async ({ input, user, context, helpers }) => cuposTourFechaTool.execute({
      input: {
        fecha: input.date,
        tourName: input.tourLike || null,
      },
      user,
      context,
      helpers,
    }),
  },
  {
    name: 'consultar_tours',
    description: 'Alias legacy para consultar tours.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 120 },
      },
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'TOURS.LEER',
    module: 'tours',
    execute: async ({ input, user, context, helpers }) => consultarTourTool.execute({
      input: {
        query: input.query || null,
      },
      user,
      context,
      helpers,
    }),
  },
  {
    name: 'diagnosticar_operacion',
    description: diagnosticarOperacionTool.description,
    inputSchema: diagnosticarOperacionTool.inputSchema,
    riskLevel: diagnosticarOperacionTool.riskLevel,
    requiresConfirmation: diagnosticarOperacionTool.requiresConfirmation,
    requiredPermission: diagnosticarOperacionTool.requiredPermission,
    module: diagnosticarOperacionTool.module,
    execute: diagnosticarOperacionTool.execute,
  },
  {
    name: 'consultar_reserva_por_codigo',
    description: reservaPorCodigoTool.description,
    inputSchema: reservaPorCodigoTool.inputSchema,
    riskLevel: reservaPorCodigoTool.riskLevel,
    requiresConfirmation: false,
    requiredPermission: reservaPorCodigoTool.requiredPermission,
    module: reservaPorCodigoTool.module,
    execute: reservaPorCodigoTool.execute,
  },
  {
    name: 'consultar_transfer_por_codigo',
    description: transferPorCodigoTool.description,
    inputSchema: transferPorCodigoTool.inputSchema,
    riskLevel: transferPorCodigoTool.riskLevel,
    requiresConfirmation: false,
    requiredPermission: transferPorCodigoTool.requiredPermission,
    module: transferPorCodigoTool.module,
    execute: transferPorCodigoTool.execute,
  },
];

const legacyFallbackTools = [
  {
    name: 'buscar_entidad',
    description: 'Busca una entidad operativa por nombre o referencia corta como un tour, un punto, una reserva o un transfer.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: null,
    module: 'legacy',
  },
  {
    name: 'consultar_puntos',
    description: 'Consulta puntos de encuentro por nombre, sector o coincidencia operativa.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 120 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    riskLevel: 'read',
    requiresConfirmation: false,
    requiredPermission: 'PUNTOS.LEER',
    module: 'legacy',
  },
];

const IA_TOOLS = [
  ...inicioTools,
  ...dashboardTools.filter((tool) => tool.name !== 'diagnosticar_operacion'),
  ...programacionTools,
  ...reservasTools,
  ...transfersTools,
  ...toursTools,
  ...puntosTools,
  ...legacyAliasTools,
  ...legacyFallbackTools,
];

function listIaTools() {
  return IA_TOOLS.map((tool) => ({ ...tool }));
}

function getIaToolByName(toolName) {
  return IA_TOOLS.find((tool) => tool.name === String(toolName || '').trim()) || null;
}

module.exports = {
  listIaTools,
  getIaToolByName,
};
