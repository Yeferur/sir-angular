import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';


@Component({
  selector: 'app-alert-content', // Nuevo selector
  standalone: true,
  imports: [],
  templateUrl: './alertas.html',
  styleUrls: ['./alertas.css']
})
export class AlertContentComponent implements OnChanges, OnDestroy {
  @Input() overlayId: string = '';
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
    if (
      changes['overlayId']
      || changes['autoClose']
      || changes['autoCloseTime']
      || changes['title']
      || changes['message']
      || changes['type']
      || changes['loading']
    ) {
      this.resetAutoCloseTimer();
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.autoCloseTimeout);
  }

  private resetAutoCloseTimer(): void {
    clearTimeout(this.autoCloseTimeout);
    this.autoCloseTimeout = null;

    if (!this.autoClose) {
      return;
    }

    this.autoCloseTimeout = setTimeout(() => {
      this.onClose.emit();
    }, this.autoCloseTime);
  }
}
