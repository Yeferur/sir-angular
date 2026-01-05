// components/reserva/reserva.ts
import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectorRef, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Reservas } from '../../services/Reservas/reservas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { logoBase64 } from '../../../../public/assets/img/logoBase64';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['Id_Reserva']?.currentValue) {
      this.loadReservaData(changes['Id_Reserva'].currentValue);
    }
  }
  isLoading = false;

  // DTO normalizado para la vista
  reserva: any = null;
  responsable: ResponsableVM = { nombre: '—', telefono: '—', CanalReserva: '—' };

  // Pasajeros agrupados
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
  ) { }
  editarReserva() {
    const id = this.reserva?.Id_Reserva;
    if (!id) return;

    // 1) mandar la selección al editor (sin navegar)
    this.navbar.Id_Reserva.set(String(id));
    if (this.reserva?.Id_Reserva) {
      // Cerrar el panel de la barra dinámica para que el editor quede limpio
      try { this.navbar.closePanel(); } catch {}
      // Notificar al contenedor que cierre la vista si lo maneja
      try { this.onClose.emit(); } catch {}
      // Navegar a la ruta de edición
      this.router.navigate([`/Reservas/EditarReserva`, this.reserva.Id_Reserva]);
    }
  }


  get tipoClases() {
    const tipos = [this.pasajeros.adultos, this.pasajeros.ninos, this.pasajeros.infantes].filter(a => a.length > 0).length;
    return { uno: tipos === 1, dos: tipos === 2, tres: tipos === 3 };
  }

  ngOnInit(): void {
    if (this.Id_Reserva) this.loadReservaData(this.Id_Reserva);
  }

  private normalizeApi(data: any) {
    // Acepta {reserva, pasajeros, pagos} o un DTO plano
    const hasFlat = !!data?.Id_Reserva;
    const base = hasFlat
      ? data
      : {
        ...(data?.reserva || {}),
        Pasajeros: data?.pasajeros || [],
        Pagos: data?.pagos || [],
      };

    // Campos esperados por la vista
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

    // Agrupar pasajeros
    const adultos = r.Pasajeros.filter((p: any) => (p.TipoPasajero || p.tipoPasajero) === 'Adulto');
    const ninos = r.Pasajeros.filter((p: any) => (p.TipoPasajero || p.tipoPasajero) === 'Niño');
    const infantes = r.Pasajeros.filter((p: any) => (p.TipoPasajero || p.tipoPasajero) === 'Infante');

    // Responsable VM
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
        console.log('Reserva cargada:', this.reserva);
      },
      error: (err) => {
        console.error('Error al cargar la reserva:', err);
        this.isLoading = false;
      },
    });
  }

  descargarPDF() {
    const r = this.reserva;
    const doc = new jsPDF() as jsPDF & { lastAutoTable?: any };

    // Logo + encabezado
    doc.addImage(logoBase64, 'PNG', 10, 10, 40, 15);
    doc.setFontSize(18); doc.setTextColor(40, 40, 40);
    doc.text(`Reserva #${r.Id_Reserva}`, 60, 20);
    doc.setFontSize(12); doc.setTextColor(90);
    doc.text(`Estado: ${r.Estado}`, 60, 28);
    doc.line(10, 35, 200, 35);

    let lastY = 40;

    // Datos generales
    const datos = [
      ['Pasajeros', r.NumeroPasajeros ?? '—'],
      ['Tour', r.TourReserva ?? '—'],
      ['Punto de Encuentro', r.PuntoEncuentro ?? '—'],
      ['Fecha del Tour', r.FechaReserva ? new Date(r.FechaReserva).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '—'],
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

    // Pasajeros
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
          p.Precio_Pasajero
        ]),
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [52, 73, 94], textColor: 255 },
      });

      lastY = (doc.lastAutoTable?.finalY ?? lastY) + 10;
    }

    // Footer
    const fecha = new Date().toLocaleDateString('es-CO');
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Generado por SIR – Sistema Integrado de Reservas | ${fecha}`, 10, 290);

    doc.save(`reserva-${r.Id_Reserva}.pdf`);
  }

  close() {
    this.onClose.emit();
  }
}
