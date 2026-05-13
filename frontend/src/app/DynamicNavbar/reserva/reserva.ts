// components/reserva/reserva.ts
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  ChangeDetectorRef,
  SimpleChanges
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import { Reservas } from '../../services/Reservas/reservas';
import { DuplicarPanelComponent } from '../duplicar-panel/duplicar-panel';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { logoBase64 } from '../../../../public/assets/img/logoBase64';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { PermisosService } from '../../services/Permisos/permisos.service';

// PDF.js
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type TipoPasajero = 'Adulto' | 'Niño' | 'Infante';

interface Pasajero {
  id?: number;
  NombrePasajero: string;
  TipoPasajero: TipoPasajero;
  IdPas?: string;
  TelefonoPasajero?: string;
  Precio_Pasajero?: number | string;
  Comision?: number | string;
  Fecha?: string;
  Confirmacion?: number;
  Id_Punto?: number | string | null;
  Nombre_Punto?: string;
  HoraSalida?: string;
}

type ResponsableVM = { nombre: string; telefono: string; CanalReserva: string };

interface PuntoReservaPdf {
  Id_Punto?: number | string;
  NombrePunto: string;
  HoraSalida?: string;
  Direccion?: string;
  Referencia?: string;
  Ruta?: string;
}

interface ComprobanteReserva {
  id?: number | string;
  Id_Pago?: number | string;
  nombre?: string;
  filename?: string;
  url?: string;
  tipo?: string;
  fecha?: string;
  ruta?: string;
}

interface Reserva {
  Id_Reserva: string;
  Id_Tour?: number | string;
  Estado?: string;
  NumeroPasajeros?: number;
  TotalNeto?: number;
  Pendiente?: number;
  TourReserva?: string;
  PuntoEncuentro?: string;
  FechaReserva?: string | null;
  HoraSalida?: string;
  IdiomaReserva?: string;
  Observaciones?: string;
  Reportante?: { Nombre?: string; Telefono?: string };
  CanalReserva?: string;
  Pasajeros?: Pasajero[];
  Pagos?: any[];
  Puntos?: PuntoReservaPdf[];
  Comprobantes?: ComprobanteReserva[];
}

@Component({
  selector: 'app-reserva',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reserva.html',
  styleUrls: ['./reserva.css'],
})
export class ReservasDynamicComponent implements OnInit, OnChanges {
  @Input() Id_Reserva!: string;
  @Output() onClose = new EventEmitter<void>();

  isLoading = false;

  reserva: Reserva | null = null;
  responsable: ResponsableVM = { nombre: '—', telefono: '—', CanalReserva: '—' };

  pasajeros = {
    adultos: [] as Pasajero[],
    ninos: [] as Pasajero[],
    infantes: [] as Pasajero[],
  };

