import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';

import { Tours } from '../../../services/Tours/tours';
import { ConfirmacionService } from '../../../services/confirmacion.service';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import { ComisionesService } from '../../../services/Comisiones/comisiones.service';
import { SegurosService } from '../../../services/Seguros/seguros.service';

@Component({
    selector: 'app-confirmacion',
    standalone: true,
    imports: [CommonModule, FormsModule, FlatpickrInputDirective],
    templateUrl: './confirmacion.html',
    styleUrl: './confirmacion.css'
})
export class ConfirmacionComponent implements OnInit {
    toursList: any[] = [];
    pasajeros: any[] = [];
    skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

    allChecked = false;
    hasSearched = false;
    isLoading = false;
    isSubmitting = false;
    isExportingReports = false;

    filters = {
        Id_Tour: '',
        Fecha: ''
    };

    private savedConfirmaciones = new Map<number, number>();

    fpOptionsFecha: Partial<FlatpickrOptions> = {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: false,
        disableMobile: true,
        monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],
        altInputClass: 'form-input flatpickr-input flatpickr-alt',
        onReady: (_sel, _str, inst: any) => {
            if (typeof window === 'undefined' || typeof document === 'undefined') return;

            const cal: HTMLElement = inst?.calendarContainer;
            if (!cal) return;

            cal.classList.add('sir-flatpickr');

            const clampDay = (y: number, m: number, d: number) => {
                const last = new Date(y, m + 1, 0).getDate();
                return Math.min(Math.max(d, 1), last);
            };

            let yearSelect: HTMLSelectElement | null = null;

            const ensureYearSelect = () => {
                const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
                if (!monthWrap) return null;

                const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
                if (numWrap) {
                    try { numWrap.remove(); } catch { /* ignore */ }
                }

                const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
                const container = curMonth ?? monthWrap;

                yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
                if (yearSelect) return yearSelect;

                const oldSelect = monthWrap.querySelector('.sir-year-select') as HTMLSelectElement | null;
                if (oldSelect) {
                    try { oldSelect.remove(); } catch { /* ignore */ }
                }

                yearSelect = document.createElement('select');
                yearSelect.className = 'sir-year-select';
                yearSelect.setAttribute('aria-label', 'Seleccionar año');

                try { container.appendChild(yearSelect); } catch { monthWrap.appendChild(yearSelect); }
                return yearSelect;
            };

            const buildYears = (centerYear: number) => {
                const sel = ensureYearSelect();
                if (!sel) return;

                const start = centerYear - 20;
                const end = centerYear + 20;

                sel.innerHTML = '';
                for (let y = end; y >= start; y--) {
                    const opt = document.createElement('option');
                    opt.value = String(y);
                    opt.textContent = String(y);
                    sel.appendChild(opt);
                }
                sel.value = String(centerYear);
            };

            const syncSelectValue = () => {
                const sel = ensureYearSelect();
                if (!sel) return;

                const y = inst.currentYear ?? new Date().getFullYear();
                const exists = !!sel.querySelector(`option[value="${y}"]`);
                if (!exists) buildYears(y);
                sel.value = String(y);
            };

            const getSafeDay = () => {
                const d: Date | undefined = inst.selectedDates?.[0];
                return d ? d.getDate() : 1;
            };

            const onChange = () => {
                const sel = ensureYearSelect();
                if (!sel) return;

                const y = Number(sel.value);
                const m = typeof inst.currentMonth === 'number' ? inst.currentMonth : new Date().getMonth();
                const day = clampDay(y, m, getSafeDay());
                const newDate = new Date(y, m, day);

                if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);
                if (inst.selectedDates?.length) {
                    inst.setDate(newDate, true);
                }
            };

            buildYears(inst.currentYear ?? new Date().getFullYear());
            syncSelectValue();

            const sel0 = ensureYearSelect();
            sel0?.addEventListener('change', onChange);

