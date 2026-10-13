import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-filter-panel',
  standalone: true,
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirFilterPanelComponent {
  @Input() panelId = '';
  @Input() open = false;
  @Input() label = 'Filtros adicionales';
}