  constructor(
    private api: Reservas,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private navbar: DynamicIslandGlobalService,
    private permisosService: PermisosService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Reserva']?.currentValue) {
      this.loadReservaData(changes['Id_Reserva'].currentValue);
    }
  }

  ngOnInit(): void {
    if (this.Id_Reserva) this.loadReservaData(this.Id_Reserva);
  }

  get puedeCancelar(): boolean {
    const estado = (this.reserva?.Estado || '').toLowerCase();
    return !!this.reserva?.Id_Reserva && !['cancelada', 'cancelado', 'completada', 'completado'].includes(estado);
  }

  get canDeleteReserva(): boolean {
    return this.permisosService.tienePermiso('RESERVAS.ELIMINAR');
  }

  get estadoNormalizado(): string {
    return String(this.reserva?.Estado || 'pendiente').toLowerCase();
  }

  editarReserva() {
    const id = this.reserva?.Id_Reserva;
    if (!id) return;

    this.navbar.Id_Reserva.set(String(id));
    try { this.navbar.closePanel(); } catch {}
    try { this.onClose.emit(); } catch {}
    this.router.navigate([`/Reservas/EditarReserva`, this.reserva.Id_Reserva]);
  }

  async abrirDuplicarReserva() {
    const reserva = this.reserva;
    if (!reserva?.Id_Reserva) return;

    try {
      const tours = await firstValueFrom(this.api.getTours());
      this.navbar.openPanel({
        id: 'duplicar-reserva',
        component: DuplicarPanelComponent,
        props: {
          tours,
          Id_Tour: reserva.Id_Tour ?? null,
          Fecha_Tour: reserva.FechaReserva ?? null,
          Observaciones: reserva.Observaciones ?? null,
        },
      });
    } catch (error) {
      console.error('No se pudo abrir el panel de duplicado:', error);
      this.navbar.alert.set({
        type: 'error',
        title: 'No se pudo abrir duplicar',
        message: 'No fue posible cargar los tours disponibles. Intenta nuevamente.',
        autoClose: true,
        autoCloseTime: 4000,
      });
    }
  }

  cancelarReserva() {
    const id = this.reserva?.Id_Reserva;
    if (!id) return;
    this.navbar.alert.set({
      type: 'warning',
      title: 'Cancelar reserva',
      message: `¿Deseas cancelar la reserva #${id}? La información se conservará para consulta futura.`,
      autoClose: false,
      buttons: [
        {
          text: 'Cancelar reserva',
          style: 'secondary',
          onClick: () => {
            this.navbar.alert.set(null);
            this.api.cancelarReserva(id).subscribe({
              next: () => {
                this.navbar.alert.set({
                  type: 'success',
                  title: 'Reserva cancelada',
                  message: `La reserva #${id} quedó en estado Cancelada.`,
                  autoClose: true,
                  autoCloseTime: 3000
                });
                this.loadReservaData(id);
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
        },
        {
          text: 'Cerrar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        }
      ]
    });
  }

  eliminarReserva() {
    const id = this.reserva?.Id_Reserva;
    if (!id || !this.canDeleteReserva) return;

    this.navbar.alert.set({
      type: 'warning',
      title: 'Eliminar reserva',
      message: `¿Deseas eliminar la reserva #${id}? Esta acción eliminará el registro de forma permanente.`,
      autoClose: false,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        },
        {
          text: 'Eliminar',
          style: 'delete',
          onClick: () => {
            this.navbar.alert.set(null);
            this.api.deleteReserva(id).subscribe({
              next: () => {
                this.navbar.needsRefresh.set('reservas');
                this.navbar.Id_Reserva.set(null);
                try { this.navbar.closePanel(); } catch {}
                try { this.onClose.emit(); } catch {}
                this.navbar.successToast('Reserva eliminada', `La reserva #${id} fue eliminada correctamente.`);
              },
              error: (err) => {
                this.navbar.alert.set({
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
    });
  }

  get tipoClases() {
    const tipos = [this.pasajeros.adultos, this.pasajeros.ninos, this.pasajeros.infantes]
      .filter(a => a.length > 0).length;
    return { uno: tipos === 1, dos: tipos === 2, tres: tipos === 3 };
  }

  get comprobantesDisponibles(): ComprobanteReserva[] {
    return this.reserva?.Comprobantes || [];
  }

  private normalizarTipoPasajero(tipo: any): TipoPasajero {
    const value = String(tipo ?? '').trim().toUpperCase();
    if (value === 'ADULTO' || value === 'ADULTOS') return 'Adulto';
    if (value === 'NINO' || value === 'NIÑO' || value === 'CHILD') return 'Niño';
    return 'Infante';
  }

  private formatCurrency(value: any): string {
    const n = Number(value || 0);
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(Number.isFinite(n) ? n : 0);
  }

  private formatDate(value: any): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
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

  private extractFileNameFromPath(pathOrUrl: string): string {
    const clean = String(pathOrUrl || '').trim().replace(/\\/g, '/').split('?')[0];
    if (!clean) return '';
    const last = clean.split('/').pop() || '';
    return last || '';
  }

  private resolveFileUrl(pathOrUrl: string): string {
    const value = String(pathOrUrl || '').trim();
    if (!value || value.toUpperCase() === 'N/A') return '';
    if (/^https?:\/\//i.test(value)) return value;

    const fileName = this.extractFileNameFromPath(value);
    if (!fileName) return '';

    const baseUrl = String(this.api.apiUrl || environment.apiUrl || '').replace(/\/$/, '');
    return `${baseUrl}/reservas/comprobante/${encodeURIComponent(fileName)}`;
  }

  private getFileExtensionFromUrl(url: string): string {
    const clean = String(url || '').trim().split('?')[0];
    const ext = clean.includes('.') ? clean.split('.').pop() : '';
    return ext ? `.${ext}` : '';
  }

  private getExtensionFromMime(mime: string): string {
    const value = String(mime || '').toLowerCase();
    if (value.includes('pdf')) return '.pdf';
    if (value.includes('jpeg') || value.includes('jpg')) return '.jpg';
    if (value.includes('png')) return '.png';
    if (value.includes('webp')) return '.webp';
    return '';
  }

  private normalizePuntosReserva(base: any): PuntoReservaPdf[] {
    const raw =
      base?.Puntos ||
      base?.puntos ||
      base?.PuntosEncuentro ||
      base?.puntosEncuentro ||
      [];

    if (Array.isArray(raw) && raw.length) {
      return raw.map((p: any) => ({
        Id_Punto: p.Id_Punto ?? p.id ?? p.IdPunto,
        NombrePunto: p.NombrePunto ?? p.PuntoEncuentro ?? p.Nombre_Punto ?? p.nombre ?? '—',
        HoraSalida: p.HoraSalida ?? p.Hora_Salida ?? p.hora ?? '—',
        Direccion: p.Direccion ?? p.direccion ?? '',
        Referencia: p.Referencia ?? p.referencia ?? '',
        Ruta: p.ruta ?? p.Ruta ?? '',
      }));
    }

    const fromPassengers = new Map<string, PuntoReservaPdf>();

    for (const p of base?.Pasajeros || []) {
      const idPunto = p?.Id_Punto ?? p?.IdPunto ?? null;
      const nombre = p?.Nombre_Punto ?? p?.NombrePunto ?? p?.PuntoEncuentro ?? '';
      const hora = p?.HoraSalida ?? p?.Hora_Salida ?? base?.HoraSalida ?? '—';

      if (!nombre && idPunto == null) continue;

      const key = `${idPunto ?? nombre}|${hora}`;
      if (!fromPassengers.has(key)) {
        fromPassengers.set(key, {
          Id_Punto: idPunto ?? undefined,
          NombrePunto: nombre || '—',
          HoraSalida: hora || '—',
          Direccion: p?.Direccion ?? '',
          Referencia: p?.Referencia ?? '',
          Ruta: p?.Ruta ?? p?.ruta ?? '',
        });
      }
    }

    if (fromPassengers.size) {
      return [...fromPassengers.values()];
    }

    return [{
      Id_Punto: base?.Id_Punto ?? base?.IdPunto ?? null,
      NombrePunto: base?.PuntoEncuentro ?? base?.Nombre_Punto ?? '—',
      HoraSalida: base?.HoraSalida ?? '—',
      Direccion: base?.Direccion ?? '',
      Referencia: base?.Referencia ?? '',
      Ruta: base?.Ruta ?? base?.ruta ?? '',
    }];
  }

  private normalizeComprobantes(base: any): ComprobanteReserva[] {
    const pagos = base?.Pagos || base?.pagos || [];
    const comprobantes: ComprobanteReserva[] = [];

    for (const pago of pagos) {
      const rawPath =
        pago?.Ruta_Comprobante ||
        pago?.SoporteUrl ||
        pago?.Comprobante ||
        pago?.ComprobantePago ||
        pago?.UrlComprobante ||
        pago?.url ||
        pago?.Archivo ||
        pago?.archivo;

      const url = this.resolveFileUrl(rawPath);
      const filename = this.extractFileNameFromPath(rawPath || url) || pago?.NombreArchivo || pago?.filename || '';

      if (!rawPath || String(rawPath).trim().toUpperCase() === 'N/A') continue;

      comprobantes.push({
        id: pago?.Id_Pago ?? pago?.id,
        Id_Pago: pago?.Id_Pago ?? pago?.id,
        nombre: pago?.NombreArchivo ?? pago?.filename ?? filename ?? `comprobante-${comprobantes.length + 1}`,
        filename,
        url,
        tipo: pago?.Tipo ?? pago?.TipoPago ?? pago?.FormaPago ?? pago?.tipo,
        fecha: pago?.Fecha_Pago ?? pago?.FechaPago ?? pago?.fecha,
        ruta: String(rawPath || ''),
      });
    }

    return comprobantes;
  }

  private normalizeApi(data: any) {
    const payload = data?.data ?? data?.reserva ?? data;
    const base = payload?.Id_Reserva
      ? payload
      : {
          ...(payload || {}),
          Pasajeros: payload?.Pasajeros || payload?.pasajeros || [],
          Pagos: payload?.Pagos || payload?.pagos || [],
        };

    const pasajeros: Pasajero[] = (base.Pasajeros || []).map((p: any) => ({
      id: p.id ?? p.Id_Pasajero,
      NombrePasajero: p.NombrePasajero ?? p.Nombre_Pasajero ?? '—',
      TipoPasajero: this.normalizarTipoPasajero(p.TipoPasajero ?? p.Tipo_Pasajero),
      IdPas: p.IdPas ?? p.DNI ?? '',
      TelefonoPasajero: p.TelefonoPasajero ?? p.Telefono_Pasajero ?? '',
      Precio_Pasajero: p.Precio_Pasajero ?? 0,
      Comision: p.Comision ?? 0,
      Fecha: p.Fecha ?? base.FechaReserva ?? base.Fecha_Tour ?? '',
      Confirmacion: Number(p.Confirmacion ?? 0),
      Id_Punto: p.Id_Punto ?? p.IdPunto ?? null,
      Nombre_Punto: p.Nombre_Punto ?? p.NombrePunto ?? p.PuntoEncuentro ?? '',
      HoraSalida: p.HoraSalida ?? p.Hora_Salida ?? '',
    }));

    const totalNeto = base.TotalNeto != null ? Number(base.TotalNeto) : undefined;
    const pendiente = base.Pendiente != null ? Number(base.Pendiente) : undefined;
    const puntos = this.normalizePuntosReserva({ ...base, Pasajeros: pasajeros });
    const comprobantes = this.normalizeComprobantes({ ...base, Pagos: base.Pagos || [] });

    const r: Reserva = {
      Id_Reserva: String(base.Id_Reserva ?? ''),
      Id_Tour: base.Id_Tour ?? base.idTour ?? null,
      Estado: base.Estado ?? 'Pendiente',
      NumeroPasajeros: pasajeros.length,
      TotalNeto: totalNeto,
      Pendiente: pendiente,
      TourReserva: base.TourReserva ?? base.Nombre_Tour ?? '—',
      PuntoEncuentro: base.PuntoEncuentro ?? base.Nombre_Punto ?? puntos[0]?.NombrePunto ?? '—',
      FechaReserva: base.FechaReserva ?? base.Fecha_Tour ?? null,
      HoraSalida: base.HoraSalida ?? puntos[0]?.HoraSalida ?? '—',
      IdiomaReserva: base.IdiomaReserva ?? base.Idioma_Reserva ?? '—',
      Observaciones: base.Observaciones ?? '',
      Reportante: base.Reportante ?? { Nombre: base.Nombre_Reportante, Telefono: base.Telefono_Reportante },
      CanalReserva: base.CanalReserva ?? base.Nombre_Canal ?? '—',
      Pasajeros: pasajeros,
      Pagos: base.Pagos || [],
      Puntos: puntos,
      Comprobantes: comprobantes,
    };

    const adultos = pasajeros.filter((p) => p.TipoPasajero === 'Adulto');
    const ninos = pasajeros.filter((p) => p.TipoPasajero === 'Niño');
    const infantes = pasajeros.filter((p) => p.TipoPasajero === 'Infante');

    const rep = r.Reportante || {};
    const responsable: ResponsableVM = {
      nombre: rep.Nombre ?? '—',
      telefono: rep.Telefono ?? '—',
      CanalReserva: r.CanalReserva ?? '—',
    };

    return { r, adultos, ninos, infantes, responsable };
  }

  loadReservaData(id: string) {
    this.isLoading = true;
    this.api.getReserva(id).subscribe({
      next: (data) => {
        const { r, adultos, ninos, infantes, responsable } = this.normalizeApi(data);
        this.reserva = r;
        this.pasajeros.adultos = adultos;
        this.pasajeros.ninos = ninos;
        this.pasajeros.infantes = infantes;
        this.responsable = responsable;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error al cargar la reserva:', err);
        this.isLoading = false;
        this.navbar.alert.set({
          type: 'error',
          title: 'No se pudo cargar la reserva',
          message: err?.error?.message || err?.error?.error || err?.message || 'Intenta nuevamente.',
          autoClose: true,
          autoCloseTime: 4000
        });
        this.cdr.markForCheck();
      },
    });
  }

  private getPassengerPointInfo(p: Pasajero): PuntoReservaPdf | null {
    const idPunto = p.Id_Punto != null ? String(p.Id_Punto) : '';
    const byId = this.reserva?.Puntos?.find((pto) => {
      if (pto.Id_Punto == null) return false;
      return String(pto.Id_Punto) === idPunto;
    });

    if (byId) return byId;

    if (p.Nombre_Punto || p.HoraSalida) {
      return {
        Id_Punto: p.Id_Punto ?? null,
        NombrePunto: p.Nombre_Punto || '—',
        HoraSalida: p.HoraSalida || this.reserva?.HoraSalida || '—',
      };
    }

    return null;
  }

  private renderPdfFooter(doc: jsPDF & { lastAutoTable?: any }) {
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
      doc.text('Este documento confirma los datos registrados de la reserva. Ante cualquier duda, comunícate con Maxitours.', 10, pageHeight - 10, { maxWidth: pageWidth - 20 });
      doc.text(`Generado por SIR | ${fechaGeneracion}`, 10, pageHeight - 5);
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - 10, pageHeight - 5, { align: 'right' });
    }
  }

  private buildReservaPdfDoc(): jsPDF & { lastAutoTable?: any } {
    const r = this.reserva;
    const doc = new jsPDF() as jsPDF & { lastAutoTable?: any };

    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 12;

    doc.addImage(logoBase64, 'PNG', 10, 10, 36, 14);
    doc.setFontSize(18);
    doc.setTextColor(35, 35, 35);
    doc.text('Confirmación de Reserva', 50, 18);
    doc.setFontSize(11);
    doc.setTextColor(90, 90, 90);
    doc.text(`Reserva #${r?.Id_Reserva || '—'}`, 50, 25);
    doc.text(`Generada: ${this.formatDate(new Date())}`, 50, 31);
    doc.line(10, 36, pageWidth - 10, 36);

    y = 42;

    y = this.ensurePdfSpace(doc, y, 36);
    doc.setFontSize(12);
    doc.setTextColor(35, 35, 35);
    doc.text('Información de la reserva', 10, y);
    y += 3;

    autoTable(doc, {
      startY: y + 2,
      margin: { left: 10, right: 10 },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
      head: [['Campo', 'Detalle']],
      body: [
        ['Reserva', r?.Id_Reserva || '—'],
        ['Tour', r?.TourReserva || '—'],
        ['Fecha del tour', this.formatDate(r?.FechaReserva)],
        ['Idioma', r?.IdiomaReserva || '—'],
        ['Pasajeros', String(r?.NumeroPasajeros ?? 0)],
        ['Teléfono de contacto', this.responsable?.telefono || r?.Reportante?.Telefono || '—'],
      ],
    });

    y = (doc.lastAutoTable?.finalY ?? y) + 8;

    const puntos = this.reserva?.Puntos || [];
    if (puntos.length) {
      y = this.ensurePdfSpace(doc, y, 40);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Puntos de encuentro y horarios', 10, y);
      y += 3;

      autoTable(doc, {
        startY: y + 2,
        margin: { left: 10, right: 10 },
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
        headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
        head: [[
          'Punto de encuentro',
          'Hora de salida',
          'Dirección / referencia',
          'Ruta',
        ]],
        body: puntos.map((pto) => [
          pto.NombrePunto || '—',
          pto.HoraSalida || '—',
          [pto.Direccion, pto.Referencia].filter(Boolean).join(' · ') || '—',
          pto.Ruta || '—',
        ]),
      });

      y = (doc.lastAutoTable?.finalY ?? y) + 8;
    }

    const todos: Pasajero[] = [
      ...this.pasajeros.adultos,
      ...this.pasajeros.ninos,
      ...this.pasajeros.infantes,
    ];

    if (todos.length) {
      y = this.ensurePdfSpace(doc, y, 48);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Pasajeros', 10, y);
      y += 3;

      autoTable(doc, {
        startY: y + 2,
        margin: { left: 10, right: 10 },
        theme: 'striped',
        styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
        headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
        head: [[
          'Nombre',
          'Tipo',
          'DNI / Pasaporte',
          'Teléfono',
          'Punto',
          'Hora',
          'Precio',
        ]],
        body: todos.map((p) => {
          const punto = this.getPassengerPointInfo(p);
          return [
            p.NombrePasajero || '—',
            p.TipoPasajero || '—',
            p.IdPas || '—',
            p.TelefonoPasajero || '—',
            punto?.NombrePunto || p.Nombre_Punto || r?.PuntoEncuentro || '—',
            punto?.HoraSalida || p.HoraSalida || r?.HoraSalida || '—',
            this.formatCurrency(p.Precio_Pasajero),
          ];
        }),
      });

      y = (doc.lastAutoTable?.finalY ?? y) + 8;
    }

    y = this.ensurePdfSpace(doc, y, 40);
    doc.setFontSize(12);
    doc.setTextColor(35, 35, 35);
    doc.text('Estado de pago', 10, y);
    y += 3;

    const totalNeto = Number(r?.TotalNeto ?? 0);
    const pendiente = Number(r?.Pendiente ?? 0);
    const pagado = Math.max(0, totalNeto - pendiente);
    const estadoPago = pendiente <= 0 && totalNeto > 0
      ? 'Pagado'
      : pagado > 0 && pendiente > 0
        ? 'Parcial'
        : totalNeto > 0
          ? 'Pendiente'
          : '—';

    autoTable(doc, {
      startY: y + 2,
      margin: { left: 10, right: 10 },
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
      head: [['Concepto', 'Valor']],
      body: [
        ['Total', this.formatCurrency(totalNeto)],
        ['Pagado', this.formatCurrency(pagado)],
        ['Pendiente', this.formatCurrency(pendiente)],
        ['Estado de pago', estadoPago],
      ],
    });

    y = (doc.lastAutoTable?.finalY ?? y) + 8;

    const pagos = this.reserva?.Pagos || [];
    if (pagos.length) {
      y = this.ensurePdfSpace(doc, y, 36);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Abonos y comprobantes', 10, y);
      y += 3;

      autoTable(doc, {
        startY: y + 2,
        margin: { left: 10, right: 10 },
        theme: 'grid',
        styles: { fontSize: 8.4, cellPadding: 2, valign: 'top' },
        headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
        head: [[
          'Fecha',
          'Método / tipo',
          'Valor',
          'Comprobante',
        ]],
        body: pagos.map((p: any) => [
          this.formatDate(p.Fecha_Pago || p.Fecha || p.fecha),
          p.Tipo || p.TipoPago || p.FormaPago || '—',
          this.formatCurrency(p.Monto ?? p.monto ?? 0),
          p.Ruta_Comprobante || p.SoporteUrl ? 'Sí' : 'No',
        ]),
      });

      y = (doc.lastAutoTable?.finalY ?? y) + 8;
    }

    if (r?.Observaciones) {
      y = this.ensurePdfSpace(doc, y, 28);
      doc.setFontSize(12);
      doc.setTextColor(35, 35, 35);
      doc.text('Observaciones', 10, y);
      y += 4;

      doc.setFontSize(9.5);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(String(r.Observaciones), pageWidth - 20);
      doc.text(lines, 10, y);
      y += lines.length * 4 + 4;
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

  private async copyImageToClipboard(blob: Blob): Promise<boolean> {
    try {
      const navAny = navigator as any;
      if (!navAny.clipboard?.write || typeof (window as any).ClipboardItem === 'undefined') return false;
      const item = new (window as any).ClipboardItem({ 'image/png': blob });
      await navAny.clipboard.write([item]);
      return true;
    } catch {
      return false;
    }
  }

  private ensurePdfJsWorker() {
    // @ts-ignore
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // @ts-ignore
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url
      ).toString();
    }
  }

  private async getPdfPageCount(pdfArrayBuffer: ArrayBuffer): Promise<number> {
    this.ensurePdfJsWorker();
    const data = new Uint8Array(pdfArrayBuffer.slice(0));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf: PDFDocumentProxy = await loadingTask.promise;
    return pdf.numPages;
  }

  private async pdfFirstPageToPngBlob(pdfArrayBuffer: ArrayBuffer, scale = 2): Promise<Blob> {
    this.ensurePdfJsWorker();

    const data = new Uint8Array(pdfArrayBuffer.slice(0));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf: PDFDocumentProxy = await loadingTask.promise;

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({ canvas, viewport } as any).promise;

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar PNG'))), 'image/png');
    });

    return blob;
  }

  async descargarComprobantesReserva(): Promise<void> {
    const comprobantes = this.comprobantesDisponibles;

    if (!comprobantes.length) {
      this.navbar.alert.set({
        type: 'warning',
        title: 'Sin comprobantes',
        message: 'Esta reserva no tiene comprobantes asociados.',
        autoClose: true,
        autoCloseTime: 3000
      });
      return;
    }

    let descargados = 0;
    for (let i = 0; i < comprobantes.length; i++) {
      const ok = await this.descargarComprobante(comprobantes[i], i + 1, { silent: true });
      if (ok) descargados++;
    }

    this.navbar.alert.set({
      type: descargados === comprobantes.length ? 'success' : 'warning',
      title: descargados === comprobantes.length ? 'Comprobantes descargados' : 'Descarga parcial',
      message: descargados === comprobantes.length
        ? `Se descargaron ${descargados} comprobantes de la reserva.`
        : `Se procesaron ${descargados} de ${comprobantes.length} comprobantes.`,
      autoClose: true,
      autoCloseTime: 3500
    });
  }

  private async descargarComprobante(
    comprobante: ComprobanteReserva,
    index: number,
    options?: { silent?: boolean }
  ): Promise<boolean> {
    const idReserva = this.reserva?.Id_Reserva;
    const rawName = comprobante.filename || this.extractFileNameFromPath(comprobante.url || comprobante.ruta || '') || '';
    const archivo = rawName || `comprobante-${index}`;

    try {
      const blob = await firstValueFrom(this.api.descargarComprobanteSeguro(archivo));
      const ext = this.getFileExtensionFromUrl(archivo) || this.getExtensionFromMime(blob.type) || '.bin';
      const filename = `reserva-${idReserva || 'archivo'}-comprobante-${index}${ext}`;
      this.downloadBlob(blob, filename);
      return true;
    } catch (error) {
      const fallbackUrl = comprobante.url || this.resolveFileUrl(comprobante.ruta || archivo);
      if (fallbackUrl) {
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
        return true;
      }

      if (!options?.silent) {
        this.navbar.alert.set({
          type: 'error',
          title: 'Error descargando comprobante',
          message: 'No fue posible descargar uno de los comprobantes asociados.',
          autoClose: true,
          autoCloseTime: 4000
        });
      }

      return false;
    }
  }


  async descargarArchivoReserva() {
    const r = this.reserva;
    if (!r?.Id_Reserva) return;

    try {
      this.isLoading = true;
      this.cdr.markForCheck();

      const doc = this.buildReservaPdfDoc();

      // 1) SIEMPRE descargar PDF (UNA descarga por click)
      const pdfArrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
      const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
      this.downloadBlob(pdfBlob, `reserva-${r.Id_Reserva}.pdf`);

      // 2) Si es 1 página, copia imagen (NO descarga PNG)
      const pages = await this.getPdfPageCount(pdfArrayBuffer);

      if (pages === 1) {
        const pngBlob = await this.pdfFirstPageToPngBlob(pdfArrayBuffer, 2);
        const copied = await this.copyImageToClipboard(pngBlob);

        this.navbar.alert.set({
          title: copied ? 'Imagen copiada' : 'PDF descargado',
          message: copied
            ? 'Imagen de la reserva copiada al portapapeles.'
            : 'No se pudo copiar la imagen en este navegador. Usa el PDF que ya se descargó.',
            autoClose: true,
            autoCloseTime: 4000
        });
      } else {
        this.navbar.alert.set({
          title: 'PDF descargado',
          message: `Esta reserva genera ${pages} páginas, por eso no se copia imagen. Envía el PDF.`,
          autoClose: true,
          autoCloseTime: 4000
        });
      }
    } catch (e) {
      console.error(e);
      this.navbar.alert.set({
        type: 'error',
        title: 'Error',
        message: 'No se pudo generar el archivo. Revisa consola.',
        autoClose: true,
      });
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  close() {
    this.onClose.emit();
  }
}
