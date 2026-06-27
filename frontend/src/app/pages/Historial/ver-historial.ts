import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { HistorialService, Historial, HistorialFilters } from '../../services/Historial/historial.service';
import { SirAlertService } from '../../services/Alertas/alert.service';

@Component({
  selector: 'app-ver-historial',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, DatepickerComponent],
  templateUrl: './ver-historial.html',
  styleUrls: ['./ver-historial.css']
})
export class VerHistorialComponent implements OnInit {
  private historialService = inject(HistorialService);
  private alerts = inject(SirAlertService);

  historialList = signal<Historial[]>([]);
  isLoading = signal(false);
  isInitialLoading = signal(true);
  isTableRefreshing = signal(false);
  totalRecords = signal(0);

  currentPage = signal(1);
  pageSize = signal(10);
  totalPages = signal(1);

  filters = signal({
    Usuario: '',
    Tipo_Accion: '',
    Tabla_Afectada: '',
    FechaInicio: '',
    FechaFin: '',
    searchText: ''
  });

  advancedFiltersVisible = signal(false);

  /** ID de la fila actualmente expandida; null = ninguna */
  expandedId = signal<number | null>(null);

  skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  tiposAccion = signal<string[]>([
    'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT',
    'CREAR_RESERVA', 'DUPLICAR_RESERVA', 'ACTUALIZAR_RESERVA', 'CANCELAR_RESERVA',
    'CREAR_TRANSFER', 'ACTUALIZAR_TRANSFER', 'CANCELAR_TRANSFER',
    'CREAR_TOUR', 'ACTUALIZAR_TOUR',
    'CREAR_PUNTO', 'ACTUALIZAR_PUNTO',
    'GUARDAR_LISTADO', 'EXPORTAR_EXCEL_LISTADO',
    'CREAR_USUARIO', 'ACTUALIZAR_USUARIO',
    'LOGOUT_ALL_SESSIONS', 'FORCE_LOGOUT_USER',
    'PASSWORD_RESET_REQUEST', 'PASSWORD_CHANGED_BY_RESET'
  ]);

  tablasAfectadas = signal<string[]>([
    'usuarios', 'tours', 'reservas', 'transfers',
    'puntos', 'programacion', 'aforos', 'sesiones'
  ]);

