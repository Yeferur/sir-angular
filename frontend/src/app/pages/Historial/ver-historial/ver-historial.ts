import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { HistorialService, Historial, HistorialFilters } from '../../../services/Historial/historial.service';

@Component({
  selector: 'app-ver-historial',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './ver-historial.html',
  styleUrls: ['./ver-historial.css']
})
export class VerHistorialComponent implements OnInit {
  private historialService = inject(HistorialService);
  private globalService = inject(DynamicIslandGlobalService);

  // Datos del historial
  historialList = signal<Historial[]>([]);
  isLoading = signal(false);
  totalRecords = signal(0);

  // Paginación
  currentPage = signal(1);
  pageSize = signal(10);
  totalPages = signal(1);

  // Filtros
  filters = signal({
    Usuario: '',
    Tipo_Accion: '',
    Tabla_Afectada: '',
    FechaInicio: '',
    FechaFin: '',
    searchText: ''
  });

  advancedFiltersVisible = signal(false);

  // Opciones para dropdowns
  tiposAccion = signal<string[]>([
    'CREATE',
    'READ',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGOUT',
    'EXPORT',
    'IMPORT'
  ]);

  tablasAfectadas = signal<string[]>([
    'usuarios',
    'tours',
    'reservas',
    'transfers',
    'puntos',
    'programacion',
    'aforos'
  ]);

  ngOnInit() {
    this.cargarHistorial();
  }

  cargarHistorial() {
    this.isLoading.set(true);

    const filtersData: HistorialFilters = {
      usuario: this.filters().Usuario,
      tipoAccion: this.filters().Tipo_Accion,
      tablaAfectada: this.filters().Tabla_Afectada,
      fechaInicio: this.filters().FechaInicio,
      fechaFin: this.filters().FechaFin,
      search: this.filters().searchText,
      page: this.currentPage(),
      limit: this.pageSize()
    };

    this.historialService.getHistorial(filtersData).subscribe({
      next: (response) => {
        this.historialList.set(response.data || []);
        this.totalRecords.set(response.total || 0);
        this.totalPages.set(Math.ceil(this.totalRecords() / this.pageSize()));
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error al cargar historial:', error);
        this.globalService.alert.set({
          type: 'error',
          title: 'Error',
          message: 'No se pudo cargar el historial'
        });
        this.isLoading.set(false);
      }
    });
  }

  updateFilter(key: string, value: any) {
    const currentFilters = { ...this.filters() };
    currentFilters[key as keyof typeof currentFilters] = value;
    this.filters.set(currentFilters);
    this.currentPage.set(1);
  }

  buscar() {
    this.currentPage.set(1);
    this.cargarHistorial();
  }

  limpiarFiltros() {
    this.filters.set({
      Usuario: '',
      Tipo_Accion: '',
      Tabla_Afectada: '',
      FechaInicio: '',
      FechaFin: '',
      searchText: ''
    });
    this.currentPage.set(1);
    this.cargarHistorial();
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.cargarHistorial();
    }
  }

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  previousPage() {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  exportarHistorial() {
    const filtersData: HistorialFilters = {
      usuario: this.filters().Usuario,
      tipoAccion: this.filters().Tipo_Accion,
      tablaAfectada: this.filters().Tabla_Afectada,
      fechaInicio: this.filters().FechaInicio,
      fechaFin: this.filters().FechaFin
    };

    this.historialService.exportarHistorial(filtersData).subscribe({
      next: (blob) => {
        this.historialService.descargarCSV(blob);
      },
      error: (error) => {
        console.error('Error al exportar:', error);
        this.globalService.alert.set({
          type: 'error',
          title: 'Error',
          message: 'No se pudo exportar el historial'
        });
      }
    });
  }

  getAccionColor(accion: string): string {
    const colors: { [key: string]: string } = {
      CREATE: '#28a745',
      READ: '#17a2b8',
      UPDATE: '#ffc107',
      DELETE: '#dc3545',
      LOGIN: '#007bff',
      LOGOUT: '#6c757d',
      EXPORT: '#20c997',
      IMPORT: '#6610f2'
    };
    return colors[accion] || '#6c757d';
  }

  getAccionLabel(accion: string): string {
    const labels: { [key: string]: string } = {
      CREATE: 'Crear',
      READ: 'Leer',
      UPDATE: 'Actualizar',
      DELETE: 'Eliminar',
      LOGIN: 'Iniciar Sesión',
      LOGOUT: 'Cerrar Sesión',
      EXPORT: 'Exportar',
      IMPORT: 'Importar'
    };
    return labels[accion] || accion;
  }
}
