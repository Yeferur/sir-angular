import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TransferProgramacion,
  TransfersProgramacionResponse,
} from '../../../services/Programacion/programacion';

@Component({
  selector: 'app-programacion-transfers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './programacion-transfers.html',
  styleUrl: './programacion-transfers.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramacionTransfersComponent {
  operationDate = input.required<string>();
  data = input.required<TransfersProgramacionResponse>();
  exporting = input(false);

  closeRequested = output<void>();
  exportRequested = output<void>();

  searchTerm = '';
  selectedService = '';

  get filteredTransfers(): TransferProgramacion[] {
    const term = this.normalize(this.searchTerm);
    return this.data().transfers.filter((transfer) => {
      if (this.selectedService && transfer.Nombre_Servicio !== this.selectedService) return false;
      if (!term) return true;
      return [
        transfer.Codigo_Transfer,
        transfer.Nombre_Servicio,
        transfer.Nombre_Titular,
        transfer.Punto_Salida,
        transfer.Punto_Destino,
        transfer.Vuelo,
        transfer.Telefono_Titular,
      ].some((value) => this.normalize(value).includes(term));
    });
  }

  isPending(transfer: TransferProgramacion): boolean {
    return /pendiente/i.test(String(transfer.Estado || ''));
  }

  private normalize(value: unknown): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