  /** Conteos por categoría semántica para los KPI chips */
  kpiConteos = computed(() => {
    const list = this.historialList();
    return list.reduce((acc, r) => {
      const cat = this.getAccionClass(r.Tipo_Accion ?? '');
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  });

  ngOnInit() {
    this.cargarHistorial(true);
  }

  cargarHistorial(initial = false) {
    if (initial) {
      this.isInitialLoading.set(true);
    } else {
      this.isTableRefreshing.set(true);
    }
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
        this.expandedId.set(null); // colapsar filas al cargar nueva página
        this.isInitialLoading.set(false);
        this.isTableRefreshing.set(false);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error al cargar historial:', error);
        this.alerts.showAlert({ type: 'error', title: 'Error', message: 'No se pudo cargar el historial' });
        this.isInitialLoading.set(false);
        this.isTableRefreshing.set(false);
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
    this.cargarHistorial(false);
  }

  limpiarFiltros() {
    this.filters.set({ Usuario: '', Tipo_Accion: '', Tabla_Afectada: '', FechaInicio: '', FechaFin: '', searchText: '' });
    this.currentPage.set(1);
    this.cargarHistorial(false);
  }

  toggleRow(id: number | undefined) {
    if (id == null) return;
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.cargarHistorial(false);
    }
  }

  nextPage() { if (this.currentPage() < this.totalPages()) this.goToPage(this.currentPage() + 1); }
  previousPage() { if (this.currentPage() > 1) this.goToPage(this.currentPage() - 1); }

  exportarHistorial() {
    const filtersData: HistorialFilters = {
      usuario: this.filters().Usuario,
      tipoAccion: this.filters().Tipo_Accion,
      tablaAfectada: this.filters().Tabla_Afectada,
      fechaInicio: this.filters().FechaInicio,
      fechaFin: this.filters().FechaFin
    };
    this.historialService.exportarHistorial(filtersData).subscribe({
      next: (blob) => this.historialService.descargarCSV(blob),
      error: (error) => {
        console.error('Error al exportar:', error);
        this.alerts.showAlert({ type: 'error', title: 'Error', message: 'No se pudo exportar el historial' });
      }
    });
  }

  getAccionLabel(accion: string): string {
    const labels: Record<string, string> = {
      CREATE: 'Crear', READ: 'Leer', UPDATE: 'Actualizar', DELETE: 'Eliminar',
      LOGIN: 'Iniciar sesión', LOGOUT: 'Cerrar sesión', EXPORT: 'Exportar', IMPORT: 'Importar',
      CREAR_RESERVA: 'Crear reserva', DUPLICAR_RESERVA: 'Duplicar reserva',
      ACTUALIZAR_RESERVA: 'Actualizar reserva', CANCELAR_RESERVA: 'Cancelar reserva',
      CREAR_TRANSFER: 'Crear transfer', ACTUALIZAR_TRANSFER: 'Actualizar transfer',
      CANCELAR_TRANSFER: 'Cancelar transfer', CREAR_TOUR: 'Crear tour',
      ACTUALIZAR_TOUR: 'Actualizar tour', CREAR_PUNTO: 'Crear punto',
      ACTUALIZAR_PUNTO: 'Actualizar punto', GUARDAR_LISTADO: 'Guardar listado',
      EXPORTAR_EXCEL_LISTADO: 'Exportar Excel', CREAR_USUARIO: 'Crear usuario',
      ACTUALIZAR_USUARIO: 'Actualizar usuario', LOGOUT_ALL_SESSIONS: 'Cerrar todas las sesiones',
      FORCE_LOGOUT_USER: 'Forzar cierre de sesión', PASSWORD_RESET_REQUEST: 'Solicitar restablecimiento',
      PASSWORD_CHANGED_BY_RESET: 'Cambiar contraseña', CAMBIAR_AFORO_TOUR: 'Cambiar aforo'
    };
    return labels[accion] ?? String(accion || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  }

  getAccionClass(accion: string): string {
    const raw = String(accion || '').toUpperCase();
    if (raw.startsWith('CREAR_') || raw === 'CREATE' || raw === 'DUPLICAR_RESERVA') return 'create';
    if (raw.startsWith('ACTUALIZAR_') || raw.startsWith('CAMBIAR_') || raw === 'UPDATE') return 'update';
    if (raw.startsWith('CANCELAR_') || raw.startsWith('ELIMINAR_') || raw.startsWith('DESACTIVAR_') || raw === 'DELETE') return 'delete';
    if (raw.startsWith('EXPORTAR_') || raw === 'EXPORT') return 'export';
    if (raw.startsWith('IMPORTAR_') || raw === 'IMPORT') return 'import';
    if (raw === 'LOGIN') return 'login';
    if (raw === 'LOGOUT' || raw === 'LOGOUT_ALL_SESSIONS' || raw === 'FORCE_LOGOUT_USER') return 'logout';
    if (raw === 'READ' || raw === 'GUARDAR_LISTADO') return 'read';
    if (raw.startsWith('PASSWORD_')) return 'password';
    return raw.toLowerCase().replace(/_/g, '-');
  }

  getAccionIcon(accion: string): string {
    const clase = this.getAccionClass(accion);
    const icons: Record<string, string> = {
      create: 'bx-plus-circle',
      update: 'bx-pencil',
      delete: 'bx-x-circle',
      export: 'bx-export',
      import: 'bx-import',
      login: 'bx-log-in-circle',
      logout: 'bx-log-out-circle',
      read: 'bx-show',
      password: 'bx-lock-alt'
    };
    return icons[clase] ?? 'bx-radio-circle';
  }

  formatUserAgent(ua: string | undefined): string {
    if (!ua) return '—';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return ua.slice(0, 40) + (ua.length > 40 ? '…' : '');
  }
}