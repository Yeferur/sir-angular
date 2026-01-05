import { Component, Input, inject, OnChanges, SimpleChanges } from '@angular/core';

import { SafeResourceUrl } from '@angular/platform-browser';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

@Component({
  selector: 'app-preview',
  standalone: true,
  imports: [],
  templateUrl: './preview.html',
  styleUrls: ['./preview.css'],
})
export class PreviewComponent {
  private global = inject(DynamicIslandGlobalService);

  @Input() url: SafeResourceUrl | null = null; // sanitized url for iframe/img src
  @Input() rawUrl: string | null = null; // plain string used for download/open
  @Input() title: string | null = null;

  loading: boolean = true;
  error: string | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['url']) {
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
