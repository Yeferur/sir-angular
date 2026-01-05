import { Component, EventEmitter, Input, Output, SimpleChanges, OnChanges } from '@angular/core';


@Component({
  selector: 'app-alert-content', // Nuevo selector
  standalone: true,
  imports: [],
  templateUrl: './alertas.html',
  styleUrls: ['./alertas.css']
})
export class AlertContentComponent implements OnChanges {
  @Input() type: 'success' | 'info' | 'error' | 'warning' = 'info';
  @Input() title: string = '';
  @Input() message: string = '';
  @Input() buttons: { text: string; style: string; onClick: () => void }[] = [];
  @Input() loading: boolean = false;
  @Input() autoClose: boolean = false;
  @Input() autoCloseTime: number = 3000;
  @Output() onClose = new EventEmitter<void>();

  private autoCloseTimeout: any;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['autoClose'] || changes['autoCloseTime']) {
      clearTimeout(this.autoCloseTimeout);
      if (this.autoClose) {
        this.autoCloseTimeout = setTimeout(() => {
          this.onClose.emit();
        }, this.autoCloseTime);
      }
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.autoCloseTimeout);
  }
}
