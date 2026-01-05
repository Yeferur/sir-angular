import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
// Importa tus servicios
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-ver-reservas',
  standalone: true, // Asegúrate de que tu componente sea standalone
  imports: [CommonModule, DatePipe], // Añade DatePipe para el formato de fecha
  templateUrl: './ver-reservas.html',
  styleUrls: ['./ver-reservas.css']
})
export class VerReservasComponent implements OnInit {
        // Control de focus para el input principal
        mainInputFocused = signal(false);

        onMainInputFocus() {
          this.mainInputFocused.set(true);
          // Si hay sugerencias, mostrar
          if (this.puntoSugerencias().length > 0) this.puntoAutocompleteVisible.set(true);
        }

        onMainInputBlur() {
          // Pequeño retardo para permitir click en sugerencia
          setTimeout(() => {
            this.mainInputFocused.set(false);
            this.puntoAutocompleteVisible.set(false);
          }, 120);
        }
      // Autocompletar puntos de encuentro
      puntoSugerencias = signal<any[]>([]);
      puntoAutocompleteVisible = signal(false);

      // Buscar puntos de encuentro al escribir
      async onPuntoAutocomplete(ev: Event) {
        const term = (ev.target as HTMLInputElement)?.value?.trim() || '';
        if (term.length < 2) {
          this.puntoSugerencias.set([]);
          this.puntoAutocompleteVisible.set(false);
          return;
        }
        try {
          const results = await this.reservasService.buscarPuntos(term).toPromise();
          this.puntoSugerencias.set(results || []);
          // Solo mostrar si el input tiene focus
          this.puntoAutocompleteVisible.set((results && results.length > 0 && this.mainInputFocused()));
        } catch {
          this.puntoSugerencias.set([]);
          this.puntoAutocompleteVisible.set(false);
        }
      }

      // Seleccionar punto de encuentro del autocompletar
      puntoSeleccionado: any = null;
      seleccionarPuntoAutocomplete(p: any) {
        this.updateFilter('Punto', p.NombrePunto);
        this.puntoSeleccionado = p;
        this.puntoAutocompleteVisible.set(false);
        this.puntoSugerencias.set([]);
        // También actualiza el input principal
        this.updateFilter('NombreApellido', p.NombrePunto);
      }

      // Detectar si el input es un ID de reserva, DNI, o nombre
      onMainSearchInput(val: string) {
        // Si el usuario seleccionó un punto del autocompletar, no sobreescribir el filtro Punto
        if (!this.puntoSeleccionado) {
          this.updateFilter('NombreApellido', val);
          this.updateFilter('Punto', '');
        }
        // Si es un número largo, puede ser DNI
        if (/^\d{6,}$/.test(val)) {
          this.updateFilter('IdPas', val);
        } else if (/^RSV\d+/i.test(val)) {
          this.updateFilter('Id_Reserva', val);
        } else {
          this.updateFilter('IdPas', '');
          this.updateFilter('Id_Reserva', '');
        }
        // Lanzar autocompletar de puntos solo si no hay punto seleccionado
        if (!this.puntoSeleccionado) {
          this.onPuntoAutocomplete({ target: { value: val } } as any);
        }
      }
    // Devuelve el texto de los tours seleccionados para mostrar en el chip
    getSelectedToursText(): string {
      const ids = this.filters().tour;
      if (!ids?.length) return '';
      return ids
        .map(id => {
          const t = this.resultsTours().find(tour => tour.Id_Tour == id);
          return t ? t.Nombre_Tour : id;
        })
        .join(', ');
    }
  
  // Inyección de servicios
  private navbar = inject(DynamicIslandGlobalService);
  private reservasService = inject(Reservas);

  // Signals para datos y estado de la UI
  resultsTours = signal<any[]>([]);
  resultsCategoria = signal<any[]>([]);
  reservas = signal<any[]>([]);
  isLoading = signal(true);
  isLoadingReservas = signal(false);
  filtersApplied = signal(false);

  // Signal para controlar la visibilidad del panel de filtros avanzados
  advancedFiltersVisible = signal(false);

  // Signal para el estado de los dropdowns de filtros
  dropdownOpenCategoria = signal(false);
  dropdownOpenTour = signal(false);
  dropdownOpenEstado = signal(false);

  // Signal que almacena todos los filtros
  filters = signal({
    FechaReserva: '',
    FechaRegistro: '',
    CategoriaReserva: [] as number[],
    tour: [] as number[],
    Id_Reserva: '',
    NombreApellido: '', // Este se vincula a la barra de búsqueda principal
    IdPas: '',
    Punto: '',
    Estado: [] as string[],
    Empty: false,
  });

  ngOnInit(): void {
    this.loadInitialData();
  }