            const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
                const prev = inst.config[key];
                const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
                inst.config[key] = [...arr, fn];
            };

            wrap('onMonthChange', () => syncSelectValue());
            wrap('onYearChange', () => syncSelectValue());

            const prevOnDestroy = inst.config.onDestroy;
            const destroyArr = Array.isArray(prevOnDestroy) ? prevOnDestroy : prevOnDestroy ? [prevOnDestroy] : [];
            inst.config.onDestroy = [
                ...destroyArr,
                () => sel0?.removeEventListener('change', onChange)
            ];
        }
    };

    constructor(
        private toursService: Tours,
        private confirmacionService: ConfirmacionService,
        private navbar: DynamicIslandGlobalService,
        private cdr: ChangeDetectorRef,
        private comisionesService: ComisionesService,
        private segurosService: SegurosService
    ) { }

    ngOnInit(): void {
        const today = new Date();
        today.setDate(today.getDate() - 1);
        this.filters.Fecha = today.toISOString().split('T')[0];
        this.loadTours();
    }

    onFechaChange(_event: any) {
        // Compatible with the current Flatpickr directive binding.
        // The ngModel already keeps filters.Fecha in sync.
    }

    trackByPasajero(_index: number, item: any): number {
        return item.Id_Pasajero;
    }

    get totalConfirmados(): number {
        return this.pasajeros.filter((p) => Number(p.Confirmacion ?? 0) === 1).length;
    }

    get totalPendientes(): number {
        return this.pasajeros.length - this.totalConfirmados;
    }

    get nombreTourSeleccionado(): string {
        const tour = this.toursList.find((t) => Number(t.Id_Tour) === Number(this.filters.Id_Tour));
        return tour?.Nombre_Tour || 'el tour seleccionado';
    }

    get canExportReports(): boolean {
        return !!this.filters.Id_Tour && !!this.filters.Fecha && this.pasajeros.length > 0;
    }

    loadTours() {
        this.toursService.getTours().subscribe({
            next: (data: any[]) => {
                this.toursList = data || [];
                this.cdr.detectChanges();
            },
            error: (err: any) => console.error('Error cargando tours', err)
        });
    }

    search() {
        if (!this.filters.Id_Tour || !this.filters.Fecha) {
            this.navbar.warningToast('Faltan filtros', 'Por favor selecciona un tour y una fecha.');
            return;
        }

        this.hasSearched = true;
        this.isLoading = true;
        this.pasajeros = [];
        this.allChecked = false;
        this.cdr.detectChanges();

        this.confirmacionService.getPasajeros(Number(this.filters.Id_Tour), this.filters.Fecha).subscribe({
            next: (data: any[]) => {
                this.pasajeros = this.normalizePasajeros(data);
                this.syncSavedConfirmaciones();
                this.checkAllStatus();
                this.isLoading = false;

                if (this.pasajeros.length === 0) {
                    this.navbar.infoToast('Sin pasajeros', 'No hay pasajeros registrados para este tour y fecha.');
                }

                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error', err);
                this.isLoading = false;
                this.navbar.errorToast('Error', 'Error cargando pasajeros.');
                this.cdr.detectChanges();
            }
        });
    }

    toggleAll(event: any) {
        const isChecked = !!event?.target?.checked;
        this.allChecked = isChecked;
        this.pasajeros.forEach((p) => (p.Confirmacion = isChecked ? 1 : 0));
        this.cdr.detectChanges();
    }

    checkAllStatus() {
        this.allChecked = this.pasajeros.length > 0 && this.pasajeros.every((p) => Number(p.Confirmacion ?? 0) === 1);
    }

    requestSave() {
        if (this.pasajeros.length === 0 || this.isSubmitting) return;

        const total = this.pasajeros.length;
        const confirmados = this.totalConfirmados;
        const pendientes = this.totalPendientes;
        const nombreTour = this.nombreTourSeleccionado;
        const fecha = this.filters.Fecha || 'sin fecha';

        this.navbar.alert.set({
            type: 'warning',
            title: '¿Guardar confirmación?',
            message: `Vas a guardar la confirmación de viaje para ${nombreTour} el ${fecha}. Pasajeros: ${total}. Confirmados: ${confirmados}. Pendientes: ${pendientes}. ¿Deseas continuar?`,
            autoClose: false,
            buttons: [
                {
                    text: 'Cancelar',
                    style: 'secondary',
                    onClick: () => this.navbar.alert.set(null),
                },
                {
                    text: 'Guardar',
                    style: 'primary',
                    onClick: () => {
                        this.navbar.alert.set(null);
                        this.performSave();
                    },
                },
            ],
        });
    }

    save() {
        this.requestSave();
    }

    private performSave() {
        if (this.pasajeros.length === 0 || this.isSubmitting) return;

        this.isSubmitting = true;
        this.cdr.detectChanges();

        const payload = this.pasajeros.map((p) => ({
            Id_Pasajero: p.Id_Pasajero,
            Confirmacion: p.Confirmacion ? 1 : 0
        }));

        this.confirmacionService.saveConfirmacion(payload).subscribe({
            next: () => {
                this.syncSavedConfirmaciones();
                this.isSubmitting = false;
                this.navbar.successToast('Confirmación guardada correctamente', 'La confirmación de viaje se actualizó correctamente.');
                this.cdr.detectChanges();

                setTimeout(() => this.askReportDownloads(), 150);
            },
            error: (err) => {
                console.error('Error al guardar confirmación', err);
                this.isSubmitting = false;
                this.navbar.errorToast('Error', 'No se pudo guardar.');
                this.cdr.detectChanges();
            }
        });
    }

    private askReportDownloads() {
        const fecha = this.filters.Fecha || 'sin fecha';

        this.navbar.alert.set({
            type: 'info',
            title: '¿Descargar reportes?',
            message: `Puedes descargar los archivos de Comisiones y Seguros para este tour y fecha (${fecha}).`,
            autoClose: false,
            buttons: [
                {
                    text: 'Descargar ambos',
                    style: 'primary',
                    onClick: () => {
                        this.navbar.alert.set(null);
                        this.downloadReports('both');
                    },
                },
                {
                    text: 'Solo comisiones',
                    style: 'secondary',
                    onClick: () => {
                        this.navbar.alert.set(null);
                        this.downloadReports('comisiones');
                    },
                },
                {
                    text: 'Solo seguros',
                    style: 'secondary',
                    onClick: () => {
                        this.navbar.alert.set(null);
                        this.downloadReports('seguros');
                    },
                },
                {
                    text: 'Ahora no',
                    style: 'secondary',
                    onClick: () => this.navbar.alert.set(null),
                },
            ],
        });
    }

    downloadComisiones() {
        this.downloadReports('comisiones');
    }

    downloadSeguros() {
        this.downloadReports('seguros');
    }

    downloadAmbos() {
        this.downloadReports('both');
    }

    private downloadReports(mode: 'both' | 'comisiones' | 'seguros') {
        if (!this.canExportReports) {
            this.navbar.warningToast('Sin datos', 'Primero carga pasajeros antes de descargar reportes.');
            return;
        }

        const nombreTour = this.nombreTourSeleccionado;
        this.isExportingReports = true;

        if (mode === 'both' || mode === 'comisiones') {
            this.comisionesService.exportarExcel(this.filters, nombreTour);
        }

        if (mode === 'both' || mode === 'seguros') {
            this.segurosService.exportarExcel(this.filters, nombreTour);
        }

        const label =
            mode === 'both' ? 'Comisiones y Seguros' :
            mode === 'comisiones' ? 'Comisiones' : 'Seguros';

        this.navbar.infoToast('Descarga iniciada', `Se generó la descarga de ${label}.`);

        setTimeout(() => {
            this.isExportingReports = false;
            this.cdr.detectChanges();
        }, 1200);
    }

    private normalizePasajeros(data: any[]): any[] {
        return [...(data || [])]
            .sort((a, b) => Number(a.Id_Reserva) - Number(b.Id_Reserva))
            .map((p) => ({
                ...p,
                Confirmacion: Number(p.Confirmacion) === 1 ? 1 : 0
            }));
    }

    private syncSavedConfirmaciones() {
        this.savedConfirmaciones = new Map(
            this.pasajeros.map((p) => [Number(p.Id_Pasajero), Number(p.Confirmacion ?? 0)])
        );
    }

    hasUnsavedChanges(): boolean {
        if (!this.pasajeros?.length || this.isSubmitting) return false;
        return this.pasajeros.some((p) => {
            const prev = this.savedConfirmaciones.get(Number(p.Id_Pasajero)) ?? 0;
            const current = Number(p.Confirmacion ?? 0);
            return prev !== current;
        });
    }
}
