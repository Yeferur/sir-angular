import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { TransferService } from '../../../services/Transfers/transfers';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-ver-transfers',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './ver-transfers.html',
  styleUrls: ['./ver-transfers.css']
})
export class VerTransfersComponent implements OnInit {
  private navbar = inject(DynamicIslandGlobalService);
  private transferService = inject(TransferService);

  resultsServicios = signal<any[]>([]);
  transfers = signal<any[]>([]);
  isLoading = signal(false);
  isLoadingTransfers = signal(false);
  advancedFiltersVisible = signal(false);

  filters = signal({
    Fecha_Transfer: '',
    Fecha_Registro: '',
    Id_Servicio: [] as any[],
    Id_Rango: '' as any,
    Id_Transfer: '',
    Nombre_Titular: '',
    Telefono_Titular: '',
    DNI: '',
    Punto_Salida: '',
    Punto_Destino: '',
    Estado: [] as string[],
    Empty: false
  });

  ngOnInit(): void {
    this.loadInitialData();
  }

  loadInitialData() {
    this.isLoading.set(true);
    this.transferService.getServicios().subscribe({ next: (s) => this.resultsServicios.set(s || []), error: () => {} });
    this.isLoading.set(false);
  }

  updateFilter(key: keyof ReturnType<typeof this.filters>, value: any) {
    this.filters.update(p => ({ ...p, [key]: value }));
  }

  onMainSearchInput(val: string) {
    // actualiza filtro de nombre/titular
    this.updateFilter('Nombre_Titular', val || '');
    // si parece un DNI largo
    if (/^\d{6,}$/.test(val)) {
      this.updateFilter('DNI', val);
    } else if (/^TR-?\d+/i.test(val)) {
      this.updateFilter('Id_Transfer', val);
    } else {
      this.updateFilter('DNI', '');
      this.updateFilter('Id_Transfer', '');
    }
  }

  toggleSelection(value: any, filterKey: 'Id_Servicio' | 'Estado' | 'Id_Rango') {
    const current = this.filters()[filterKey] as any[];
    const updated = current?.includes ? (current.includes(value) ? current.filter(v => v !== value) : [...current, value]) : [value];
    this.updateFilter(filterKey as any, updated);
  }

  private buildApiFilters() {
    const f = this.filters();
    const api: any = {};
    if (f.Fecha_Transfer) api.Fecha_Transfer = f.Fecha_Transfer;
    if (f.Fecha_Registro) api.Fecha_Registro = f.Fecha_Registro;
    if (f.Id_Servicio?.length) api.Id_Servicio = f.Id_Servicio;
    if (f.Id_Rango) api.Id_Rango = f.Id_Rango;
    if (f.Estado?.length) api.Estado = f.Estado;
    if (f.Id_Transfer) api.Id_Transfer = f.Id_Transfer;
    if (f.Nombre_Titular?.trim()) api.Nombre_Titular = f.Nombre_Titular.trim();
    if (f.Telefono_Titular?.trim()) api.Telefono_Titular = f.Telefono_Titular.trim();
    if (f.DNI?.trim()) api.DNI = f.DNI.trim();
    if (f.Punto_Salida?.trim()) api.Punto_Salida = f.Punto_Salida.trim();
    if (f.Punto_Destino?.trim()) api.Punto_Destino = f.Punto_Destino.trim();
    if (f.Empty) api.Empty = true;
    return api;
  }

  buscarTransfers() {
    const filtros = this.buildApiFilters();
    if (Object.keys(filtros).length === 0) {
      this.navbar.alert.set({ type: 'info', title: 'Sin filtros', message: 'Aplica al menos un filtro para buscar.', autoClose: true, autoCloseTime: 2500 });
      this.transfers.set([]);
      return;
    }
    this.isLoadingTransfers.set(true);
    this.transferService.getTransfers(filtros).subscribe({
      next: (data) => { this.transfers.set(data || []); },
      error: (err) => { this.navbar.alert.set({ type: 'error', title: 'Error', message: err?.message || 'Error', autoClose: false }); this.transfers.set([]); },
      complete: () => { this.isLoadingTransfers.set(false); }
    });
  }

  verTransfer(Id_Transfer: string) {
    this.navbar.Id_Transfer?.set ? this.navbar.Id_Transfer.set(Id_Transfer) : null;
  }
}
