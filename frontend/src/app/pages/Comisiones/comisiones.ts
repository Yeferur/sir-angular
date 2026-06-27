import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ComisionesService } from '../../services/Comisiones/comisiones.service';
import { Tours } from '../../services/Tours/tours';
import { Reservas } from '../../services/Reservas/reservas';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';

// ── Modal de pago ────────────────────────────────────────────────────────────
export interface ModalPagoState {
    visible:         boolean;
    // A quién le pertenece el pago
    reportante:      any | null;
    // Reservas que se van a pagar (1 = botón individual, N = pagar todas)
    reservas:        any[];
    // Valores editables dentro del modal
    Forma_Pago:      string;
    Cuenta_Bancaria: string;
    // True si la llamada al backend está en curso
    saving:          boolean;
}

@Component({
    selector: 'app-comisiones',
    standalone: true,
    imports: [CommonModule, FormsModule, DatepickerComponent],
    templateUrl: './comisiones.html',
    styleUrl: './comisiones.css'
})
export class ComisionesComponent implements OnInit {
    private svc         = inject(ComisionesService);
    private tourSvc     = inject(Tours);
    private reservasSvc = inject(Reservas);
    private alerts      = inject(SirAlertService);
    private cdr         = inject(ChangeDetectorRef);

    // ── Filtros ──────────────────────────────────────────────────────────────
    fecha            = this.getTodayIso();
    idTour           = '';
    idCanal          = '';
    filtroEstado     = '';
    filtroReportante = '';

    // ── Datos ────────────────────────────────────────────────────────────────
    tours:              any[] = [];
    canalesDisponibles: any[] = [];
    canales:            any[] = [];

    // ── Estado UI ────────────────────────────────────────────────────────────
    hasSearched    = false;
    isSearching    = false;
    isExporting    = false;
    isSavingGlobal = false;   // "Pagar todo" global

    private collapsed    = new Set<number>();
    private savingEstado = new Set<string>(); // por Nombre_Reportante

    // ── Dirty: solo Forma_Pago / Cuenta_Bancaria sin guardar ────────────────
    private dirtyPago = new Map<string, {
        Forma_Pago:      string;
        Cuenta_Bancaria: string | null;
        reservas:        string[];
    }>();

    // ── Touched: reportantes que el usuario ha editado o sobre los que
    //    se intentó guardar/pagar. Solo estos muestran errores de validación.
    private touchedReportantes = new Set<string>();

    // ── Modal de confirmación de pago ────────────────────────────────────────
    modal: ModalPagoState = {
        visible:         false,
        reportante:      null,
        reservas:        [],
        Forma_Pago:      'BANCOLOMBIA',
        Cuenta_Bancaria: '',
        saving:          false,
    };

    private readonly formaPagoDefault = 'BANCOLOMBIA';

    // ── Computed ─────────────────────────────────────────────────────────────
    get hasDirty():   boolean { return this.dirtyPago.size > 0; }
    get dirtyCount(): number  { return this.dirtyPago.size; }

    isDirtyReportante(nombre: string):   boolean { return this.dirtyPago.has(nombre); }
    isSavingReportante(nombre: string):  boolean { return this.savingEstado.has(nombre); }

    get modalRequiereCuenta(): boolean {
        return this.modal.Forma_Pago === 'BANCOLOMBIA' || this.modal.Forma_Pago === 'NEQUI';
    }

    get modalCuentaLabel(): string {
        return this.modal.Forma_Pago === 'NEQUI' ? 'Celular Nequi' : 'Número de cuenta';
    }

    get modalCuentaPlaceholder(): string {
        return this.modal.Forma_Pago === 'NEQUI' ? 'Ej: 3001234567' : 'Ej: 12345678901';
    }

    get modalError(): string {
        const cuenta = String(this.modal.Cuenta_Bancaria || '').trim();
        if (this.modal.Forma_Pago === 'BANCOLOMBIA') {
            if (!/^\d{11}$/.test(cuenta))
                return 'La cuenta Bancolombia debe tener exactamente 11 dígitos.';
        }
        if (this.modal.Forma_Pago === 'NEQUI') {
            if (!/^3\d{9}$/.test(cuenta))
                return 'Debe ser un celular de 10 dígitos que inicie en 3.';
        }
        return '';
    }

