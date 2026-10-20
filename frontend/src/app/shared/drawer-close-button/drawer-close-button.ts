import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-drawer-close-button',
  standalone: true,
  templateUrl: './drawer-close-button.html',
  styleUrl: './drawer-close-button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrawerCloseButtonComponent {
  @Input() label = 'Cerrar';
  @Input() disabled = false;
  @Output() dismiss = new EventEmitter<void>();
}
