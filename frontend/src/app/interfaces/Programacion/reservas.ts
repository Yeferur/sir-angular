/**
 * ===================================================================================
 * INTERFACES PARA EL ASISTENTE DE LOGÍSTICA INTELIGENTE
 * ===================================================================================
 * Este archivo define las estructuras de datos (los "contratos") que se utilizan
 * entre el backend y el frontend para la programación de buses.
 * ===================================================================================
 */

/**
 * Representa una única reserva con la información necesaria para la logística.
 */
export interface Reserva {
  Id_Reserva: string;
  NumeroPasajeros: number;
  NombreContacto?: string | null;
  Nombre?: string | null;
  Nombre_Reportante?: string | null;
  NombreReporta?: string | null;
  Idioma_Reserva?: string | null;
  IdiomaReserva?: string | null;
  Id_Punto: number | string | null;
  idPunto?: number | string | null;
  IdPunto?: number | string | null;
  NombrePunto: string;
  PuntoEncuentro?: string;
  Posicion: number;
  Latitud: string | number | null;
  Longitud: string | number | null;
  Placa_Bus?: string | null;
  Orden_Ruta?: number | null;
  ordenRuta?: number | null;
  ruta?: string | null;
}

export interface PuntoDestinoProgramacion {
  lat: number;
  lng: number;
  nombre?: string | null;
}

export interface DestinoTourProgramacion {
  idTour?: number | null;
  // Compatibilidad con respuestas anteriores, donde solo existía un destino.
  lat?: number;
  lng?: number;
  nombre?: string | null;
  horaSalidaBase?: string | null;
  primeraParadaOperativa?: PuntoDestinoProgramacion | null;
  tour?: PuntoDestinoProgramacion | null;
}

/**
 * Representa un bus virtual dentro de una simulación o plan.
 */
export interface Bus {
  id: string;
  capacidad: number;
  capacidadManual?: boolean;
  ocupados: number;
  reservas: Reserva[];
  recorridoKm: number;
  guia?: string;
}

/**
 * Representa una de las soluciones propuestas por el "cerebro".
 * Es una combinación de flota con sus rutas y costos calculados.
 */
export interface Sugerencia {
  combinacion: number[];
  buses: Bus[];
  costoTotalKm: number;
  ocupacionPromedio: number;
  totalBuses: number;
  reservasSinAsignar: Reserva[];
}

/**
 * Contiene los datos de resumen del análisis inicial del tour.
 */
export interface Analisis {
  fecha: string;
  idTour: number;
  totalPasajeros: number;
  totalReservas: number;
}

/**
 * El objeto principal que devuelve el backend al generar un plan.
 */
export interface PlanLogistico {
  analisis: Analisis;
  sugerencias: Sugerencia[];
  mensaje: string;
  plan?: Sugerencia; // Se usa en la respuesta del modo asistido
  buses?: Bus[];
  reservasSinAsignar?: Reserva[];
  alertas?: any[];
  destinoTour?: DestinoTourProgramacion | null;
}

/**
 * Representa un tour en el contexto del dashboard, con estado adicional.
 */
export interface TourProgramacion {
  Id_Tour: number;
  NombreTour: string;
  Latitud?: number | string | null;
  Longitud?: number | string | null;
  // Propiedades adicionales para el estado del UI
  estado: 'Pendiente' | 'Generado' | 'Confirmado' | 'Error';
  planGenerado: PlanLogistico | null;
  totalPasajeros?: number;
  totalReservas?: number;
  totalBuses?: number;
  ocupacionPromedio?: number;
  reservasSinAsignar?: Reserva[];
}

/**
 * Define la estructura del objeto que se envía al backend para el Modo Asistido.
 */
export interface PlanAsistidoPayload {
  fecha: string;
  idTour: number;
  flotaManual: number[];
  reservasAncladas?: any[]; // Para desarrollo futuro
}
