import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Tours } from '../../services/Tours/tours';
import { ConfirmacionService } from '../../services/confirmacion.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService, type AlertButton } from '../../services/Alertas/alert.service';

@Component({
    selector: 'app-confirmacion',
    standalone: true,
    imports: [CommonModule, FormsModule, DatepickerComponent],
    templateUrl: './confirmacion.html',
    styleUrl: './confirmacion.css'
})
export class ConfirmacionComponent implements OnInit {
    private permisosService = inject(PermisosService);

    toursList: any[] = [];
    pasajeros: any[] = [];
    skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

    allChecked  = false;
    hasSearched = false;
    isLoading   = false;
    isSubmitting = false;

    filters = { Id_Tour: '', Fecha: '' };

    private savedConfirmaciones = new Map<number, number>();

    constructor(
        private toursService: Tours,
        private confirmacionService: ConfirmacionService,
        private alerts: SirAlertService,
        private cdr: ChangeDetectorRef
    ) {}

    // ── Lifecycle ────────────────────────────────────────────────────────────
    ngOnInit(): void {
        const today = new Date();
        today.setDate(today.getDate() - 1);
        this.filters.Fecha = today.toISOString().split('T')[0];
        this.loadTours();
    }

    onFechaChange(_event: any) { /* ngModel mantiene filters.Fecha en sync */ }

    // ── Permisos ─────────────────────────────────────────────────────────────
    get canUpdateAsistencia(): boolean {
        return this.permisosService.tienePermiso('CONTROL_VIAJE.ACTUALIZAR_ASISTENCIA');
    }

    // ── Computed ─────────────────────────────────────────────────────────────
    get totalConfirmados(): number {
        return this.pasajeros.filter(p => Number(p.Confirmacion ?? 0) === 1).length;
    }

    get totalPendientes(): number {
        return this.pasajeros.length - this.totalConfirmados;
    }

    get nombreTourSeleccionado(): string {
        const tour = this.toursList.find(t => Number(t.Id_Tour) === Number(this.filters.Id_Tour));
        return tour?.Nombre_Tour || 'el tour seleccionado';
    }

    // ── Tours ────────────────────────────────────────────────────────────────
    loadTours() {
        this.toursService.getTours().subscribe({
            next: (data: any[]) => { this.toursList = data || []; this.cdr.detectChanges(); },
            error: (err: any) => console.error('Error cargando tours', err)
        });
    }

    // ── Búsqueda ─────────────────────────────────────────────────────────────
    search() {
        if (!this.filters.Id_Tour || !this.filters.Fecha) {
            this.alerts.warningToast('Faltan filtros', 'Por favor selecciona un tour y una fecha.');
            return;
        }

        this.hasSearched = true;
        this.isLoading   = true;
        this.pasajeros   = [];
        this.allChecked  = false;
        this.cdr.detectChanges();

        this.confirmacionService.getPasajeros(Number(this.filters.Id_Tour), this.filters.Fecha).subscribe({
            next: (data: any[]) => {
                this.pasajeros = this.normalizePasajeros(data);
                this.syncSavedConfirmaciones();
                this.checkAllStatus();
                this.isLoading = false;
                if (this.pasajeros.length === 0) {
                    this.alerts.infoToast('Sin pasajeros', 'No hay pasajeros registrados para este tour y fecha.');
                }
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error', err);
                this.isLoading = false;
                this.alerts.errorToast('Error', 'Error cargando pasajeros.');
                this.cdr.detectChanges();
            }
        });
    }

    // ── Toggle todos ─────────────────────────────────────────────────────────
    toggleAll(event: any) {
        if (!this.canUpdateAsistencia) {
            this.alerts.errorToast('Acceso denegado', 'No tienes permiso para actualizar la asistencia.');
            event?.target && (event.target.checked = this.allChecked);
            return;
        }
        const isChecked = !!event?.target?.checked;
        this.allChecked = isChecked;
        this.pasajeros.forEach(p => (p.Confirmacion = isChecked ? 1 : 0));
        this.cdr.detectChanges();
    }

    checkAllStatus() {
        this.allChecked = this.pasajeros.length > 0 &&
            this.pasajeros.every(p => Number(p.Confirmacion ?? 0) === 1);
    }

    isConfirmado(pasajero: any): boolean {
        return Number(pasajero?.Confirmacion ?? 0) === 1;
    }

    trackByPasajero(_index: number, item: any): number {
        return item.Id_Pasajero;
    }

    // ── Guardar ──────────────────────────────────────────────────────────────
    save() {
        if (!this.canUpdateAsistencia) {
            this.alerts.errorToast('Acceso denegado', 'No tienes permiso para actualizar la asistencia.');
            return;
        }
        if (this.pasajeros.length === 0 || this.isSubmitting) return;

        const total       = this.pasajeros.length;
        const confirmados = this.totalConfirmados;
        const pendientes  = this.totalPendientes;
        const nombreTour  = this.nombreTourSeleccionado;
        const fecha       = this.filters.Fecha || 'sin fecha';

        const mapButtons = (buttons: Array<{ text: string; style: string; onClick: () => void }>): AlertButton[] =>
            buttons.map(b => ({
                text: b.text,
                style: (b.style === 'delete' || b.style === 'danger') ? 'danger'
                     : b.style === 'secondary' ? 'secondary' : 'primary',
                onClick: b.onClick
            }));

        this.alerts.showConfirm(
            '¿Guardar confirmación?',
            `Vas a guardar la confirmación de viaje para ${nombreTour} el ${fecha}.\n` +
            `Pasajeros: ${total} — Confirmados: ${confirmados} — Pendientes: ${pendientes}.\n¿Deseas continuar?`,
            mapButtons([
                { text: 'Cancelar', style: 'secondary', onClick: () => this.alerts.closeModal() },
                { text: 'Guardar',  style: 'primary',   onClick: () => { this.alerts.closeModal(); this.performSave(); } }
            ])
        );
    }

    private performSave() {
        if (this.pasajeros.length === 0 || this.isSubmitting) return;

        this.isSubmitting = true;
        this.cdr.detectChanges();

        const payload = this.pasajeros.map(p => ({
            Id_Pasajero:  p.Id_Pasajero,
            Confirmacion: p.Confirmacion ? 1 : 0
        }));

        this.confirmacionService.saveConfirmacion(payload).subscribe({
            next: () => {
                this.syncSavedConfirmaciones();
                this.isSubmitting = false;
                this.alerts.successToast('Confirmación guardada', 'La asistencia se actualizó correctamente.');
                this.cdr.detectChanges();
            },
            error: (err: any) => {
                console.error('Error al guardar confirmación', err);
                this.isSubmitting = false;
                this.alerts.errorToast('Error', 'No se pudo guardar.');
                this.cdr.detectChanges();
            }
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    private normalizePasajeros(data: any[]): any[] {
        return [...(data || [])]
            .sort((a, b) => Number(a.Id_Reserva) - Number(b.Id_Reserva))
            .map(p => ({ ...p, Confirmacion: Number(p.Confirmacion) === 1 ? 1 : 0 }));
    }

    private syncSavedConfirmaciones() {
        this.savedConfirmaciones = new Map(
            this.pasajeros.map(p => [Number(p.Id_Pasajero), Number(p.Confirmacion ?? 0)])
        );
    }

    hasUnsavedChanges(): boolean {
        if (!this.pasajeros?.length || this.isSubmitting) return false;
        return this.pasajeros.some(p => {
            const prev    = this.savedConfirmaciones.get(Number(p.Id_Pasajero)) ?? 0;
            const current = Number(p.Confirmacion ?? 0);
            return prev !== current;
        });
    }
}
