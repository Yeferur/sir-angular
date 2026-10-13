import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirFilterBarComponent {
  @Input() panelId = '';
  @Input() expanded = false;
  @Input() filterCount = 0;
  @Input() busy = false;
  @Input() canSearch = true;
  @Input() showFilters = true;
  @Input() showSearch = true;
  @Input() showClear = false;
  @Input() searchLabel = 'Buscar';
  @Input() clearLabel = 'Limpiar';
  @Output() toggleFilters = new EventEmitter<void>();
  @Output() search = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
}
