import { Component, inject, OnInit, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramacionDashboardService } from '../../../services/Programacion/programacion';
import { PlanLogistico, Sugerencia, TourProgramacion, PlanAsistidoPayload, Bus, Reserva } from '../../../interfaces/Programacion/reservas';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-programacion-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './listado.html',
  styleUrls: ['./listado.css'] // Un nuevo CSS para el dashboard
})
export class Listado implements OnInit {
  // Inyección de dependencias
  private programacionService = inject(ProgramacionDashboardService);
  private cdr = inject(ChangeDetectorRef);
  private navbar = inject(DynamicIslandGlobalService);

  // Estado General del Componente
  fechaSeleccionada: string = new Date().toISOString().split('T')[0];
  toursDelDia: TourProgramacion[] = [];
  cargando = false;
  modoVista: 'dashboard' | 'editor' = 'dashboard';

  // Estado para el Modal y el Editor
  tourSeleccionado: TourProgramacion | null = null;
  planSeleccionado: Sugerencia | null = null;
  flotaManual: { capacidad: number | null }[] = [{ capacidad: null }];

  // 👇 Efecto reactivo como propiedad de clase
  private _reactToSeleccion = effect(() => {
    const sugerencia = this.navbar.seleccionSugerencia$();
    if (sugerencia) {
      this.seleccionarSugerenciaParaEditar(sugerencia);
    }
  });
  ngOnInit(): void {
    this.cargarToursDelDia();

  }

  // --- LÓGICA DEL MODO DASHBOARD ---

  cargarToursDelDia(): void {
    this.cargando = true;
    this.toursDelDia = [];
    this.programacionService.getTours().subscribe({
      next: (tours) => {
        this.toursDelDia = tours.map(t => ({ ...t, estado: 'Pendiente' }));
        this.cargando = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error al cargar tours', err);
        this.cargando = false;
      }
    });
  }

  generarPlan(tour: TourProgramacion): void {
    this.navbar.alert.set({
      title: 'Generando plan...',
      message: 'Por favor espera un momento.',
      loading: true, // Activa el modo loading
      autoClose: false // No se autocierra mientras carga
    })
    this.tourSeleccionado = tour;

    this.programacionService.generarPlanLogistico(this.fechaSeleccionada, tour.Id_Tour).subscribe({
      next: (plan) => {
        tour.planGenerado = plan;
        tour.estado = 'Generado';
        tour.totalPasajeros = plan.analisis.totalPasajeros;
        tour.totalReservas = plan.analisis.totalReservas;
        this.navbar.alert.set(null)
        // Si solo hay una sugerencia, la seleccionamos automáticamente para editar
        if (plan.sugerencias.length === 1) {
          this.seleccionarSugerenciaParaEditar(plan.sugerencias[0]);
        } else {
          // Mostrar en Dynamic Navbar
          this.navbar.sugerencias.set({
            tour,
            sugerencias: plan.sugerencias,
            flotaManual: this.flotaManual
          });
        }

        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error(`Error al generar plan para ${tour.NombreTour}`, err);
        this.cargando = false;
      }
    });
  }

  // --- LÓGICA DE TRANSICIÓN Y MODAL ---

  seleccionarSugerenciaParaEditar(sugerencia: Sugerencia): void {
    this.planSeleccionado = JSON.parse(JSON.stringify(sugerencia)); // Copia profunda para no mutar el original
    this.modoVista = 'editor';
    this.cerrarModal(); // Cierra el modal si estaba abierto
  }

  verMapa(bus: any): void {
    this.navbar.puntos.set(bus.reservas);
  }

  cerrarModal(): void {
    if (this.tourSeleccionado) {
      this.tourSeleccionado.planGenerado = null; // Limpiamos para poder re-abrir el modal
    }
    this.flotaManual = [{ capacidad: null }];
  }

  volverAlDashboard(): void {
    this.modoVista = 'dashboard';
    this.planSeleccionado = null;
    this.tourSeleccionado = null;
  }

  mostrarEncabezadoPunto(reservas: Reserva[], index: number): boolean {
    if (index === 0) return true;
    return reservas[index].NombrePunto !== reservas[index - 1].NombrePunto;
  }


  // --- LÓGICA DEL MODO EDITOR ---

