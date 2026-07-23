import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectorRef
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { firstValueFrom, Subscription } from 'rxjs';
import { TransferService } from '../../services/Transfers/transfers';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { UiStateService } from '../../services/ui-state.service';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';
import { toUserErrorMessage } from '../../shared/errors/user-error-message';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { logoBase64 } from '../../../../public/assets/img/logoBase64';

interface Transfer {
  Id_Transfer?: number | string;
  Codigo_Transfer?: string;
  Nombre_Titular?: string;
  DNI?: string;
  Telefono_Titular?: string;
  Nombre_Servicio?: string;
  RangoDescripcion?: string;
  Cantidad_Personas?: number | string;
  Punto_Salida?: string;
  Punto_Destino?: string;
  Fecha_Transfer?: string;
  Hora_Recogida?: string;
  Nombre_Reportante?: string;
  Telefono_Reportante?: string;
  Valor?: number | string;
  MonedaCodigo?: string;
  Vuelo?: string;
  TipoVuelo?: string;
  Estado?: string;
  Observaciones?: string;
  Comprobantes?: ComprobanteTransfer[];
  Pasajeros?: TransferPasajero[];
}

interface Pago {
  Id_Pago?: number;
  Monto: number | string;
  Metodo: string;
  Fecha_Pago?: string;
  Estado: string;
  Observaciones?: string;
  Pago_Comprobante?: string | null;
}

interface ComprobanteTransfer {
  id?: number | string;
  Id_Pago?: number | string;
  nombre?: string;
  filename?: string;
  url?: string;
  tipo?: string;
  fecha?: string;
}

interface TransferPasajero {
  id?: number | string;
  NombrePasajero?: string;
  DNI?: string;
  TelefonoPasajero?: string;
  TipoPasajero?: string;
  Precio_Pasajero?: number | string;
}

interface TransferDetalle {
  transfer: Transfer;
  pagos: Pago[];
  Comprobantes?: ComprobanteTransfer[];
  comprobantes?: ComprobanteTransfer[];
  Pasajeros?: TransferPasajero[];
  pasajeros?: TransferPasajero[];
}

@Component({
  selector: 'app-transfer-dynamic',
  standalone: true,
  imports: [CommonModule, LoadingStateComponent],
  templateUrl: './transfer.html',
  styleUrls: ['./transfer.css']
})
export class TransferDynamicComponent implements OnChanges, OnDestroy {
  @Input() Id_Transfer!: string | number;
  @Output() onClose = new EventEmitter<void>();

  private readonly datePipe = new DatePipe('es-CO');

  isLoading = true;
  isRefreshing = false;
  errorMessage = '';
  activeAction: 'pdf' | 'comprobantes' | 'cancelar' | 'eliminar' | null = null;
  private loadSubscription?: Subscription;

  data: TransferDetalle | null = null;

