// components/reserva/reserva.ts
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectorRef,
  SimpleChanges
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Reservas } from '../../services/Reservas/reservas';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { logoBase64 } from '../../../../public/assets/img/logoBase64';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

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
}

type ResponsableVM = { nombre: string; telefono: string; CanalReserva: string };

@Component({
  selector: 'app-reserva',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reserva.html',
  styleUrls: ['./reserva.css'],
})
export class ReservasDynamicComponent implements OnInit {
  @Input() Id_Reserva!: string;
  @Output() onClose = new EventEmitter<void>();

  isLoading = false;

  reserva: any = null;
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
    private navbar: DynamicIslandGlobalService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Reserva']?.currentValue) {
      this.loadReservaData(changes['Id_Reserva'].currentValue);
    }
  }

  ngOnInit(): void {
    if (this.Id_Reserva) this.loadReservaData(this.Id_Reserva);
  }

  editarReserva() {
    const id = this.reserva?.Id_Reserva;
    if (!id) return;

    this.navbar.Id_Reserva.set(String(id));
    try { this.navbar.closePanel(); } catch {}
    try { this.onClose.emit(); } catch {}
    this.router.navigate([`/Reservas/EditarReserva`, this.reserva.Id_Reserva]);
  }

  get tipoClases() {
    const tipos = [this.pasajeros.adultos, this.pasajeros.ninos, this.pasajeros.infantes]
      .filter(a => a.length > 0).length;
    return { uno: tipos === 1, dos: tipos === 2, tres: tipos === 3 };
  }

  private normalizeApi(data: any) {
    const hasFlat = !!data?.Id_Reserva;
    const base = hasFlat
      ? data
      : {
          ...(data?.reserva || {}),
          Pasajeros: data?.pasajeros || [],
          Pagos: data?.pagos || [],
        };

    const r = {
      Id_Reserva: base.Id_Reserva,
      Estado: base.Estado ?? 'Pendiente',
      NumeroPasajeros: (base.Pasajeros || []).length,
      TourReserva: base.TourReserva ?? base.Nombre_Tour ?? '—',
      PuntoEncuentro: base.PuntoEncuentro ?? base.Nombre_Punto ?? '—',
      FechaReserva: base.FechaReserva ?? base.Fecha_Tour ?? null,
      HoraSalida: base.HoraSalida ?? '—',
      IdiomaReserva: base.IdiomaReserva ?? base.Idioma_Reserva ?? '—',
      Observaciones: base.Observaciones ?? '',
      Reportante: base.Reportante ?? { Nombre: base.Nombre_Reportante, Telefono: base.Telefono_Reportante },
      CanalReserva: base.CanalReserva ?? base.Nombre_Canal ?? '—',
      Pasajeros: base.Pasajeros || [],
      Pagos: base.Pagos || [],
    };

    const adultos = r.Pasajeros.filter((p: any) => (p.TipoPasajero || p.tipoPasajero) === 'Adulto');
    const ninos = r.Pasajeros.filter((p: any) => (p.TipoPasajero || p.tipoPasajero) === 'Niño');
    const infantes = r.Pasajeros.filter((p: any) => (p.TipoPasajero || p.tipoPasajero) === 'Infante');

    const rep = r.Reportante || {};
    const responsable: ResponsableVM = {
      nombre: rep.Nombre ?? rep.nombre ?? '—',
      telefono: rep.Telefono ?? rep.telefono ?? '—',
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
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar la reserva:', err);
        this.isLoading = false;
      },
    });
  }

  private buildReservaPdfDoc(): jsPDF & { lastAutoTable?: any } {
    const r = this.reserva;
    const doc = new jsPDF() as jsPDF & { lastAutoTable?: any };

    doc.addImage(logoBase64, 'PNG', 10, 10, 40, 15);
    doc.setFontSize(18); doc.setTextColor(40, 40, 40);
    doc.text(`Reserva #${r.Id_Reserva}`, 60, 20);
    doc.setFontSize(12); doc.setTextColor(90);
    doc.text(`Estado: ${r.Estado}`, 60, 28);
    doc.line(10, 35, 200, 35);

    let lastY = 40;

    const datos = [
      ['Pasajeros', r.NumeroPasajeros ?? '—'],
      ['Tour', r.TourReserva ?? '—'],
      ['Punto de Encuentro', r.PuntoEncuentro ?? '—'],
      ['Fecha del Tour',
        r.FechaReserva
          ? new Date(r.FechaReserva).toLocaleDateString('es-CO', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
          : '—'
      ],
      ['Hora de Salida', r.HoraSalida ?? '—'],
      ['Idioma', r.IdiomaReserva ?? '—'],
      ['Teléfono', this.responsable.telefono],
    ];

    autoTable(doc, {
      head: [['Datos de la Reserva', '']],
      body: datos,
      startY: lastY,
      theme: 'grid',
      styles: { fontSize: 10 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold' },
    });

    lastY = (doc.lastAutoTable?.finalY ?? 60) + 10;

    const todos: Pasajero[] = [
      ...this.pasajeros.adultos,
      ...this.pasajeros.ninos,
      ...this.pasajeros.infantes,
    ];

    if (todos.length) {
      autoTable(doc, {
        startY: lastY,
        head: [['Nombre', 'Tipo', 'DNI/Pasaporte', 'Teléfono', 'Precio']],
        body: todos.map((p) => [
          p.NombrePasajero || '—',
          p.TipoPasajero || '—',
          p.IdPas || '—',
          p.TelefonoPasajero || '—',
          p.Precio_Pasajero ?? '—',
        ]),
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [52, 73, 94], textColor: 255 },
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


  async descargarArchivoReserva() {
    const r = this.reserva;
    if (!r?.Id_Reserva) return;

    try {
      this.isLoading = true;
      this.cdr.detectChanges();

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
          loading: false
        });
      } else {
        this.navbar.alert.set({
          title: 'PDF descargado',
          message: `Esta reserva genera ${pages} páginas, por eso no se copia imagen. Envía el PDF.`,
          loading: false
        });
      }
    } catch (e) {
      console.error(e);
      this.navbar.alert.set({
        title: 'Error',
        message: 'No se pudo generar el archivo. Revisa consola.',
        loading: false
      });
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  close() {
    this.onClose.emit();
  }
}