    get modalEsValido(): boolean {
        if (!this.modalRequiereCuenta) return true;
        return this.modalError === '';
    }

    // Texto descriptivo en el modal
    get modalTitulo(): string {
        const n = this.modal.reservas.length;
        if (n === 1) return `Pagar reserva #${this.modal.reservas[0]?.Id_Reserva}`;
        return `Pagar ${n} reservas de ${this.modal.reportante?.Nombre_Reportante}`;
    }

    get modalTotalLabel(): string {
        const total = this.modal.reservas.reduce(
            (acc: number, r: any) => acc + (Number(r.Total_Comision) || 0), 0
        );
        return this.formatCOP(total);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────
    ngOnInit(): void {
        this.tourSvc.getTours().subscribe({
            next: (data: any[]) => { this.tours = data || []; this.cdr.detectChanges(); },
            error: (e: any) => console.error(e)
        });

        this.reservasSvc.getCanales().subscribe({
            next: (data: any[]) => {
                this.canalesDisponibles = (data || []).filter(
                    (c: any) => c?.Tiene_Comision !== false && c?.Tiene_Comision !== 0
                );
                this.cdr.detectChanges();
            },
            error: (e: any) => console.error(e)
        });
    }

    // ── Búsqueda ─────────────────────────────────────────────────────────────
    buscar(): void {
        this.hasSearched = true;
        this.isSearching = true;
        this.dirtyPago.clear();
        this.savingEstado.clear();
        this.touchedReportantes.clear();
        this.canales = [];
        this.cerrarModal();
        this.cdr.detectChanges();

        this.svc.listarComisiones({
            Fecha:             this.fecha            || undefined,
            Id_Tour:           this.idTour           || undefined,
            Id_Canal:          this.idCanal          || undefined,
            Estado:            this.filtroEstado     || undefined,
            Nombre_Reportante: this.filtroReportante || undefined,
        }).subscribe({
            next: (data: any[]) => {
                this.canales     = this.normalizarCanales(data || []);
                this.isSearching = false;
                this.cdr.detectChanges();
            },
            error: () => {
                this.alerts.errorToast('Error', 'No se pudieron cargar las comisiones.');
                this.isSearching = false;
                this.cdr.detectChanges();
            }
        });
    }

    // ── Colapsar canal ───────────────────────────────────────────────────────
    toggleCanal(idCanal: number): void {
        this.collapsed.has(idCanal)
            ? this.collapsed.delete(idCanal)
            : this.collapsed.add(idCanal);
    }

    isCollapsed(idCanal: number): boolean {
        return this.collapsed.has(idCanal);
    }

    // ── Abrir modal de pago (reserva individual) ─────────────────────────────
    abrirModalPagarReserva(reserva: any, reportante: any): void {
        if (this.savingEstado.has(reportante.Nombre_Reportante)) return;
        this.abrirModal([reserva], reportante);
    }

    // ── Abrir modal de pago (todas las pendientes del reportante) ────────────
    abrirModalPagarReportante(reportante: any): void {
        if (this.savingEstado.has(reportante.Nombre_Reportante)) return;
        const pendientes = reportante.reservas.filter(
            (r: any) => r.Estado_Liquidacion !== 'PAGADO'
        );
        if (!pendientes.length) return;
        this.abrirModal(pendientes, reportante);
    }

    // ── Pagar todo global (summary bar) ──────────────────────────────────────
    // Recolecta todos los reportantes con pendientes, valida que tengan
    // datos de pago guardados (o efectivo), y ejecuta en batch.
    async pagarTodoGlobal(): Promise<void> {
        if (this.isSavingGlobal) return;

        // Recopilar todos los reportantes que tienen reservas pendientes
        const targets: { reportante: any; reservas: any[] }[] = [];
        for (const canal of this.canales) {
            for (const rep of canal.reportantes || []) {
                const pendientes = (rep.reservas || []).filter(
                    (r: any) => r.Estado_Liquidacion !== 'PAGADO'
                );
                if (pendientes.length) targets.push({ reportante: rep, reservas: pendientes });
            }
        }

        if (!targets.length) return;

        // Marcar todos como touched antes de validar (para mostrar errores si los hay)
        targets.forEach(t => this.touchedReportantes.add(t.reportante.Nombre_Reportante));
        this.cdr.detectChanges();

        // Verificar que todos tengan datos de pago válidos
        const sinDatos = targets.filter(t => this.pagoError(t.reportante) !== '');
        if (sinDatos.length) {
            const nombres = sinDatos.map(t => t.reportante.Nombre_Reportante).join(', ');
            this.alerts.errorToast(
                'Datos de pago incompletos',
                `Los siguientes reportantes necesitan datos de pago válidos: ${nombres}`
            );
            return;
        }

        this.isSavingGlobal = true;
        this.cdr.detectChanges();

        // Snapshot para rollback global
        const snapshots = targets.map(t => ({
            reportante: t.reportante,
            reservas:   t.reservas.map((r: any) => ({ ...r }))
        }));

        // Optimistic update
        for (const t of targets) {
            for (const r of t.reservas) r.Estado_Liquidacion = 'PAGADO';
        }
        this.recalcularTotales();
        this.cdr.detectChanges();

        try {
            await Promise.all(targets.map(t =>
                firstValueFrom(this.svc.actualizarLiquidacion({
                    reservas:        t.reservas.map((r: any) => r.Id_Reserva),
                    Estado:          'PAGADO',
                    Forma_Pago:      t.reportante.Forma_Pago,
                    Cuenta_Bancaria: this.requiereCuentaFP(t.reportante.Forma_Pago)
                        ? String(t.reportante.Cuenta_Bancaria || '').trim()
                        : null,
                }))
            ));
            const total = targets.reduce((acc, t) => acc + t.reservas.length, 0);
            this.alerts.successToast('Pagado', `Se pagaron ${total} reservas correctamente.`);
        } catch {
            // Rollback
            for (const snap of snapshots) {
                for (const r of snap.reservas) {
                    const live = snap.reportante.reservas.find(
                        (x: any) => x.Id_Reserva === r.Id_Reserva
                    );
                    if (live) live.Estado_Liquidacion = r.Estado_Liquidacion;
                }
            }
            this.recalcularTotales();
            this.alerts.errorToast('Error', 'No se pudo completar el pago global.');
        } finally {
            this.isSavingGlobal = false;
            this.cdr.detectChanges();
        }
    }

    // ── Revertir una reserva a PENDIENTE (sin modal, acción directa) ─────────
    async revertirReserva(reserva: any, reportante: any): Promise<void> {
        if (this.savingEstado.has(reportante.Nombre_Reportante)) return;

        const anterior = reserva.Estado_Liquidacion;
        reserva.Estado_Liquidacion = 'PENDIENTE';
        this.recalcularTotales();
        this.cdr.detectChanges();

        await this.persistirEstado(
            [reserva.Id_Reserva],
            reportante,
            'PENDIENTE',
            {
                successMessage: `Reserva #${reserva.Id_Reserva} marcada como pendiente.`,
                errorMessage:   'No se pudo revertir el estado.',
                onError: () => {
                    reserva.Estado_Liquidacion = anterior;
                    this.recalcularTotales();
                    this.cdr.detectChanges();
                }
            }
        );
    }

    // ── Confirmar pago desde el modal ────────────────────────────────────────
    async confirmarPago(): Promise<void> {
        if (!this.modalEsValido || this.modal.saving) return;

        // Persistir datos de pago en el objeto reportante (en memoria)
        // para que queden disponibles si el usuario paga otra reserva después
        const rep = this.modal.reportante;
        rep.Forma_Pago      = this.modal.Forma_Pago;
        rep.Cuenta_Bancaria = this.modalRequiereCuenta
            ? String(this.modal.Cuenta_Bancaria || '').trim()
            : null;

        // Optimistic update
        for (const r of this.modal.reservas) r.Estado_Liquidacion = 'PAGADO';
        this.recalcularTotales();
        this.modal.saving = true;
        this.cdr.detectChanges();

        const snapshot = this.modal.reservas.map((r: any) => r.Id_Reserva);

        try {
            await firstValueFrom(this.svc.actualizarLiquidacion({
                reservas:        snapshot,
                Estado:          'PAGADO',
                Forma_Pago:      rep.Forma_Pago,
                Cuenta_Bancaria: this.modalRequiereCuenta ? rep.Cuenta_Bancaria : null,
            }));

            // Si había datos de pago sin guardar para este reportante, ya están persistidos
            this.dirtyPago.delete(rep.Nombre_Reportante);

            const n = snapshot.length;
            this.alerts.successToast(
                'Pagado',
                n === 1
                    ? `Reserva #${snapshot[0]} marcada como pagada.`
                    : `${n} reservas de ${rep.Nombre_Reportante} marcadas como pagadas.`
            );
            this.cerrarModal();
        } catch {
            // Rollback
            for (const r of this.modal.reservas) r.Estado_Liquidacion = 'PENDIENTE';
            this.recalcularTotales();
            this.alerts.errorToast('Error', 'No se pudo registrar el pago.');
        } finally {
            this.modal.saving = false;
            this.cdr.detectChanges();
        }
    }

    cerrarModal(): void {
        this.modal = {
            visible: false, reportante: null, reservas: [],
            Forma_Pago: this.formaPagoDefault, Cuenta_Bancaria: '', saving: false
        };
        this.cdr.detectChanges();
    }

    onModalFormaPagoChange(): void {
        if (!this.modalRequiereCuenta) this.modal.Cuenta_Bancaria = '';
        this.cdr.detectChanges();
    }

    // ── Forma de pago (campos del bloque del reportante, para guardar sin pagar) ──
    onFormaPagoChange(reportante: any): void {
        this.touchedReportantes.add(reportante.Nombre_Reportante);
        if (!this.requiereCuenta(reportante)) reportante.Cuenta_Bancaria = null;
        this.markDirtyPago(reportante);
        this.cdr.detectChanges();
    }

    onCuentaChange(reportante: any): void {
        this.touchedReportantes.add(reportante.Nombre_Reportante);
        this.markDirtyPago(reportante);
        this.cdr.detectChanges();
    }

    // ── Guardar datos de pago (pendientes, sin cambiar estado) ───────────────
    async guardarCambios(): Promise<void> {
        if (!this.hasDirty) return;

        for (const [nombre] of this.dirtyPago.entries()) {
            this.touchedReportantes.add(nombre);
            const rep = this.buscarReportante(nombre);
            if (rep && this.tienePagoInvalido(rep)) {
                this.alerts.errorToast('Validación requerida', this.pagoError(rep));
                return;
            }
        }

        type PagoGroup = { Forma_Pago: string; Cuenta_Bancaria: string | null; reservas: string[] };
        const grupos = new Map<string, PagoGroup>();

        for (const [, cambio] of this.dirtyPago.entries()) {
            const key = `${cambio.Forma_Pago}|${cambio.Cuenta_Bancaria}`;
            if (!grupos.has(key)) {
                grupos.set(key, { Forma_Pago: cambio.Forma_Pago, Cuenta_Bancaria: cambio.Cuenta_Bancaria, reservas: [] });
            }
            grupos.get(key)!.reservas.push(...cambio.reservas);
        }

        const calls = Array.from(grupos.values()).map(g =>
            firstValueFrom(this.svc.actualizarDatosPago({
                reservas: g.reservas, Forma_Pago: g.Forma_Pago, Cuenta_Bancaria: g.Cuenta_Bancaria
            }))
        );

        try {
            await Promise.all(calls);
            this.dirtyPago.clear();
            this.alerts.successToast('Guardado', 'Datos de pago guardados.');
        } catch {
            this.alerts.errorToast('Error', 'No se pudieron guardar los datos de pago.');
        } finally {
            this.cdr.detectChanges();
        }
    }

    // ── Helpers de forma de pago ─────────────────────────────────────────────
    requiereCuenta(reportante: any): boolean {
        return this.requiereCuentaFP(reportante.Forma_Pago);
    }

    requiereCuentaFP(fp: string): boolean {
        return fp === 'BANCOLOMBIA' || fp === 'NEQUI';
    }

    pagoLabel(reportante: any): string {
        return reportante.Forma_Pago === 'NEQUI' ? 'Celular Nequi' : 'Número de cuenta';
    }

    cuentaPlaceholder(reportante: any): string {
        return reportante.Forma_Pago === 'NEQUI' ? 'Ej: 3001234567' : 'Ej: 12345678901';
    }

    pagoError(reportante: any): string {
        if (!this.requiereCuenta(reportante)) return '';
        const cuenta = String(reportante.Cuenta_Bancaria || '').trim();
        if (reportante.Forma_Pago === 'BANCOLOMBIA') {
            if (!/^\d{11}$/.test(cuenta))
                return 'La cuenta Bancolombia debe tener exactamente 11 dígitos.';
        }
        if (reportante.Forma_Pago === 'NEQUI') {
            if (!/^3\d{9}$/.test(cuenta))
                return 'Debe ser un celular de 10 dígitos que inicie en 3.';
        }
        return '';
    }

    tienePagoInvalido(reportante: any): boolean {
        return !!this.pagoError(reportante);
    }

    // Muestra el error solo si el usuario ya interactuó con este reportante
    // o si se intentó guardar/pagar (touched). Evita mensajes en carga inicial.
    mostrarErrorPago(reportante: any): boolean {
        return this.touchedReportantes.has(reportante.Nombre_Reportante) &&
               this.tienePagoInvalido(reportante);
    }

    tienePendientes(reportante: any): boolean {
        return (reportante.reservas || []).some((r: any) => r.Estado_Liquidacion !== 'PAGADO');
    }

    cantidadPendientes(reportante: any): number {
        return (reportante.reservas || []).filter((r: any) => r.Estado_Liquidacion !== 'PAGADO').length;
    }

    get totalPendientesGlobal(): number {
        return this.canales.reduce((acc, c) =>
            acc + (c.reportantes || []).reduce((a: number, r: any) =>
                a + this.cantidadPendientes(r), 0), 0);
    }

    mostrarBotonPagarReportante(reportante: any): boolean {
        return (reportante.reservas || []).length >= 2 && this.tienePendientes(reportante);
    }

    // ── Exportar Excel ───────────────────────────────────────────────────────
    descargarExcel(): void {
        if (this.hasDirty) {
            this.alerts.confirm(
                '¿Exportar sin guardar?',
                'Hay datos de pago sin guardar. El Excel usará los datos actuales en base de datos. ¿Continuar?',
                () => this._triggerExport(),
                undefined,
                { confirmText: 'Exportar igual', cancelText: 'Cancelar', type: 'warning' }
            );
            return;
        }
        this._triggerExport();
    }

    private _triggerExport(): void {
        this.isExporting = true;
        this.cdr.detectChanges();
        this.svc.exportarExcel({
            Fecha:    this.fecha        || undefined,
            Id_Tour:  this.idTour       || undefined,
            Id_Canal: this.idCanal      || undefined,
            Estado:   this.filtroEstado || undefined,
        });
        setTimeout(() => { this.isExporting = false; this.cdr.detectChanges(); }, 1800);
    }

    // ── Computed totales globales ────────────────────────────────────────────
    get totalGlobal():   number { return this.canales.reduce((a, c) => a + (c.Total_Canal     || 0), 0); }
    get totalPendiente():number { return this.canales.reduce((a, c) => a + (c.Pendiente_Canal  || 0), 0); }
    get totalPagado():   number { return this.canales.reduce((a, c) => a + (c.Pagado_Canal     || 0), 0); }

    get totalReservas(): number {
        return this.canales.reduce((acc, c) =>
            acc + (c.reportantes || []).reduce((a: number, r: any) => a + r.reservas.length, 0), 0);
    }

    formatCOP(val: number): string {
        return new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP', minimumFractionDigits: 0
        }).format(val || 0);
    }

    // ── Privados ─────────────────────────────────────────────────────────────
    private abrirModal(reservas: any[], reportante: any): void {
        this.touchedReportantes.add(reportante.Nombre_Reportante);
        this.modal = {
            visible:         true,
            reportante,
            reservas,
            // Pre-rellenar con datos ya guardados del reportante
            Forma_Pago:      reportante.Forma_Pago      || this.formaPagoDefault,
            Cuenta_Bancaria: reportante.Cuenta_Bancaria || '',
            saving:          false,
        };
        this.cdr.detectChanges();
    }

    private async persistirEstado(
        reservas: string[],
        reportante: any,
        estado: 'PENDIENTE' | 'PAGADO',
        options?: { successMessage?: string; errorMessage?: string; onError?: () => void }
    ): Promise<void> {
        if (!reservas.length) return;
        const key = reportante.Nombre_Reportante;
        this.savingEstado.add(key);
        this.cdr.detectChanges();

        try {
            await firstValueFrom(this.svc.actualizarLiquidacion({
                reservas,
                Estado:          estado,
                Forma_Pago:      reportante.Forma_Pago,
                Cuenta_Bancaria: this.requiereCuenta(reportante)
                    ? String(reportante.Cuenta_Bancaria || '').trim()
                    : null,
            }));

            this.alerts.successToast('Guardado', options?.successMessage ?? 'Liquidación actualizada.');
        } catch {
            options?.onError?.();
            this.alerts.errorToast('Error', options?.errorMessage ?? 'No se pudo guardar.');
        } finally {
            this.savingEstado.delete(key);
            this.cdr.detectChanges();
        }
    }

    private markDirtyPago(reportante: any): void {
        this.dirtyPago.set(reportante.Nombre_Reportante, {
            Forma_Pago:      reportante.Forma_Pago,
            Cuenta_Bancaria: this.requiereCuenta(reportante)
                ? String(reportante.Cuenta_Bancaria || '').trim()
                : null,
            reservas: (reportante.reservas || []).map((r: any) => r.Id_Reserva)
        });
    }

    private buscarReportante(nombre: string): any | null {
        for (const canal of this.canales) {
            const found = canal.reportantes?.find((r: any) => r.Nombre_Reportante === nombre);
            if (found) return found;
        }
        return null;
    }

    private recalcularTotales(): void {
        for (const canal of this.canales) {
            let totalCanal = 0, pendienteCanal = 0, pagadoCanal = 0;
            for (const rep of canal.reportantes || []) {
                let totalRep = 0, pendienteRep = 0, pagadoRep = 0;
                for (const r of rep.reservas || []) {
                    const t = Number(r.Total_Comision) || 0;
                    totalRep += t;
                    r.Estado_Liquidacion === 'PAGADO' ? (pagadoRep += t) : (pendienteRep += t);
                }
                rep.Total_Reportante     = totalRep;
                rep.Pendiente_Reportante = pendienteRep;
                rep.Pagado_Reportante    = pagadoRep;
                totalCanal     += totalRep;
                pendienteCanal += pendienteRep;
                pagadoCanal    += pagadoRep;
            }
            canal.Total_Canal     = totalCanal;
            canal.Pendiente_Canal = pendienteCanal;
            canal.Pagado_Canal    = pagadoCanal;
        }
    }

    private normalizarCanales(canales: any[]): any[] {
        return (canales || []).map((canal: any) => ({
            ...canal,
            reportantes: (canal.reportantes || []).map((rep: any) => ({
                ...rep,
                Forma_Pago:      rep.Forma_Pago      || this.formaPagoDefault,
                Cuenta_Bancaria: rep.Cuenta_Bancaria || null,
                reservas: (rep.reservas || []).map((r: any) => ({ ...r }))
            }))
        }));
    }

    private getTodayIso(): string {
        const now = new Date();
        const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
        return local.toISOString().slice(0, 10);
    }
}
