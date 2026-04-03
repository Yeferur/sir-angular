import { Component, Input, inject, OnChanges, SimpleChanges } from '@angular/core';

import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { SafeApiResourceUrlPipe } from '../../shared/pipes/safe-api-resource-url.pipe';

@Component({
  selector: 'app-preview',
  standalone: true,
  imports: [SafeApiResourceUrlPipe],
  templateUrl: './preview.html',
  styleUrls: ['./preview.css'],
})
export class PreviewComponent {
  private global = inject(DynamicIslandGlobalService);

  @Input() rawUrl: string | null = null; // plain string used for download/open
  @Input() title: string | null = null;

  loading: boolean = true;
  error: string | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['rawUrl']) {
      this.loading = true;
      this.error = null;
    }
  }

  onLoad() {
    this.loading = false;
  }

  onError() {
    this.loading = false;
    this.error = 'No se pudo cargar la vista previa.';
  }

  close() {
    this.global.closePreview();
  }
}
