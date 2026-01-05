import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Sugerencia, TourProgramacion } from '../../interfaces/Programacion/reservas';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragPlaceholder } from "@angular/cdk/drag-drop";

@Component({
  selector: 'app-combinaciones',
  imports: [CommonModule, FormsModule],
  templateUrl: './combinaciones.html',
  styleUrl: './combinaciones.css'
})
export class Combinaciones {
  modomanual = false;
  @Input() tour!: TourProgramacion;
  @Input() sugerencias!: Sugerencia[];
  @Input() flotaManual!: any[];

  @Output() onSeleccionarSugerencia = new EventEmitter<Sugerencia>();
  @Output() onGenerarManual = new EventEmitter<any[]>();
  @Output() onClose = new EventEmitter<void>();

  cerrar() {
    this.onClose.emit();
  }

  agregarBus() {
    this.flotaManual.push({ capacidad: null });
  }

  eliminarBus(i: number) {
    this.flotaManual.splice(i, 1);
  }

  generarManual() {
    this.onGenerarManual.emit(this.flotaManual);
  }

  activarManual() {
    this.modomanual = true;
  }
}