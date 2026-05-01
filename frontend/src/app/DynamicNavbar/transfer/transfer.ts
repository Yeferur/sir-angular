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
import { CommonModule } from '@angular/common';
import { TransferService } from '../../services/Transfers/transfers';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

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

interface TransferDetalle {
  transfer: Transfer;
  pagos: Pago[];
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

  isLoading = true;
  isError = false;
  errorMessage = '';

  data: TransferDetalle | null = null;

  constructor(
    private api: TransferService,
    private cdr: ChangeDetectorRef,
    private navbar: DynamicIslandGlobalService
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

  get puedeCancelar(): boolean {
    const estado = (this.transfer.Estado || '').toLowerCase();
    return !!this.transfer.Id_Transfer && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
  }

  cancelarTransfer(): void {
    const id = this.transfer.Id_Transfer || this.Id_Transfer;
    if (!id) return;
    const confirmed = window.confirm(`Cancelar el transfer #${this.transferCodigo}? La información se conservará para consulta futura.`);
    if (!confirmed) return;

    this.api.cancelarTransfer(id).subscribe({
      next: () => {
        this.navbar.alert.set({
          type: 'success',
          title: 'Transfer cancelado',
          message: `El transfer #${this.transferCodigo} quedó en estado Cancelado.`,
          autoClose: true,
          autoCloseTime: 3000
        });
        this.loadTransferData(id);
      },
      error: (err) => {
        this.navbar.alert.set({
          type: 'error',
          title: 'No se pudo cancelar',
          message: err?.error?.message || err?.message || 'Intenta nuevamente.',
          autoClose: true,
          autoCloseTime: 4000
        });
      }
    });
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

  private buildTransferPdfDoc(): jsPDF & { lastAutoTable?: any } {
    const t = this.transfer;
    const doc = new jsPDF() as jsPDF & { lastAutoTable?: any };

    doc.addImage(logoBase64, 'PNG', 10, 10, 40, 15);
    doc.setFontSize(18); doc.setTextColor(40, 40, 40);
    doc.text(`Transfer #${this.transferCodigo}`, 60, 20);
    doc.setFontSize(12); doc.setTextColor(90);
    doc.text(`Estado: ${t.Estado || 'Pendiente'}`, 60, 28);
    doc.line(10, 35, 200, 35);

    let lastY = 40;

    const detallesServicio = [
      ['Titular', t.Nombre_Titular || '—'],
      ['DNI', t.DNI || '—'],
      ['Teléfono Titular', t.Telefono_Titular || '—'],
      ['Servicio', t.Nombre_Servicio || '—'],
      ['Rango', t.RangoDescripcion || '—'],
      ['Punto de Salida', t.Punto_Salida || '—'],
      ['Punto de Llegada', t.Punto_Destino || '—'],
      ['Fecha', t.Fecha_Transfer || '—'],
      ['Hora de Recogida', t.Hora_Recogida || '—'],
    ];

    if (t.Vuelo) detallesServicio.push(['Vuelo', t.Vuelo]);
    if (t.TipoVuelo) detallesServicio.push(['Tipo de Vuelo', t.TipoVuelo]);

    autoTable(doc, {
      head: [['Detalles del Servicio', '']],
      body: detallesServicio,
      startY: lastY,
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
    });

    lastY = (doc.lastAutoTable?.finalY ?? 60) + 10;

    const responsable = [
      ['Reportante', t.Nombre_Reportante || '—'],
      ['Teléfono Reportante', t.Telefono_Reportante || '—'],
    ];

    autoTable(doc, {
      head: [['Responsable', '']],
      body: responsable,
      startY: lastY,
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
    });

    lastY = (doc.lastAutoTable?.finalY ?? 60) + 10;

    const valor = [
      ['Valor Total', `${t.MonedaCodigo || 'COP'} ${this.valorTotal}`],
      ['Total Pagado', `${t.MonedaCodigo || 'COP'} ${this.totalPagado}`],
      ['Saldo Pendiente', `${t.MonedaCodigo || 'COP'} ${this.saldoPendiente}`],
    ];

    autoTable(doc, {
      head: [['Pago', '']],
      body: valor,
      startY: lastY,
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [155, 89, 182], textColor: 255, fontStyle: 'bold' },
    });

    if (this.pagos.length > 0) {
      lastY = (doc.lastAutoTable?.finalY ?? 60) + 10;
      const pagosBody = this.pagos.map(p => [
        p.Metodo || '—',
        `${t.MonedaCodigo || 'COP'} ${p.Monto}`,
        p.Fecha_Pago || '—',
        p.Estado || '—',
        p.Observaciones || '—',
        p.Pago_Comprobante ? 'Sí' : 'No'
      ]);

      autoTable(doc, {
        head: [['Método', 'Monto', 'Fecha', 'Estado', 'Observaciones', 'Comprobante']],
        body: pagosBody,
        startY: lastY,
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [44, 62, 80], textColor: 255 },
      });
    }

    if (t.Observaciones) {
      lastY = (doc.lastAutoTable?.finalY ?? 60) + 10;
      autoTable(doc, {
        head: [['Observaciones']],
        body: [[t.Observaciones]],
        startY: lastY,
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [189, 195, 199], textColor: 255 },
      });
    }

    const fecha = new Date().toLocaleDateString('es-CO');
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Generado por SIR – Sistema Integrado de Reservas | ${fecha}`, 10, 290);

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

  descargarTransfer(): void {
    const t = this.transfer;
    if (!t?.Id_Transfer) return;

    try {
      const doc = this.buildTransferPdfDoc();
      const pdfArrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
      const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
      this.downloadBlob(pdfBlob, `Transfer_${this.transferCodigo}.pdf`);

      this.navbar.alert.set({
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

  descargarComprobante(rutaComprobante: string | null | undefined): void {
    if (!rutaComprobante) return;

    const nombreArchivo = rutaComprobante.split('/').pop();
    if (!nombreArchivo) return;

    this.api.descargarComprobante(nombreArchivo).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nombreArchivo;
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => {
        console.error('Error descargando comprobante:', err);
      }
    });
  }

  tieneComprobante(pago: Pago): boolean {
    return Boolean(pago.Pago_Comprobante);
  }
}
