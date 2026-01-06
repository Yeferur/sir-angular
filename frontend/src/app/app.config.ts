import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { DragDropModule } from '@angular/cdk/drag-drop';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { IMAGE_CONFIG } from '@angular/common';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    importProvidersFrom(DragDropModule),
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),
    {
      provide: IMAGE_CONFIG,
      useValue: {
        disableImageSizeWarning: true,
        disableImageLazyLoadWarning: true
      },
    }
  ]
};
