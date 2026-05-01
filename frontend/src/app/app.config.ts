import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withPreloading } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { DragDropModule } from '@angular/cdk/drag-drop';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { apiEnvelopeInterceptor } from './interceptors/api-envelope.interceptor';
import { IMAGE_CONFIG } from '@angular/common';

import { SelectivePreloadingStrategyService } from './services/selective-preloading-strategy.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withPreloading(SelectivePreloadingStrategyService)),
    importProvidersFrom(DragDropModule),
    provideHttpClient(
      withInterceptors([authInterceptor, apiEnvelopeInterceptor])
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
