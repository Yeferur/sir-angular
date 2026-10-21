import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

@Component({
  selector: 'app-filter-panel',
  standalone: true,
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirFilterPanelComponent {
  private openValue = false;
  @HostBinding('style.display') get hostDisplay(): string { return this.rendered ? 'block' : 'none'; }
  @HostBinding('class.sir-filter-panel-host--standalone') get standaloneHost(): boolean { return this.standalone; }
  @Input() panelId = '';
  @Input() label = 'Filtros adicionales';
  @Input() standalone = false;
  rendered = false;

  @Input() set open(value: boolean) {
    this.openValue = !!value;
    this.rendered = this.openValue;
  }
  get open(): boolean { return this.openValue; }
}
