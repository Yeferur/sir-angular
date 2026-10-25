import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  GrupoComisionDia,
  ComisionesService,
  DetalleGrupoComision,
  FormaPagoComision,
  PerfilComisionEntidad,
  PerfilComisionEntidadPayload,
} from '../../services/Comisiones/comisiones.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { DrawerCloseButtonComponent } from '../../shared/drawer-close-button/drawer-close-button';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

@Component({
  selector: 'app-comisiones-grupo-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, DrawerCloseButtonComponent, LoadingStateComponent],
  templateUrl: './comisiones-grupo-drawer.html',
  styleUrl: './comisiones-grupo-drawer.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComisionesGrupoDrawerComponent implements OnInit {
  @Input() groupId = '';
  @Input() startPayment = false;
  @Input() group: GrupoComisionDia | null = null;
  @Output() closed = new EventEmitter<void>();

  private readonly commissions = inject(ComisionesService);
  private readonly alerts = inject(SirAlertService);
  private readonly drawer = inject(SirDrawerService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly pageSize = 25;
  detail: DetalleGrupoComision | null = null;
  loading = true;
  loadingPendingPage = false;
  loadingLot = false;
  saving = false;
  error = '';
  pendingPage = 1;
  expandedLotId = '';
  lotPage = 1;
  expandedLot: DetalleGrupoComision['loteDetalle'] | null = null;
  showPaymentDialog = false;
  paymentConflict = '';
  profileLoading = false;
  profile: PerfilComisionEntidad | null = null;
  profileSaveWarning = '';
  pendingProfilePayload: PerfilComisionEntidadPayload | null = null;
  savingProfile = false;
  saveProfile = false;
  paymentMethod: FormaPagoComision | '' = '';
  paymentAccount = '';
  paymentRecipient = '';
  paymentRecipientId = '';
  receiptFile: File | null = null;
  receiptError = '';
  showAnnulDialog = false;
  annulReason = '';
  uploadingLotId = '';
  private readonly proofFiles = new Map<string, File>();

  readonly paymentMethodOptions: { value: FormaPagoComision; label: string }[] = [
    { value: 'TRANSFERENCIA_BANCOLOMBIA', label: 'Bancolombia' },
    { value: 'NEQUI', label: 'Nequi' },
    { value: 'EFECTIVO', label: 'Efectivo' },
  ];

  ngOnInit(): void {
    void this.loadDetail().then(() => {
      this.restorePendingProfileSave();
      if (this.startPayment && this.group?.Puede_Pagar) void this.openPaymentDialog();
    });
  }

  get pendingTotal(): number { return Number(this.group?.Monto_Pendiente ?? 0); }
  get pendingCount(): number { return Number(this.group?.Cantidad_Reservas_Pendientes ?? this.detail?.paginacionReservasPendientes?.total ?? 0); }

  get paymentError(): string {
    if (!this.paymentMethod) return 'Selecciona el medio de pago.';
    if (!this.paymentRecipient.trim()) return 'Ingresa el nombre de quien recibió el pago.';
    if (!this.paymentRecipientId.trim()) return 'Ingresa el documento de quien recibió el pago.';
    if (!/^[a-zA-Z0-9.\-\s]{4,50}$/.test(this.paymentRecipientId.trim())) return 'El DNI, NIT o documento no es válido.';
    if (this.paymentMethod === 'TRANSFERENCIA_BANCOLOMBIA' && !/^\d{11}$/.test(this.paymentAccount.trim())) {
      return 'La cuenta Bancolombia debe tener exactamente 11 dígitos.';
    }
    if (this.paymentMethod === 'NEQUI' && !/^3\d{9}$/.test(this.paymentAccount.trim())) {
      return 'El celular Nequi debe tener 10 dígitos e iniciar en 3.';
    }
    return '';
  }

  async loadDetail(page = 1): Promise<void> {
    this.loading = page === 1;
    this.loadingPendingPage = page > 1;
    this.error = '';
    this.cdr.markForCheck();
    try {
      const result = await firstValueFrom(this.commissions.obtenerDetalleGrupo(this.groupId, page, this.pageSize));
      this.detail = result;
      this.pendingPage = page;
      if (!this.group) await this.refreshSummary();
    } catch (error: any) {
      this.error = error?.error?.message || error?.message || 'No pudimos cargar el detalle del grupo.';
    } finally {
      this.loading = false;
      this.loadingPendingPage = false;
      this.cdr.markForCheck();
    }
  }

  async openPaymentDialog(): Promise<void> {
    if (!this.group?.Puede_Pagar || !this.pendingCount || this.saving) return;
    this.showPaymentDialog = true;
    this.paymentConflict = '';
    this.receiptError = '';
    this.receiptFile = null;
    this.profileLoading = true;
    this.cdr.markForCheck();
    try {
      this.profile = await firstValueFrom(this.commissions.obtenerPerfilEntidad(this.group.Id_Entidad_Reportante));
      this.paymentMethod = this.profile?.Forma_Pago || '';
      this.paymentAccount = this.profile?.Numero_Cuenta || '';
      this.paymentRecipient = this.profile?.Nombre_Receptor || '';
      this.paymentRecipientId = this.profile?.DNI_Receptor || '';
      this.saveProfile = Boolean(this.profile);
    } catch (error: any) {
      this.profile = null;
      this.paymentMethod = '';
      this.paymentAccount = '';
      this.paymentRecipient = '';
      this.paymentRecipientId = '';
      this.saveProfile = false;
      this.alerts.warningToast('No se cargó el perfil de pago', error?.error?.message || 'Ingresa los datos manualmente para este pago.');
    } finally {
      this.profileLoading = false;
      this.cdr.markForCheck();
    }
  }

  closePaymentDialog(): void {
    if (this.saving) return;
    this.showPaymentDialog = false;
    this.paymentConflict = '';
    this.cdr.markForCheck();
  }

  onReceiptSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.receiptError = '';
    this.receiptFile = null;
    if (file) {
      this.receiptError = this.validateFile(file);
      if (!this.receiptError) this.receiptFile = file;
    }
    this.cdr.markForCheck();
  }

  async submitPayment(): Promise<void> {
    if (!this.group?.Puede_Pagar || this.saving) return;
    if (this.profileLoading) return;
    if (this.paymentError) {
      this.alerts.warningToast('Revisa los datos del pago', this.paymentError);
      return;
    }
    if (this.receiptError) return;
    const paymentMethod = this.paymentMethod as FormaPagoComision;
    this.saving = true;
    this.error = '';
    this.cdr.markForCheck();
    try {
      await firstValueFrom(this.commissions.marcarGrupoPagado(this.group.Id, {
        Monto_Pendiente_Esperado: this.pendingTotal,
        Cantidad_Reservas_Pendientes_Esperada: this.pendingCount,
        Forma_Pago: paymentMethod,
        Cuenta_Bancaria: this.paymentAccount || null,
        Nombre_Receptor: this.paymentRecipient.trim(),
        DNI_Receptor: this.paymentRecipientId.trim(),
      }, this.receiptFile));
      if (this.saveProfile) {
        const payload: PerfilComisionEntidadPayload = {
          Id_Perfil_Comision: this.profile?.Id_Perfil_Comision,
          Id_Entidad_Reportante: this.group.Id_Entidad_Reportante,
          Forma_Pago: paymentMethod,
          Numero_Cuenta: this.paymentAccount || null,
          Nombre_Receptor: this.paymentRecipient.trim(),
          DNI_Receptor: this.paymentRecipientId.trim(),
        };
        try {
          this.profile = await this.persistPaymentProfile(payload);
          this.pendingProfilePayload = null;
          this.profileSaveWarning = '';
          this.commissions.olvidarPerfilPendiente(payload.Id_Entidad_Reportante);
        } catch (profileError: any) {
          this.pendingProfilePayload = payload;
          this.profileSaveWarning = this.profileSaveFailureMessage(profileError);
          this.commissions.recordarPerfilPendiente(payload, this.profileSaveWarning);
        }
      }
      this.showPaymentDialog = false;
      this.alerts.successToast('Pago registrado', 'Se creó el lote de pago.');
      this.dispatchRefresh();
      await this.refreshSummary();
      await this.loadDetail();
    } catch (error: any) {
      if (error?.status === 409 && error?.error?.errorCode === 'GROUP_TOTAL_CHANGED') {
        this.paymentConflict = 'El grupo cambió desde que lo abriste. Revisa las cifras actualizadas y confirma otra vez.';
        await this.refreshSummary();
        await this.loadDetail();
        if (!this.group?.Puede_Pagar || !this.pendingCount) {
          this.showPaymentDialog = false;
          this.paymentConflict = 'El grupo ya no tiene un ajuste pagable. Se actualizó la lista.';
        }
      } else {
        this.error = error?.error?.message || error?.message || 'No se pudo registrar el pago.';
      }
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  async retryProfileSave(): Promise<void> {
    const payload = this.pendingProfilePayload;
    if (!payload || this.savingProfile) return;
    this.savingProfile = true;
    this.cdr.markForCheck();
    try {
      this.profile = await this.persistPaymentProfile(payload);
      this.pendingProfilePayload = null;
      this.profileSaveWarning = '';
      this.commissions.olvidarPerfilPendiente(payload.Id_Entidad_Reportante);
      this.alerts.successToast('Perfil guardado', 'Los datos quedaron disponibles para próximos pagos.');
    } catch (error: any) {
      this.profileSaveWarning = this.profileSaveFailureMessage(error);
      this.commissions.recordarPerfilPendiente(payload, this.profileSaveWarning);
    } finally {
      this.savingProfile = false;
      this.cdr.markForCheck();
    }
  }

  dismissProfileSaveWarning(): void {
    const idEntity = this.profileSaveEntityId;
    if (idEntity) this.commissions.olvidarPerfilPendiente(idEntity);
    this.pendingProfilePayload = null;
    this.profileSaveWarning = '';
    this.cdr.markForCheck();
  }

  private restorePendingProfileSave(): void {
    const idEntity = this.profileSaveEntityId;
    if (!idEntity) return;
    const pending = this.commissions.obtenerPerfilPendiente(idEntity);
    if (!pending) return;
    this.pendingProfilePayload = pending.payload;
    this.profileSaveWarning = pending.message;
    this.cdr.markForCheck();
  }

  private get profileSaveEntityId(): number {
    return Number(this.group?.Id_Entidad_Reportante || this.detail?.grupo.Id_Entidad_Reportante || 0);
  }

  private async persistPaymentProfile(payload: PerfilComisionEntidadPayload): Promise<PerfilComisionEntidad> {
    let currentProfile = this.profile;
    if (!currentProfile) {
      currentProfile = await firstValueFrom(this.commissions.obtenerPerfilEntidad(payload.Id_Entidad_Reportante));
    }
    if (currentProfile) {
      return firstValueFrom(this.commissions.actualizarPerfilEntidad({
        ...payload,
        Id_Perfil_Comision: currentProfile.Id_Perfil_Comision,
      }));
    }
    return firstValueFrom(this.commissions.crearPerfilEntidad(payload));
  }

  private profileSaveFailureMessage(error: any): string {
    const reason = error?.error?.message || error?.message;
    return reason
      ? `El pago quedó registrado. No se pudo guardar el perfil: ${reason}`
      : 'El pago quedó registrado, pero no se pudo guardar el perfil para próximos pagos.';
  }

  private async refreshSummary(): Promise<void> {
    const date = this.detail?.grupo.Fecha_Tour || this.group?.Fecha_Tour;
    const entityId = this.detail?.grupo.Id_Entidad_Reportante || this.group?.Id_Entidad_Reportante;
    if (!date || !entityId) return;
    try {
      const result = await firstValueFrom(this.commissions.listarGrupos({
        desde: date, hasta: date, Id_Entidad_Reportante: String(entityId), page: 1, limit: 25,
      }));
      this.group = result.grupos.find((row) => row.Id === this.groupId) || this.group;
    } catch { /* El detalle sigue disponible aunque falle la actualización del resumen. */ }
  }

  toggleLot(lotId: string): void {
    if (this.expandedLotId === lotId) {
      this.expandedLotId = '';
      this.expandedLot = null;
      return;
    }
    this.expandedLotId = lotId;
    this.lotPage = 1;
    this.expandedLot = null;
    void this.loadLot(lotId, 1);
  }

  async loadLot(lotId: string, page: number): Promise<void> {
    this.loadingLot = true;
    this.cdr.markForCheck();
    try {
      const result = await firstValueFrom(this.commissions.obtenerDetalleGrupo(this.groupId, page, this.pageSize, lotId));
      this.expandedLot = result.loteDetalle || null;
      this.lotPage = page;
    } catch (error: any) {
      this.alerts.errorToast('No se pudo cargar el lote', error?.error?.message || 'Intenta nuevamente.');
    } finally {
      this.loadingLot = false;
      this.cdr.markForCheck();
    }
  }

  onLotFileSelected(lotId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const error = this.validateFile(file);
    if (error) {
      this.alerts.warningToast('Comprobante no válido', error);
      input.value = '';
      return;
    }
    this.proofFiles.set(lotId, file);
    this.cdr.markForCheck();
  }

  proofFileName(lotId: string): string {
    return this.proofFiles.get(lotId)?.name || '';
  }

  async uploadProof(lotId: string): Promise<void> {
    const file = this.proofFiles.get(lotId);
    if (!file || this.uploadingLotId) return;
    this.uploadingLotId = lotId;
    this.cdr.markForCheck();
    try {
      await firstValueFrom(this.commissions.subirComprobanteLote(lotId, file));
      this.proofFiles.delete(lotId);
      this.alerts.successToast('Comprobante guardado', 'Quedó asociado a este lote.');
      this.dispatchRefresh();
      await this.loadDetail(this.pendingPage);
      if (this.expandedLotId === lotId) await this.loadLot(lotId, this.lotPage);
    } catch (error: any) {
      this.alerts.errorToast('No se pudo guardar el comprobante', error?.error?.message || 'Intenta nuevamente.');
    } finally {
      this.uploadingLotId = '';
      this.cdr.markForCheck();
    }
  }

  async downloadProof(lotId: string, originalName: string | null): Promise<void> {
    try {
      const blob = await firstValueFrom(this.commissions.descargarComprobanteLote(lotId));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = originalName || `comprobante-lote-${lotId}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      this.alerts.errorToast('No se pudo descargar el comprobante', error?.error?.message || 'Intenta nuevamente.');
    }
  }

  requestAnnul(lotId: string): void {
    this.annulReason = '';
    this.showAnnulDialog = true;
    this.expandedLotId = lotId;
    this.cdr.markForCheck();
  }

  async annulPayment(lotId: string): Promise<void> {
    const reason = this.annulReason.trim();
    if (reason.length < 5 || reason.length > 1000 || this.saving) return;
    this.saving = true;
    this.cdr.markForCheck();
    try {
      await firstValueFrom(this.commissions.anularLote(lotId, reason));
      this.showAnnulDialog = false;
      this.alerts.successToast('Pago anulado', 'El lote conserva su historial y las reservas quedaron disponibles.');
      this.dispatchRefresh();
      await this.refreshSummary();
      await this.loadDetail();
    } catch (error: any) {
      this.alerts.errorToast('No se pudo anular el pago', error?.error?.message || 'Intenta nuevamente.');
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  openReservation(id: string): void {
    this.drawer.openReserva(id);
  }

  typeLabel(type: string | null | undefined): string {
    return type === 'HOTEL' ? 'Hotel' : type === 'AGENCIA_NACIONAL' ? 'Agencia nacional' : 'Entidad';
  }

  formatCOP(value: number | null | undefined): string {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  formatDate(value: string | null | undefined): string {
    const [year, month, day] = String(value || '').slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : '—';
  }

  close(): void { this.closed.emit(); }

  get annulError(): string {
    if (!this.annulReason.trim()) return 'Escribe el motivo de anulación.';
    if (this.annulReason.trim().length < 5) return 'El motivo debe tener al menos 5 caracteres.';
    if (this.annulReason.trim().length > 1000) return 'El motivo no puede superar 1000 caracteres.';
    return '';
  }

  private validateFile(file: File): string {
    if (file.size <= 0) return 'El archivo está vacío.';
    if (file.size > MAX_FILE_BYTES) return 'El comprobante debe pesar máximo 5 MB.';
    if (!ACCEPTED_MIMES.has(file.type.toLowerCase())) return 'El comprobante debe ser PDF, JPG o PNG.';
    return '';
  }

  private dispatchRefresh(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('comisiones-grupos-actualizados'));
  }
}