  drop(event: CdkDragDrop<Reserva[]>) {
    if (!this.planSeleccionado) return;

    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      const item = event.previousContainer.data[event.previousIndex];
      const destinoBus = this.findBusByContainerId(event.container.id);
      if (!destinoBus) return;

      if (destinoBus.ocupados + item.NumeroPasajeros > destinoBus.capacidad) {
        this.navbar.alert.set({ type: 'error', title: 'Capacidad excedida.', message: ' No se puede mover la reserva a este bus.', autoClose: true, autoCloseTime: 2000 });
        return;
      }

      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
      this.recalcularOcupacion();
    }
  }

  recalcularOcupacion(): void {
    this.planSeleccionado?.buses.forEach(bus => {
      bus.ocupados = bus.reservas.reduce((sum, r) => sum + r.NumeroPasajeros, 0);
    });
  }

  guardarListadoFinal(): void {
    if (!this.planSeleccionado || !this.tourSeleccionado) return;

    // Validación de placas: no pueden estar vacías y no pueden repetirse
    const placas = this.planSeleccionado.buses.map(b => b.id);
    if (placas.some(p => !p || p.trim() === '')) {
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Las placas de los buses no pueden estar vacías.', autoClose: true, autoCloseTime: 2000 });
      return;
    }
    const placasUnicas = new Set(placas);
    if (placasUnicas.size !== placas.length) {
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Las placas de los buses deben ser únicas.', autoClose: true, autoCloseTime: 2000 });
      return;
    }

    const payload = {
      fecha: this.fechaSeleccionada,
      idTour: this.tourSeleccionado.Id_Tour,
      buses: this.planSeleccionado.buses
    };

    this.cargando = true;
    this.programacionService.guardarListadoFinal(payload).subscribe({
      next: (res) => {
        this.cargando = false;
        this.navbar.alert.set({ type: 'success', title: 'Listado guardado', message: 'El listado ha sido guardado exitosamente.' });
        this.volverAlDashboard();
      },
      error: (err) => {
        this.cargando = false;
        console.error('Error al guardar', err);
        this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Ha ocurrido un error al guardar el listado.' });
      }
    });
  }

  private findBusByContainerId(containerId: string): Bus | undefined {
    const busIndex = parseInt(containerId.replace('bus-', ''), 10);
    return this.planSeleccionado?.buses[busIndex];
  }

  /**
  * Procesa la selección de una de las sugerencias del asistente.
  * @param sugerencia La sugerencia de flota y rutas seleccionada.
  */


  // --- Lógica del Modo Asistido ---

  agregarBusManual(): void {
    this.flotaManual.push({ capacidad: null });
  }

  removerBusManual(index: number): void {
    this.flotaManual.splice(index, 1);
  }

  generarPlanManual(): void {
    if (!this.tourSeleccionado) return;

    const capacidades = this.flotaManual
      .map(b => b.capacidad)
      .filter((c): c is number => c !== null && c > 0);

    if (capacidades.length === 0) {
      this.navbar.alert.set({ type: 'error', title: 'Error', message: 'La flota manual debe tener al menos un bus con capacidad.' });
      return;
    }

    const payload: PlanAsistidoPayload = {
      fecha: this.fechaSeleccionada,
      idTour: this.tourSeleccionado.Id_Tour,
      flotaManual: capacidades,
      reservasAncladas: [] // Funcionalidad a futuro
    };

    this.cargando = true;
    this.cerrarModal(); // Cerramos el modal mientras se procesa

    this.programacionService.generarPlanAsistido(payload).subscribe({
      next: (respuesta: PlanLogistico) => {
        this.cargando = false;
        // La propiedad 'plan' es opcional en la interfaz, por lo que debemos verificarla.
        if (respuesta.plan) {
          this.navbar.alert.set({ type: 'success', title: 'Plan generado', message: `Plan generado para la flota manual. Costo: ${respuesta.plan.costoTotalKm} km` });
          console.log("Plan para editar:", respuesta.plan);
          // Opcionalmente, podemos pasar este plan a la función de selección para manejarlo
          this.seleccionarSugerenciaParaEditar(respuesta.plan);
        } else {
          this.navbar.alert.set({ type: 'error', title: 'Error', message: 'No se pudo generar el plan con la flota manual proporcionada.' });
        }
      },
      error: (err: any) => {
        this.cargando = false;
        console.error('Error en modo asistido', err);
        this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Ha ocurrido un error al generar el plan con la flota manual proporcionada.' });
      }
    });
  }

}
