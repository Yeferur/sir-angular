import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

let emptyStateId = 0;

@Component({
  selector: 'app-query-empty-state',
  standalone: true,
  templateUrl: './query-empty-state.html',
  styleUrl: './query-empty-state.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueryEmptyStateComponent {
  @Input() icon = 'bx-search-alt';
  @Input() title = 'Listo para buscar';
  @Input() description = '';
  @Input() compact = false;
  @Input() headingLevel: 2 | 3 = 2;
  readonly titleId = `sir-query-empty-${++emptyStateId}`;
}
