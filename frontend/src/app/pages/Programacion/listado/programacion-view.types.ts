import { Reserva } from '../../../interfaces/Programacion/reservas';

export interface ProgramacionViewStop {
  key: string;
  Id_Punto?: number | string | null;
  NombrePunto: string;
  reservas: (Reserva & { __paxEnEstePunto?: number })[];
  totalPax: number;
  ruta?: string | null;
  ordenRuta?: number | null;
  Latitud?: number | string | null;
  Longitud?: number | string | null;
}

export interface ProgramacionPrivadoGrupo {
  Id_Reserva: string | number;
  Nombre_Reportante?: string | null;
  Nombre_Tour?: string | null;
  totalPax: number;
  totalBuses: number;
  buses: any[];
}
