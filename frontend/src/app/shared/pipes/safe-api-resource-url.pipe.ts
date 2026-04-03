import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../../environments/environment';

@Pipe({
  name: 'safeApiResourceUrl',
  standalone: true,
})
export class SafeApiResourceUrlPipe implements PipeTransform {
  transform(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) return null;

    const apiBase = this.getApiBaseUrl();
    if (!apiBase) return null;

    try {
      const parsed = new URL(rawUrl, apiBase.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (parsed.origin !== apiBase.origin) return null;

      const apiPath = this.normalizePath(apiBase.pathname || '/api');
      const urlPath = this.normalizePath(parsed.pathname || '/');
      if (!(urlPath === apiPath || urlPath.startsWith(`${apiPath}/`))) return null;

      return parsed.toString();
    } catch {
      return null;
    }
  }

  private getApiBaseUrl(): URL | null {
    try {
      if (/^https?:\/\//i.test(environment.apiUrl)) {
        return new URL(environment.apiUrl);
      }

      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      return new URL(environment.apiUrl, origin);
    } catch {
      return null;
    }
  }

  private normalizePath(pathValue: string): string {
    let p = pathValue.trim();
    if (!p.startsWith('/')) p = `/${p}`;
    return p.replace(/\/+$/, '') || '/';
  }
}