  constructor(
    private api: TransferService,
    private cdr: ChangeDetectorRef,
    private uiState: UiStateService,
    private permisosService: PermisosService,
    private alerts: SirAlertService,
    private router: Router,
    private drawer: SirDrawerService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Transfer']?.currentValue) {
      this.loadTransferData(changes['Id_Transfer'].currentValue);
    }
  }

  private loadTransferData(id: string | number): void {
    this.loadSubscription?.unsubscribe();
    const keepsCurrent = String(this.data?.transfer?.Id_Transfer ?? '') === String(id);
    this.isLoading = !keepsCurrent;
    this.isRefreshing = keepsCurrent;
    this.errorMessage = '';
    if (!keepsCurrent) this.data = null;

    this.loadSubscription = this.api.getTransfer(id).subscribe({
      next: (response: any) => {
        this.data = response?.data || response;
        this.isLoading = false;
        this.isRefreshing = false;
        this.activeAction = null;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        console.error('Error loading transfer:', err);
        this.errorMessage = toUserErrorMessage(err, 'No pudimos cargar el transfer.');
        this.isLoading = false;
        this.isRefreshing = false;
        this.activeAction = null;
        this.cdr.markForCheck();
      }
    });
  }

  retryLoad(): void {
    if (this.Id_Transfer) this.loadTransferData(this.Id_Transfer);
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
  }

  get transfer(): Transfer {
    return this.data?.transfer || { Id_Transfer: null };
  }

  get transferCodigo(): string {
    const codigo = this.transfer.Codigo_Transfer?.toString().trim();
    if (codigo) return codigo;

    const id = this.transfer.Id_Transfer || this.Id_Transfer;
    const numeric = String(id || '').replace(/\D/g, '');
    return numeric ? `TRS${numeric.padStart(5, '0')}` : 'TRS';
  }

  get pagos(): Pago[] {
    return this.data?.pagos || [];
  }

  get pasajeros(): TransferPasajero[] {
    const raw = this.data?.Pasajeros || (this.data as any)?.pasajeros || this.transfer.Pasajeros || [];
    return Array.isArray(raw) ? raw : [];
  }

  get puedeCancelar(): boolean {
    const estado = String(this.transfer.Estado ?? (this.transfer as any).Estado_Transfer ?? '').toLowerCase();
    return !!this.transfer.Id_Transfer && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
  }

  editarTransfer(): void {
    const id = this.transfer.Id_Transfer || this.Id_Transfer;
    if (!id || !this.canUpdateTransfer) return;
    this.close();
    this.router.navigate(['/Transfers/EditarTransfer', id]);
  }

  get canDeleteTransfer(): boolean {
    return this.permisosService.tienePermiso('TRANSFERS.ELIMINAR');
  }

  get canUpdateTransfer(): boolean {
    return this.permisosService.tienePermiso('TRANSFERS.ACTUALIZAR');
  }


  get transferSublinea(): string {
    return [
      this.transfer.Punto_Salida || '—',
      this.transfer.Punto_Destino || '—',
      this.formatDate(this.transfer.Fecha_Transfer),
      this.transfer.Hora_Recogida || '—'
    ].join(' · ');
  }

  cancelarTransfer(): void {
    const id = this.transfer.Id_Transfer || this.Id_Transfer;
    if (!id) return;

    this.alerts.confirm(
      'Cancelar transfer',
      `¿Cancelar el transfer #${this.transferCodigo}? La información se conservará para consulta futura.`,
      () => {
        this.api.cancelarTransfer(id).subscribe({
          next: () => {
            this.alerts.successToast('Transfer cancelado', `El transfer #${this.transferCodigo} quedó en estado Cancelado.`);
            this.loadTransferData(id);
          },
          error: (error) => {
            this.alerts.showModal({
              type: 'error',
              title: 'No se pudo cancelar',
              message: toUserErrorMessage(error, 'No fue posible cancelar el transfer.'),
            });
          }
        });
      },
      undefined,
      { confirmText: 'Cancelar transfer', cancelText: 'Mantener', type: 'warning' }
    );
  }

  eliminarTransfer(): void {
    const id = this.transfer.Id_Transfer || this.Id_Transfer;
    if (!id || !this.canDeleteTransfer) return;

    this.alerts.confirmDelete(
      'Eliminar transfer',
      `¿Deseas eliminar el transfer #${this.transferCodigo}? Esta acción eliminará el registro de forma permanente.`,
      () => {
        this.api.deleteTransfer(id).subscribe({
          next: () => {
            this.uiState.needsRefresh.set('transfers');
            this.uiState.transferId.set(null);
            this.close();
            this.alerts.successToast('Transfer eliminado', `El transfer #${this.transferCodigo} fue eliminado correctamente.`);
          },
          error: (error) => {
            this.alerts.showModal({
              type: 'error',
              title: 'No se pudo eliminar',
              message: toUserErrorMessage(error, 'No fue posible eliminar el transfer.'),
            });
          }
        });
      },
      undefined,
      { confirmText: 'Eliminar', cancelText: 'Cancelar' }
    );
  }

  get valorTotal(): number {
    return Number(this.transfer.Valor || 0);
  }

  private isDirectPayment(pago: Pago | any): boolean {
    const metodo = String(pago?.Metodo || pago?.Tipo || pago?.FormaPago || '')
      .trim()
      .toLowerCase();

    return metodo === 'paga en punto' || metodo === 'pago directo' || metodo === 'directo';
  }

  get pagosEfectivos(): Pago[] {
    return this.pagos.filter((pago) => !this.isDirectPayment(pago));
  }

  get totalPagado(): number {
    return this.pagosEfectivos
      .filter(p => p.Estado === 'Pagado')
      .reduce((sum, p) => sum + Number(p.Monto || 0), 0);
  }

  get saldoPendiente(): number {
    return Math.max(0, this.valorTotal - this.totalPagado);
  }

  get porcentajePagado(): number {
    return this.valorTotal > 0 ? Math.min(100, Math.max(0, (this.totalPagado / this.valorTotal) * 100)) : 0;
  }

  get esPagoDirecto(): boolean {
    return this.pagos.some((pago) => this.isDirectPayment(pago));
  }

  get estadoNormalizado(): string {
    return (this.transfer.Estado || 'Pendiente').toLowerCase();
  }

  get estadoMostrado(): string {
    const estadoBase = String(this.transfer.Estado || 'Pendiente').trim();
    if (estadoBase !== 'Confirmado') return estadoBase || 'Pendiente';

    if (this.pagos.some((pago) => this.isDirectPayment(pago))) return 'Confirmado - Pago en punto';
    if (this.saldoPendiente > 0 && this.pagosEfectivos.some((pago) => String(pago?.Metodo || '').trim() === 'Abono')) {
      return 'Confirmado - Pendiente de pago';
    }
    return 'Confirmado';
  }

  get estadoClase(): string {
    return String(this.transfer.Estado || 'pendiente')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  private formatCurrency(value: any): string {
    const n = Number(value || 0);
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(n);
  }

  private formatDate(value: any): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-CO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  private ensurePdfSpace(doc: jsPDF & { lastAutoTable?: any }, currentY: number, needed = 30): number {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (currentY + needed > pageHeight - 15) {
      doc.addPage();
      return 15;
    }
    return currentY;
  }

  private normalizeComprobanteName(value: string): string {
    const clean = String(value || '').split('?')[0].split('#')[0];
    const parts = clean.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || clean || '';
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }

  private getExtensionFromUrl(url: string): string {
    const clean = String(url || '').split('?')[0];
    const ext = clean.includes('.') ? clean.split('.').pop() : '';
    return ext ? `.${ext}` : '';
  }

  private getExtensionFromMime(mime: string): string {
    const lower = String(mime || '').toLowerCase();
    if (lower.includes('pdf')) return '.pdf';
    if (lower.includes('jpeg')) return '.jpg';
    if (lower.includes('jpg')) return '.jpg';
    if (lower.includes('png')) return '.png';
    if (lower.includes('webp')) return '.webp';
    return '';
  }

  private normalizeComprobanteFromPago(pago: any, index: number): ComprobanteTransfer | null {
    if (this.isDirectPayment(pago)) return null;

    const url = pago?.Pago_Comprobante || pago?.Ruta_Comprobante || pago?.SoporteUrl || pago?.Comprobante || pago?.UrlComprobante || pago?.Archivo;
    if (!url) return null;

    return {
      id: pago?.Id_Pago ?? index + 1,
      Id_Pago: pago?.Id_Pago,
      nombre: pago?.NombreArchivo || pago?.filename || this.normalizeComprobanteName(url),
      filename: pago?.NombreArchivo || pago?.filename || this.normalizeComprobanteName(url),
      url,
      tipo: pago?.Metodo || pago?.Tipo || pago?.FormaPago || 'Comprobante',
      fecha: pago?.Fecha_Pago || pago?.fecha || ''
    };
  }

  get comprobantesDisponibles(): ComprobanteTransfer[] {
    const raw = this.data?.Comprobantes || (this.data as any)?.comprobantes;
    if (Array.isArray(raw) && raw.length) {
      return raw.map((c: any, index: number) => ({
        id: c?.id ?? c?.Id_Pago ?? index + 1,
        Id_Pago: c?.Id_Pago,
        nombre: c?.nombre || c?.filename || this.normalizeComprobanteName(c?.url || c?.Pago_Comprobante || c?.Ruta_Comprobante || c?.SoporteUrl || ''),
        filename: c?.filename || c?.nombre || this.normalizeComprobanteName(c?.url || c?.Pago_Comprobante || c?.Ruta_Comprobante || c?.SoporteUrl || ''),
        url: c?.url || c?.Pago_Comprobante || c?.Ruta_Comprobante || c?.SoporteUrl || c?.Comprobante || c?.UrlComprobante || c?.Archivo || '',
        tipo: c?.tipo || c?.Metodo || c?.FormaPago || 'Comprobante',
        fecha: c?.fecha || c?.Fecha_Pago || ''
      })).filter(c => Boolean(c.url) && !this.isDirectPayment(c));
    }

    return this.pagosEfectivos
      .map((pago, index) => this.normalizeComprobanteFromPago(pago, index))
      .filter((item): item is ComprobanteTransfer => Boolean(item?.url));
  }

  private renderPdfFooter(doc: jsPDF & { lastAutoTable?: any }): void {
    const totalPages = doc.getNumberOfPages();
    const fechaGeneracion = new Date().toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text('Este documento confirma los datos registrados del transfer. Ante cualquier duda, comunícate con Maxitours.', 10, pageHeight - 10, { maxWidth: pageWidth - 20 });
      doc.text(`Generado por SIR | ${fechaGeneracion}`, 10, pageHeight - 5);
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - 10, pageHeight - 5, { align: 'right' });
    }
  }

  private buildTransferPdfDoc(): jsPDF & { lastAutoTable?: any } {
    const t = this.transfer;
    const doc = new jsPDF() as jsPDF & { lastAutoTable?: any };

    const pageWidth = doc.internal.pageSize.getWidth();

    // ── Encabezado ──────────────────────────────────────────────────────────
    doc.addImage(logoBase64, 'PNG', 10, 10, 36, 14);
    doc.setFontSize(18);
    doc.setTextColor(35, 35, 35);
    doc.text('Confirmación de Transfer', 50, 18);
    doc.setFontSize(11);
    doc.setTextColor(90, 90, 90);
    doc.text(`Transfer ${this.transferCodigo}`, 50, 25);
    doc.text(`Generada: ${this.formatDate(new Date())}`, 50, 31);
    doc.line(10, 36, pageWidth - 10, 36);

    let currentY = 42;

    // ── Información del transfer ─────────────────────────────────────────────
    currentY = this.ensurePdfSpace(doc, currentY, 36);
    doc.setFontSize(12);
    doc.setTextColor(35, 35, 35);
    doc.text('Información del transfer', 10, currentY);
    currentY += 3;

    autoTable(doc, {
      head: [['Campo', 'Detalle']],
      body: [
        ['Transfer', this.transferCodigo],
        ['Estado', this.estadoMostrado],
        ['Servicio', t.Nombre_Servicio || '—'],
        ['Fecha del servicio', this.formatDate(t.Fecha_Transfer)],
        ['Hora de recogida', t.Hora_Recogida || '—'],
        ['Origen', t.Punto_Salida || '—'],
        ['Destino', t.Punto_Destino || '—'],
        ['Titular', t.Nombre_Titular || '—'],
        ['Teléfono de contacto', t.Telefono_Titular || '—'],
        ...(t.Vuelo ? [['Vuelo', `${t.TipoVuelo || ''} ${t.Vuelo}`.trim()]] : []),
        ['Personas', String(t.Cantidad_Personas ?? '—')],
      ],
      startY: currentY + 2,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
      margin: { left: 10, right: 10 }
    });

    currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;

    // ── Resumen de pago ──────────────────────────────────────────────────────
    currentY = this.ensurePdfSpace(doc, currentY, 32);
    doc.setFontSize(12);
    doc.setTextColor(35, 35, 35);
    doc.text('Resumen de pago', 10, currentY);
    currentY += 3;

    autoTable(doc, {
      head: [['Concepto', 'Valor']],
      body: [
        ['Total', this.formatCurrency(this.valorTotal)],
        ['Pagado', this.formatCurrency(this.totalPagado)],
        ['Pendiente', this.formatCurrency(this.saldoPendiente)],
      ],
      startY: currentY + 2,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
      margin: { left: 10, right: 10 }
    });

    currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;

    // ── Abonos ───────────────────────────────────────────────────────────────
    if (this.pagosEfectivos.length > 0) {
      currentY = this.ensurePdfSpace(doc, currentY, 40);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Abonos y comprobantes', 10, currentY);
      currentY += 3;

      autoTable(doc, {
        head: [['Fecha', 'Método / tipo', 'Valor', 'Comprobante']],
        body: this.pagosEfectivos.map((p) => [
          this.formatDate(p.Fecha_Pago),
          p.Metodo || '—',
          this.formatCurrency(p.Monto),
          p.Pago_Comprobante ? 'Sí' : 'No',
        ]),
        startY: currentY + 2,
        theme: 'grid',
        styles: { fontSize: 8.4, cellPadding: 2, valign: 'top' },
        headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
        margin: { left: 10, right: 10 }
      });

      currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;
    }

    // ── Pasajeros ────────────────────────────────────────────────────────────
    const pasajeros = this.pasajeros;
    if (pasajeros.length > 0) {
      currentY = this.ensurePdfSpace(doc, currentY, 48);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Pasajeros', 10, currentY);
      currentY += 3;

      autoTable(doc, {
        head: [['Nombre', 'Tipo', 'DNI / Pasaporte', 'Teléfono', 'Precio']],
        body: pasajeros.map((p) => [
          p.NombrePasajero || '—',
          p.TipoPasajero || '—',
          p.DNI || '—',
          p.TelefonoPasajero || '—',
          this.formatCurrency(p.Precio_Pasajero),
        ]),
        startY: currentY + 2,
        theme: 'striped',
        styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
        headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
        margin: { left: 10, right: 10 }
      });

      currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;
    }

    // ── Observaciones ────────────────────────────────────────────────────────
    if (t.Observaciones) {
      currentY = this.ensurePdfSpace(doc, currentY, 28);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Observaciones', 10, currentY);
      currentY += 4;

      doc.setFontSize(9.5);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(String(t.Observaciones), pageWidth - 20);
      doc.text(lines, 10, currentY);
      currentY += lines.length * 4 + 4;
    }

    this.renderPdfFooter(doc);

    return doc;
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async descargarTransfer(): Promise<void> {
    const t = this.transfer;
    if (!t?.Id_Transfer) return;

    this.activeAction = 'pdf';
    try {
      const doc = this.buildTransferPdfDoc();
      const pdfArrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
      const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
      this.downloadBlob(pdfBlob, `Transfer_${this.transferCodigo}.pdf`);

      this.alerts.successToast('PDF descargado', 'Transfer descargado correctamente.');
    } catch (e) {
      console.error(e);
      this.alerts.errorToast('Error', 'No se pudo generar el PDF.');
    } finally {
      this.activeAction = null;
    }
  }

  close(): void {
    this.uiState.transferId.set(null);
    this.drawer.close();
    this.onClose.emit();
  }

  async descargarComprobante(rutaComprobante: string | null | undefined, index = 1): Promise<void> {
    if (!rutaComprobante) return;

    const nombreArchivo = this.normalizeComprobanteName(rutaComprobante);
    if (!nombreArchivo) return;

    try {
      const blob = await firstValueFrom(this.api.descargarComprobante(nombreArchivo));
      const ext = this.getExtensionFromUrl(nombreArchivo) || this.getExtensionFromMime(blob.type || '') || '.pdf';
      const safeBase = this.transferCodigo || 'Transfer';
      this.downloadBlob(blob, `${safeBase}-comprobante-${index}${ext}`);
    } catch (err) {
      console.error('Error descargando comprobante:', err);
      const fallbackUrl = this.api.getComprobanteUrl(nombreArchivo);
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    }
  }

  tieneComprobante(pago: Pago): boolean {
    if (this.isDirectPayment(pago)) return false;
    return Boolean(pago.Pago_Comprobante);
  }

  async descargarComprobantesTransfer(): Promise<void> {
    const comprobantes = this.comprobantesDisponibles;
    if (!comprobantes.length) {
      this.alerts.warningToast('Sin comprobantes', 'Este transfer no tiene comprobantes asociados.');
      return;
    }

    this.activeAction = 'comprobantes';
    try {
      for (let i = 0; i < comprobantes.length; i += 1) {
        await this.descargarComprobante(comprobantes[i].url || null, i + 1);
      }

      if (comprobantes.length > 1) {
        this.alerts.successToast('Comprobantes descargados', `Se descargaron ${comprobantes.length} comprobantes asociados al transfer.`);
      }
    } finally {
      this.activeAction = null;
    }
  }
}
