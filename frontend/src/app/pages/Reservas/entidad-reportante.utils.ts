import type { Canal, EntidadReportante } from '../../services/Reservas/reservas';

const types: Record<string, EntidadReportante['Tipo']> = {
  HOTEL: 'HOTEL',
  'AGENCIA NACIONAL': 'AGENCIA_NACIONAL',
  'AGENCIA INTERNACIONAL': 'AGENCIA_INTERNACIONAL',
};

export function tipoEntidadPorCanal(canales: Canal[], idCanal: unknown): EntidadReportante['Tipo'] | null {
  const canal = canales.find(item => String(item.Id_Canal) === String(idCanal));
  return canal ? types[String(canal.Nombre_Canal).trim().toLocaleUpperCase('es')] ?? null : null;
}

export function claveNombreEntidad(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
