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
  Id_Punto: number | string;
  NombrePunto: string;
  Posicion: number;
  Latitud: string;
  Longitud: string;
}

/**
 * Representa un bus virtual dentro de una simulación o plan.
 */
export interface Bus {
  id: string;
  capacidad: number;
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
}

/**
 * Representa un tour en el contexto del dashboard, con estado adicional.
 */
export interface TourProgramacion {
  Id_Tour: number;
  NombreTour: string;
  // Propiedades adicionales para el estado del UI
  estado: 'Pendiente' | 'Generado' | 'Confirmado' | 'Error';
  planGenerado: PlanLogistico | null;
  totalPasajeros?: number;
  totalReservas?: number;
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
