import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { TransferService } from '../../services/Transfers/transfers';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { PermisosService } from '../../services/Permisos/permisos.service';

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
  imports: [CommonModule, RouterLink],
  templateUrl: './transfer.html',
  styleUrls: ['./transfer.css']
})
export class TransferDynamicComponent implements OnInit, OnChanges {
  @Input() Id_Transfer!: string | number;
  @Output() onClose = new EventEmitter<void>();

  private readonly datePipe = new DatePipe('es-CO');

  isLoading = true;
  isError = false;
  errorMessage = '';

  data: TransferDetalle | null = null;

  constructor(
    private api: TransferService,
    private cdr: ChangeDetectorRef,
    private navbar: DynamicIslandGlobalService,
    private permisosService: PermisosService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Transfer']?.currentValue) {
      this.loadTransferData(changes['Id_Transfer'].currentValue);
    }
  }

  ngOnInit(): void {
    if (this.Id_Transfer) {
      this.loadTransferData(this.Id_Transfer);
    }
  }

  private loadTransferData(id: string | number): void {
    this.isLoading = true;
    this.isError = false;
    this.errorMessage = '';
    this.data = null;

    this.api.getTransfer(id).subscribe({
      next: (response: any) => {
        this.data = response?.data || response;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        console.error('Error loading transfer:', err);
        this.isError = true;
        this.errorMessage = 'No se pudo cargar el detalle del transfer.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
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
    const estado = (this.transfer.Estado || '').toLowerCase();
    return !!this.transfer.Id_Transfer && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
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

    this.navbar.showConfirm(
      'Cancelar transfer',
      `¿Cancelar el transfer #${this.transferCodigo}? La información se conservará para consulta futura.`,
      [
        {
          text: 'Mantener',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        },
        {
          text: 'Cancelar transfer',
          style: 'primary',
          onClick: () => {
            this.navbar.clearOverlay();
            this.api.cancelarTransfer(id).subscribe({
              next: () => {
                this.navbar.showAlert({
                  type: 'success',
                  title: 'Transfer cancelado',
                  message: `El transfer #${this.transferCodigo} quedó en estado Cancelado.`,
                  autoClose: true,
                  autoCloseTime: 3000
                });
                this.loadTransferData(id);
              },
              error: (err) => {
                this.navbar.showAlert({
                  type: 'error',
                  title: 'No se pudo cancelar',
                  message: err?.error?.message || err?.error?.error || err?.message || 'Intenta nuevamente.',
                  autoClose: true,
                  autoCloseTime: 4000
                });
              }
            });
          }
        }
      ]
    );
  }

  eliminarTransfer(): void {
    const id = this.transfer.Id_Transfer || this.Id_Transfer;
    if (!id || !this.canDeleteTransfer) return;

    this.navbar.showConfirm(
      'Eliminar transfer',
      `¿Deseas eliminar el transfer #${this.transferCodigo}? Esta acción eliminará el registro de forma permanente.`,
      [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.clearOverlay()
        },
        {
          text: 'Eliminar',
          style: 'delete',
          onClick: () => {
            this.navbar.clearOverlay();
            this.api.deleteTransfer(id).subscribe({
              next: () => {
                this.navbar.needsRefresh.set('transfers');
                this.navbar.Id_Transfer.set(null);
                this.close();
                this.navbar.successToast('Transfer eliminado', `El transfer #${this.transferCodigo} fue eliminado correctamente.`);
              },
              error: (err) => {
                this.navbar.showAlert({
                  type: 'error',
                  title: 'No se pudo eliminar',
                  message: err?.error?.message || err?.error?.error || err?.message || 'Intenta nuevamente.',
                  autoClose: true,
                  autoCloseTime: 4000
                });
              }
            });
          }
        }
      ]
    );
  }

  get valorTotal(): number {
    return Number(this.transfer.Valor || 0);
  }

  get totalPagado(): number {
    return this.pagos
      .filter(p => p.Estado === 'Pagado' && !(p.Metodo === 'Paga en punto' && Number(p.Monto) === 0))
      .reduce((sum, p) => sum + Number(p.Monto || 0), 0);
  }

  get saldoPendiente(): number {
    return Math.max(0, this.valorTotal - this.totalPagado);
  }

  get porcentajePagado(): number {
    return this.valorTotal > 0 ? (this.totalPagado / this.valorTotal) * 100 : 0;
  }

  get estadoNormalizado(): string {
    return (this.transfer.Estado || 'Pendiente').toLowerCase();
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
      })).filter(c => Boolean(c.url));
    }

    return this.pagos
      .map((pago, index) => this.normalizeComprobanteFromPago(pago, index))
      .filter((item): item is ComprobanteTransfer => Boolean(item?.url));
  }

  private buildTransferPdfDoc(): jsPDF & { lastAutoTable?: any } {
    const t = this.transfer;
    const doc = new jsPDF() as jsPDF & { lastAutoTable?: any };

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    doc.addImage(logoBase64, 'PNG', 10, 10, 40, 15);
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('Confirmacion de Transfer', 58, 18);
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(`Transfer ${this.transferCodigo}`, 58, 25);
    doc.text(`Generado: ${this.formatDate(new Date())}`, 58, 31);
    doc.line(10, 37, pageWidth - 10, 37);

    let currentY = 42;

    const infoRows = [
      ['Transfer', this.transferCodigo],
      ['Tour', t.Nombre_Servicio || '—'],
      ['Fecha del servicio', this.formatDate(t.Fecha_Transfer)],
      ['Idioma', (t as any).Idioma || '—'],
      ['Titular', t.Nombre_Titular || '—'],
      ['Teléfono de contacto', t.Telefono_Titular || '—']
    ];

    currentY = this.ensurePdfSpace(doc, currentY, 50);
    autoTable(doc, {
      head: [['Campo', 'Detalle']],
      body: infoRows,
      startY: currentY,
      theme: 'grid',
      styles: { fontSize: 9.5, cellPadding: 2 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
      margin: { left: 10, right: 10 }
    });

    currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;

    const pagosRows = [
      ['Valor total', this.formatCurrency(t.Valor || 0)],
      ['Pagado', this.formatCurrency(this.totalPagado)],
      ['Pendiente', this.formatCurrency(this.saldoPendiente)],
      ['Tipo de pago', this.pagos.length === 0
        ? 'Paga en punto'
        : this.pagos.length === 1 && this.pagos[0].Metodo === 'Completo'
          ? 'Ya pagó'
          : 'Abonos']
    ];

    currentY = this.ensurePdfSpace(doc, currentY, 36);
    autoTable(doc, {
      head: [['Campo', 'Detalle']],
      body: pagosRows,
      startY: currentY,
      theme: 'grid',
      styles: { fontSize: 9.5, cellPadding: 2 },
      headStyles: { fillColor: [155, 89, 182], textColor: 255, fontStyle: 'bold' },
      margin: { left: 10, right: 10 }
    });

    currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;

    if (this.pagos.length > 0) {
      const pagosBody = this.pagos.map((p) => [
        p.Metodo || '—',
        this.formatCurrency(p.Monto),
        this.formatDate(p.Fecha_Pago),
        p.Estado || '—',
        p.Observaciones || '—',
        p.Pago_Comprobante ? 'Sí' : 'No'
      ]);

      currentY = this.ensurePdfSpace(doc, currentY, 40);
      autoTable(doc, {
        head: [['Tipo', 'Monto', 'Fecha', 'Estado', 'Observaciones', 'Comprobante']],
        body: pagosBody,
        startY: currentY,
        theme: 'striped',
        styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
        headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 26 },
          2: { cellWidth: 30 },
          3: { cellWidth: 22 },
          4: { cellWidth: 50 },
          5: { cellWidth: 18 }
        },
        margin: { left: 10, right: 10 }
      });

      currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;
    }

    const comprobantes = this.comprobantesDisponibles;
    if (comprobantes.length > 0) {
      currentY = this.ensurePdfSpace(doc, currentY, 32);
      autoTable(doc, {
        head: [['Comprobante', 'Fecha', 'Estado']],
        body: comprobantes.map((c) => [
          c.tipo || 'Comprobante',
          this.formatDate(c.fecha),
          'Disponible'
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { fontSize: 8.8, cellPadding: 2 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 55 },
          2: { cellWidth: 35 }
        },
        margin: { left: 10, right: 10 }
      });
      currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;
    }

    if (t.Observaciones) {
      currentY = this.ensurePdfSpace(doc, currentY, 28);
      autoTable(doc, {
        head: [['Observaciones']],
        body: [[t.Observaciones]],
        startY: currentY,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [189, 195, 199], textColor: 15, fontStyle: 'bold' },
        margin: { left: 10, right: 10 }
      });
      currentY = (doc.lastAutoTable?.finalY ?? currentY) + 8;
    }

    if (currentY + 12 > pageHeight - 15) {
      doc.addPage();
      currentY = 18;
    }

    const footerText = 'Este documento confirma los datos registrados del transfer. Ante cualquier duda, comunicate con Maxitours.';
    doc.setFontSize(8.5);
    doc.setTextColor(107, 114, 128);
    const footerLines = doc.splitTextToSize(footerText, pageWidth - 20);
    doc.text(footerLines, 10, Math.min(pageHeight - 14, currentY + 10));
    doc.text(`SIR - Sistema Integrado de Transfers | ${this.formatDate(new Date())}`, 10, pageHeight - 8);

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

    try {
      const doc = this.buildTransferPdfDoc();
      const pdfArrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
      const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
      this.downloadBlob(pdfBlob, `Transfer_${this.transferCodigo}.pdf`);

      this.navbar.showAlert({
        title: 'PDF descargado',
        message: 'Transfer descargado correctamente.',
        autoClose: true,
        autoCloseTime: 3000
      });
    } catch (e) {
      console.error(e);
      this.navbar.errorToast('Error', 'No se pudo generar el PDF.');
    }
  }

  close(): void {
    this.navbar.Id_Transfer.set(null);
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
    return Boolean(pago.Pago_Comprobante);
  }

  async descargarComprobantesTransfer(): Promise<void> {
    const comprobantes = this.comprobantesDisponibles;
    if (!comprobantes.length) {
      this.navbar.showAlert({
        type: 'warning',
        title: 'Sin comprobantes',
        message: 'Este transfer no tiene comprobantes asociados.',
        autoClose: true,
        autoCloseTime: 3000
      });
      return;
    }

    for (let i = 0; i < comprobantes.length; i += 1) {
      await this.descargarComprobante(comprobantes[i].url || null, i + 1);
    }

    if (comprobantes.length > 1) {
      this.navbar.showAlert({
        type: 'success',
        title: 'Comprobantes descargados',
        message: `Se descargaron ${comprobantes.length} comprobantes asociados al transfer.`,
        autoClose: true,
        autoCloseTime: 3000
      });
    }
  }
}
