import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Tours } from '../../../services/Tours/tours';
import { ConfirmacionService } from '../../../services/confirmacion.service';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { FlatpickrInputDirective } from '../../../shared/directives/flatpickr-input';
import { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';

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

    // Variable auxiliar para el checkbox "Todos" del encabezado
    allChecked: boolean = false;

    filters = {
        Id_Tour: '',
        Fecha: ''
    };

    fpOptionsFecha: Partial<FlatpickrOptions> = {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: false,
        disableMobile: true,
        monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],

        altInputClass: 'form-input flatpickr-input flatpickr-alt',

        onReady: (_sel, _str, inst: any) => {
            // ✅ SSR guard ANTES DE TODO
            if (typeof window === 'undefined' || typeof document === 'undefined') return;

            const cal: HTMLElement = inst?.calendarContainer;
            if (!cal) return;

            cal.classList.add('sir-flatpickr');

            // util: clamp día al máximo del mes
            const clampDay = (y: number, m: number, d: number) => {
                const last = new Date(y, m + 1, 0).getDate(); // último día del mes
                return Math.min(Math.max(d, 1), last);
            };

            // --- Inyectar select en el header estable (flatpickr-month) ---
            let yearDiv: HTMLDivElement | null = null;
            let yearSelect: HTMLSelectElement | null = null;

            const ensureYearSelect = () => {
                // contenedor header
                const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
                if (!monthWrap) return null;

                // elimina el input numérico (cuando exista)
                const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
                if (numWrap) { try { numWrap.remove(); } catch (e) { /* ignore */ } }

                // preferimos insertar dentro del pill .flatpickr-current-month
                const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
                const container = curMonth ?? monthWrap;

                // evita duplicados
                yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
                if (yearSelect) return yearSelect;

                // elimina cualquier wrapper previo para mantener DOM limpio
                const oldDiv = monthWrap.querySelector('.sir-year-div') as HTMLElement | null;
                if (oldDiv) { try { oldDiv.remove(); } catch { /* ignore */ } }

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

                // siempre mueve la vista
                if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);

                // solo setea si ya había selección
                if (inst.selectedDates?.length) {
                    inst.setDate(newDate, true); // true => triggerChange para reactive forms
                }
            };

            // init
            buildYears(inst.currentYear ?? new Date().getFullYear());
            syncSelectValue();

            // listeners
            const sel0 = ensureYearSelect();
            sel0?.addEventListener('change', onChange);

            // hook sin pisar otros callbacks
            const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
                const prev = inst.config[key];
                const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
                inst.config[key] = [...arr, fn];
            };

            // ✅ cuando cambias mes/año, flatpickr puede re-renderizar header → reinyecta/sincroniza
            wrap('onMonthChange', () => syncSelectValue());
            wrap('onYearChange', () => syncSelectValue());

            // cleanup
            const prevOnDestroy = inst.config.onDestroy;
            const destroyArr = Array.isArray(prevOnDestroy) ? prevOnDestroy : prevOnDestroy ? [prevOnDestroy] : [];
            inst.config.onDestroy = [
                ...destroyArr,
                () => sel0?.removeEventListener('change', onChange)
            ];
        }
    };

    onFechaChange(event: any) {
        // Flatpickr usually returns [Date] or "YYYY-MM-DD" depending on config.
        // Directives using ControlValueAccessor update the model automatically.
        // However, if we need to trigger manual change detection or validation:
        // this.cdr.detectChanges(); 

        // This method can be used if explicit handling is needed, 
        // but often [(ngModel)] handles updates. 
        // If the user's snippet used (change)="onFechaChange($event)", we keep it compatible.
        // Assuming event.target.value or similar if it's a DOM event, 
        // but with Flatpickr directive, value change is often handled via model.
        // Let's ensure filters.Fecha is updated if passed explicitly.
    }

    isLoading = false;

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

    // MEJORA DE RENDIMIENTO: Evita que Angular redibuje toda la fila si solo cambia un dato
    trackByPasajero(index: number, item: any): number {
        return item.Id_Pasajero;
    }

    loadTours() {
        this.toursService.getTours().subscribe({
            next: (data: any[]) => {
                this.toursList = data;
                this.cdr.detectChanges();
            },
            error: (err: any) => console.error('Error cargando tours', err)
        });
    }

    search() {
        if (!this.filters.Id_Tour || !this.filters.Fecha) {
            this.navbar.alert.set({
                type: 'warning',
                title: 'Faltan Filtros',
                message: 'Por favor selecciona un tour y una fecha.',
                autoClose: true
            });
            return;
        }

        this.isLoading = true;
        this.pasajeros = []; // Limpiar lista anterior visualmente
        this.cdr.detectChanges(); // Forzar vista de carga

        this.confirmacionService.getPasajeros(Number(this.filters.Id_Tour), this.filters.Fecha).subscribe({
            next: (data: any[]) => {
                // Convertir 1/0 a true/false para manejo más rápido en UI (opcional pero recomendado)
                // Aquí mantenemos 1/0 pero aseguramos que la UI lo interprete bien
                this.pasajeros = data.sort((a, b) => a.Id_Reserva - b.Id_Reserva);
                this.checkAllStatus(); // Verificar estado inicial del "Select All"

                this.isLoading = false;

                if (this.pasajeros.length === 0) {
                    this.navbar.alert.set({
                        type: 'info',
                        title: 'Sin Resultados',
                        message: 'No hay pasajeros registrados para este tour.',
                        autoClose: true
                    });
                }
                this.cdr.detectChanges(); // Actualización final
            },
            error: (err: any) => {
                console.error('Error', err);
                this.isLoading = false;
                this.navbar.alert.set({ type: 'error', title: 'Error', message: 'Error cargando pasajeros.' });
                this.cdr.detectChanges();
            }
        });
    }

    // Lógica optimizada para el toggle general
    toggleAll(event: any) {
        const isChecked = event.target.checked;
        this.allChecked = isChecked;

        // Actualizamos los datos
        this.pasajeros.forEach(p => p.Confirmacion = isChecked ? 1 : 0);

        // Forzamos la detección de cambios manual para respuesta instantánea
        this.cdr.detectChanges();
    }

    // Actualizar estado del checkbox header si se cambian items individuales
    checkAllStatus() {
        // Si todos están en 1, allChecked = true
        this.allChecked = this.pasajeros.every(p => p.Confirmacion == 1);
        // No necesitamos detectChanges aquí obligatoriamente, pero ayuda a la reactividad del header
        // this.cdr.detectChanges(); 
    }

    save() {
        if (this.pasajeros.length === 0) return;

        this.isLoading = true;
        this.cdr.detectChanges();

        const payload = this.pasajeros.map(p => ({
            Id_Pasajero: p.Id_Pasajero,
            Confirmacion: p.Confirmacion ? 1 : 0
        }));

        this.confirmacionService.saveConfirmacion(payload).subscribe({
            next: (res) => {
                this.isLoading = false;
                this.navbar.alert.set({
                    type: 'success',
                    title: 'Guardado',
                    message: 'Confirmación actualizada correctamente.',
                    autoClose: true,
                    autoCloseTime: 1000
                });
                this.cdr.detectChanges();

                // Prompt for download
                setTimeout(() => {
                    this.navbar.alert.set({
                        type: 'info', // Changed to info to be less "warning"
                        title: 'Descargas',
                        message: '¿Deseas descargar los reportes de Comisiones y Seguros?',
                        buttons: [
                            {
                                text: 'No',
                                style: 'secondary',
                                onClick: () => this.navbar.alert.set(null)
                            },
                            {
                                text: 'Sí',
                                style: 'primary',
                                onClick: () => {
                                    const tourFound = this.toursList.find(t => t.Id_Tour == this.filters.Id_Tour);
                                    const nombreTour = tourFound ? tourFound.Nombre_Tour : '';

                                    this.comisionesService.exportarExcel(this.filters, nombreTour);
                                    this.segurosService.exportarExcel(this.filters, nombreTour);
                                    this.navbar.alert.set(null);
                                }
                            }
                        ]
                    });
                    this.cdr.detectChanges();
                }, 1500);
            },
            error: (err) => {
                this.isLoading = false;
                this.navbar.alert.set({ type: 'error', title: 'Error', message: 'No se pudo guardar.' });
                this.cdr.detectChanges();
            }
        });
    }
}