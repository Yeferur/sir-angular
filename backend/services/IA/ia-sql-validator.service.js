const { Parser } = require('node-sql-parser');

const {
  SENSITIVE_COLUMN_PATTERNS,
  getAllowedTable,
  getAllowedTableMap,
  normalizeIdentifier,
} = require('./ia-schema-context');

const parser = new Parser();
const BLOCKED_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'truncate',
  'create',
  'replace',
  'grant',
  'revoke',
  'call',
  'execute',
];

function buildValidationError(message, details = {}) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'IA_SQL_VALIDATION_ERROR';
  error.userMessage = 'No pude ejecutar esa consulta porque no cumple las reglas de lectura segura.';
  error.details = details;
  return error;
}

function normalizeSql(sql) {
  return String(sql || '').trim();
}

function containsBlockedKeyword(sql) {
  const lowered = normalizeSql(sql).toLowerCase();
  return BLOCKED_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(lowered)) || null;
}

function containsMultipleStatements(sql) {
  const trimmed = normalizeSql(sql);
  const sanitized = trimmed.replace(/;+\s*$/, '');
  return sanitized.includes(';');
}

function hasSqlComments(sql) {
  return /--|\/\*/.test(normalizeSql(sql));
}

function getLimitValue(limitNode) {
  if (!limitNode || !Array.isArray(limitNode.value) || limitNode.value.length === 0) {
    return null;
  }

  const last = limitNode.value[limitNode.value.length - 1];
  const numericValue = Number(last?.value);
  return Number.isInteger(numericValue) ? numericValue : null;
}

function collectColumnRefs(node, bucket = []) {
  if (!node || typeof node !== 'object') {
    return bucket;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectColumnRefs(item, bucket);
    }
    return bucket;
  }

  if (node.type === 'column_ref') {
    bucket.push(node);
  }

  for (const value of Object.values(node)) {
    collectColumnRefs(value, bucket);
  }

  return bucket;
}

function validateSelectedColumns(ast) {
  for (const column of ast.columns || []) {
    const expr = column?.expr;
    if (!expr) continue;

    if (expr.type === 'star') {
      throw buildValidationError('SELECT * no esta permitido.');
    }

    if (expr.type === 'column_ref' && expr.column === '*') {
      throw buildValidationError('SELECT * no esta permitido.');
    }
  }
}

function resolveTableAliases(ast) {
  const aliasMap = new Map();
  const referencedTables = new Map();

  for (const fromEntry of ast.from || []) {
    const tableName = normalizeIdentifier(fromEntry?.table);
    const allowedTable = getAllowedTable(tableName);

    if (!allowedTable) {
      throw buildValidationError(`La tabla ${fromEntry?.table || '(desconocida)'} no esta permitida.`);
    }

    const alias = normalizeIdentifier(fromEntry?.as || tableName);
    aliasMap.set(alias, allowedTable);
    aliasMap.set(tableName, allowedTable);
    referencedTables.set(allowedTable.sqlName, allowedTable);

    if (fromEntry?.join && fromEntry?.on) {
      const joinRefs = collectColumnRefs(fromEntry.on);
      validateColumnRefs(joinRefs, aliasMap, Array.from(referencedTables.values()));
    }
  }

  return {
    aliasMap,
    referencedTables: Array.from(referencedTables.values()),
  };
}

function validateColumnRefs(columnRefs, aliasMap, referencedTables) {
  const allowedTables = referencedTables;
  const allowedTableMap = getAllowedTableMap();

  for (const ref of columnRefs) {
    const columnName = String(ref.column || '').trim();
    const normalizedColumn = normalizeIdentifier(columnName);
    const normalizedTable = normalizeIdentifier(ref.table);

    if (!columnName) {
      continue;
    }

    if (normalizedColumn === '*') {
      continue;
    }

    if (SENSITIVE_COLUMN_PATTERNS.some((pattern) => normalizedColumn.includes(normalizeIdentifier(pattern)))) {
      throw buildValidationError(`La columna ${columnName} es sensible y no puede consultarse.`);
    }

    if (normalizedTable) {
      const table = aliasMap.get(normalizedTable) || allowedTableMap[normalizedTable];
      if (!table) {
        throw buildValidationError(`La tabla o alias ${ref.table} no esta permitido.`);
      }

      if (!table.allowedColumns.includes(columnName)) {
        throw buildValidationError(`La columna ${columnName} no esta permitida en ${table.sqlName}.`);
      }

      continue;
    }

    const matches = allowedTables.filter((table) => table.allowedColumns.includes(columnName));
    if (matches.length === 0) {
      throw buildValidationError(`La columna ${columnName} no pertenece al esquema permitido.`);
    }
  }
}

function validateSqlCandidate(sql) {
  const candidateSql = normalizeSql(sql);

  if (!candidateSql) {
    throw buildValidationError('No se recibio SQL para validar.');
  }

  if (hasSqlComments(candidateSql)) {
    throw buildValidationError('Los comentarios SQL no estan permitidos.');
  }

  const blockedKeyword = containsBlockedKeyword(candidateSql);
  if (blockedKeyword) {
    throw buildValidationError(`La palabra ${blockedKeyword.toUpperCase()} no esta permitida.`);
  }

  if (containsMultipleStatements(candidateSql)) {
    throw buildValidationError('Solo se permite una sentencia SQL.');
  }

  let ast;
  try {
    ast = parser.astify(candidateSql, { database: 'MySQL' });
  } catch (error) {
    throw buildValidationError('El SQL generado no es valido para MySQL.', { parserMessage: error.message });
  }

  if (Array.isArray(ast)) {
    throw buildValidationError('Solo se permite una sentencia SQL.');
  }

  if (!ast || ast.type !== 'select') {
    throw buildValidationError('Solo se permiten consultas SELECT.');
  }

  if (ast.with) {
    throw buildValidationError('Las consultas WITH no estan permitidas en esta fase.');
  }

  if (ast._next) {
    throw buildValidationError('UNION o multiples bloques SELECT no estan permitidos en esta fase.');
  }

  validateSelectedColumns(ast);

  const limitValue = getLimitValue(ast.limit);
  if (!Number.isInteger(limitValue)) {
    throw buildValidationError('La consulta debe incluir LIMIT explicito.');
  }

  if (limitValue < 1 || limitValue > 100) {
    throw buildValidationError('El LIMIT debe estar entre 1 y 100.');
  }

  const { aliasMap, referencedTables } = resolveTableAliases(ast);
  if (!referencedTables.length) {
    throw buildValidationError('La consulta debe referenciar al menos una tabla permitida.');
  }

  const columnRefs = collectColumnRefs(ast);
  validateColumnRefs(columnRefs, aliasMap, referencedTables);

  return {
    sql: candidateSql.replace(/;+\s*$/, ''),
    ast,
    tables: referencedTables.map((table) => table.logicalName),
    sqlTables: referencedTables.map((table) => table.sqlName),
    requiredPermissions: Array.from(new Set(referencedTables.map((table) => table.permission))),
    limit: limitValue,
  };
}

module.exports = {
  buildValidationError,
  validateSqlCandidate,
};