  loadInitialData() {
    this.isLoading.set(true);
    try {
      this.reservasService.getTours().subscribe({
        next: (tours) => this.resultsTours.set(tours),
        error: (error) => console.error('Error al cargar tours:', error)
      });
      this.reservasService.getCanales().subscribe({
        next: (categorias) => this.resultsCategoria.set(categorias),
        error: (error) => console.error('Error al cargar categorías:', error)
      });
    } catch (error) {
      // Manejo de errores...
    } finally {
      this.isLoading.set(false);
    }
  }

  // Actualiza el valor de un filtro específico
  updateFilter(key: keyof ReturnType<typeof this.filters>, value: any) {
    this.filters.update((prev) => ({ ...prev, [key]: value }));
  }

  // Maneja la selección múltiple en los dropdowns
  toggleSelection(value: any, filterKey: 'CategoriaReserva' | 'tour' | 'Estado') {
    const current = this.filters()[filterKey] as any[];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.updateFilter(filterKey, updated);
  }


  // Mapea los nombres de los filtros del UI a los del backend
  private buildApiFilters() {
    const f = this.filters();
    const api: any = {};

    // FECHAS: manda ISO (YYYY-MM-DD)
    if (f.FechaReserva) api.Fecha_Tour = f.FechaReserva;     // o FechaReserva según tu backend
    if (f.FechaRegistro) api.FechaRegistro = f.FechaRegistro;

    // TOUR
    if (f.tour?.length) api.Id_Tour = f.tour;

    // CATEGORIA (canal)
    if (f.CategoriaReserva?.length) api.Id_Canal = f.CategoriaReserva;

    // ESTADO
    if (f.Estado?.length) api.Estado = f.Estado;

    // BÚSQUEDA PRINCIPAL
    if (f.NombreApellido?.trim()) api.q = f.NombreApellido.trim(); // o Nombre_Reportante, según tu API

    // ID RESERVA
    if (f.Id_Reserva?.trim()) api.Id_Reserva = f.Id_Reserva.trim();

    // PASAPORTE/DNI
    if (f.IdPas?.trim()) api.DNI = f.IdPas.trim(); // o IdPas si así lo dejaste en backend

    // PUNTO
    if (f.Punto?.trim()) api.Punto = f.Punto.trim(); // o Id_Punto

    if (f.Empty) api.Empty = true;

    return api;
  }

  private toISO(v: string): string {
    // si te llega "2025-12-15" lo devuelve igual; si te llega "12/15/25" también lo arregla
    const d = new Date(v);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  buscarReservas() {
    const filtros = this.buildApiFilters();
    // Si el filtro es por punto, solo buscar si el punto fue seleccionado del autocompletar
    if (filtros.Punto && !this.puntoSeleccionado) {
      this.navbar.alert.set({
        type: 'info',
        title: 'Selecciona un punto',
        message: 'Debes seleccionar un punto de encuentro del autocompletar.',
        autoClose: true,
        autoCloseTime: 3000
      });
      this.reservas.set([]);
      return;
    }
    // Si no hay ningún filtro relevante, no buscar
    if (Object.keys(filtros).length === 0 ||
      (!filtros.Punto && !filtros.q && !filtros.Id_Reserva && !filtros.DNI && !filtros.Fecha_Tour && !filtros.Estado && !filtros.Id_Tour)) {
      this.navbar.alert.set({
        type: 'info',
        title: 'Sin filtros',
        message: 'Debes aplicar al menos un filtro para buscar.',
        autoClose: true,
        autoCloseTime: 3000
      });
      this.reservas.set([]);
      return;
    }
    this.isLoadingReservas.set(true);
    this.filtersApplied.set(true);
    this.advancedFiltersVisible.set(false); // Oculta el panel de filtros al buscar
    this.reservasService.getReservas(filtros).subscribe({
      next: (data) => {
        this.reservas.set(data);
        if (data.length === 0) {
          this.navbar.alert.set({
            type: 'info',
            title: 'Sin resultados',
            message: 'No se encontraron reservas con los filtros actuales.',
            autoClose: true,
            autoCloseTime: 3000
          });
        } else {
          this.navbar.alert.set({
            type: 'success',
            title: 'Reservas encontradas',
            message: `Se encontraron ${data.length} reservas.`,
            autoClose: true,
            autoCloseTime: 3000,
          });
        }
      },
      error: (error) => {
        this.navbar.alert.set({
          type: 'error',
          title: 'Error en la búsqueda',
          message: error.message,
          autoClose: false
        });
        this.reservas.set([]);
      },
      complete: () => {
        this.isLoadingReservas.set(false);
        const current = this.navbar.alert();
        if (current?.loading) this.navbar.alert.set(null);
      }
    });
  }

  verReserva(Id_Reserva: string) {
    this.navbar.Id_Reserva.set(Id_Reserva);
  }
}
