import { CommonModule } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, HostListener, NgZone,
  Input,
  OnDestroy, ViewChild, computed, effect, inject, signal
} from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { GlobalSearchResult, GlobalSearchService } from '../../services/global-search.service';
import { IaService, IaAccion } from '../../services/IA/ia';

interface GlobalSearchConversationMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  accion?: IaAccion;
  acciones?: Array<{ accion: string; label?: string; datos: Record<string, any> }>;
}

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-search.html',
  styleUrls: ['./global-search.css'],
})
export class GlobalSearchComponent implements AfterViewInit, OnDestroy {
  private readonly search = inject(GlobalSearchService);
  private readonly iaService = inject(IaService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  readonly aiEnabled = !!environment.aiEnabled;
  @Input() mode: 'search' | 'maxi' = 'maxi';
  get isMaxiMode(): boolean { return this.mode === 'maxi' && this.aiEnabled; }

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  query    = this.search.query;
  results  = this.search.results;
  loading  = this.search.loading;
  conversationHistory = signal<GlobalSearchConversationMessage[]>([]);
  isClosing = signal(false);

  // ─── IA state ──────────────────────────────────────────────────
  iaRespuesta = signal<string | null>(null);
  iaAccion    = signal<IaAccion | null>(null);
  iaLoading   = signal(false);
  iaActivada  = signal(false);
  inputFocused = signal(false);
  private conversationSequence = 0;
  private iaQuery = '';

  suggestions = [
    'Reserva TG10146',
    'Buscar reserva por nombre',
    'Buscar transfer por titular',
    'Ver transfers de hoy',
    'Puntos de encuentro',
    'Tours disponibles hoy',
  ];

  // ─── Limpieza markdown ─────────────────────────────────────────
  private cleanText(t: string): string {
    return t
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/`(.*?)`/g, '$1')
      .trim();
  }

  // ─── Computed ──────────────────────────────────────────────────
  selectedIndex = signal(0);

  groupedResults = computed(() => {
    const groups = new Map<string, GlobalSearchResult[]>();
    const labels: Record<GlobalSearchResult['type'], string> = {
      reserva: 'Reservas', transfer: 'Transfers', tour: 'Tours',
      punto: 'Puntos', usuario: 'Usuarios', module: 'Acciones', action: 'Acciones',
    };
    for (const item of this.results()) {
      const key = labels[item.type] || 'Resultados';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  });

  flatResults   = computed(() => this.groupedResults().flatMap(g => g.items));
  hasQuery      = computed(() => this.query().trim().length > 0);
  hasIa         = computed(() => !!this.iaRespuesta() || this.iaLoading() || this.iaActivada());
  showInitialState = computed(() => !this.hasQuery() && !this.loading() && !this.hasIa());
  showWelcome   = computed(() => this.conversationHistory().length === 0 && this.showInitialState() && !this.isClosing());
  showNoResults    = computed(() =>
    this.hasQuery() && !this.loading() && !this.iaLoading() &&
    !this.iaRespuesta() && this.flatResults().length === 0
  );

  // ─── Comet animation ───────────────────────────────────────────
  private cometRaf?: number;
  private cometOffset = 0;
  private cometPerimeter = 2400;
  private readonly COMET_LEN = 260;
  private readonly COMET_SPEED = 2.4;
  private cometColorIdx = 0;
  private readonly COMET_COLORS: [string, string][] = [
    ['#0a84ff', '#30d158'],
    ['#30d158', '#ffd60a'],
    ['#ffd60a', '#bf5af2'],
    ['#bf5af2', '#0a84ff'],
  ];

  constructor() {
    effect(() => {
      const total = this.flatResults().length;
      if (total === 0) { this.selectedIndex.set(0); return; }
      if (this.selectedIndex() >= total) this.selectedIndex.set(total - 1);
    });

    effect(() => {
      if (!this.search.open()) return;
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 50);
    });

    effect(() => {
      if (!this.isMaxiMode) return;
      const isLoading  = this.loading();
      const hasResults = this.flatResults().length > 0;
      const q          = this.query().trim();
      if (!isLoading && !hasResults && q.length >= 3 && !this.iaActivada()) {
        this.callIa(q);
      }
      if (hasResults && !this.iaQuery.endsWith('?') && !this.iaLoading()) {
        this.resetIa();
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.search.open()) {
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 50);
    }
    this.zone.runOutsideAngular(() => this.initComet());
  }

  ngOnDestroy(): void {
    if (this.cometRaf) cancelAnimationFrame(this.cometRaf);
  }

  // ─── Input ─────────────────────────────────────────────────────
  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.search.query.set(val);
    this.resetIa();
    // No busca — espera que el usuario presione Buscar o Enter
  }

  onEnterSearch(): void {
    const q = this.query().trim();
    if (!q || this.iaLoading() || this.loading()) return;
    this.resetIa();
    this.addConversationMessage({ role: 'user', content: q });
    // Si termina en ? → IA directa
    if (this.isMaxiMode && q.endsWith('?')) {
      this.search.results.set([]);
      this.callIa(q);
      return;
    }
    this.search.searchGlobal(q);
  }

  setSuggestion(text: string): void {
    this.search.query.set(text);
    this.resetIa();
    this.addConversationMessage({ role: 'user', content: text });
    if (this.isMaxiMode && text.endsWith('?')) {
      this.search.results.set([]);
      this.callIa(text);
    } else {
      this.search.searchGlobal(text);
    }
    setTimeout(() => this.searchInput?.nativeElement?.focus(), 0);
  }

  // ─── IA ────────────────────────────────────────────────────────
  private callIa(q: string): void {
    if (!this.isMaxiMode || !q || this.iaLoading()) return;
    this.iaQuery = q;
    this.iaActivada.set(true);
    this.iaLoading.set(true);
    this.iaRespuesta.set(null);
    this.iaAccion.set(null);

    this.iaService.chat(q).then(res => {
      this.iaRespuesta.set(this.cleanText(res.texto || 'Sin respuesta.'));
      this.iaAccion.set(res.accion);
      this.addConversationMessage({
        role: 'assistant',
        content: this.cleanText(res.texto || 'Sin respuesta.'),
        accion: res.accion || undefined,
        acciones: res.accion?.acciones,
      });
      // Limpiar el input una vez que la IA responde
      this.search.query.set('');
      if (this.searchInput) this.searchInput.nativeElement.value = '';
    }).catch(() => {
      this.iaRespuesta.set('La función de IA no está disponible temporalmente.');
      this.addConversationMessage({
        role: 'assistant',
        content: 'La función de IA no está disponible temporalmente.',
      });
    }).finally(() => {
      this.iaLoading.set(false);
    });
  }

  private resetIa(): void {
    this.iaActivada.set(false);
    this.iaRespuesta.set(null);
    this.iaAccion.set(null);
    this.iaQuery = '';
  }

  private addConversationMessage(message: Omit<GlobalSearchConversationMessage, 'id'>): void {
    this.conversationHistory.update((history) => [
      ...history,
      { id: ++this.conversationSequence, ...message },
    ]);
  }

  closeFromButton(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isClosing.set(true);
    setTimeout(() => {
      this.close();
      this.isClosing.set(false);
    }, 140);
  }

  ejecutarAccion(accion: IaAccion): void {
    const map: Record<string, string> = {
      buscar_reservas: '/Reservas/VerReservas',
      ver_aforos:      '/',
      ver_transfers:   '/Transfers/VerTransfers',
      crear_reserva:   '/Reservas/NuevaReserva',
      ver_tours:       '/Tours/VerTours',
      ver_puntos:      '/Puntos/VerPuntos',
      ver_listados:    '/Programacion/Listado',
    };
    const route = map[accion.accion];
    this.close();
    if (route) {
      const params = accion.accion === 'buscar_reservas' && accion.datos['query']
        ? { queryParams: { q: accion.datos['query'] } } : {};
      this.router.navigate([route], params);
    }
  }

  ejecutarAccionDirecta(accion: string, datos: Record<string, any>): void {
    this.ejecutarAccion({ accion, datos, label: '' });
  }

  // ─── Comet border (RAF, fuera de Angular) ──────────────────────
  private initComet(): void {
    const svgEl   = document.querySelector<SVGSVGElement>('.island-comet-svg');
    const rectEl  = document.querySelector<SVGRectElement>('#sir-comet');
    const gradEl  = document.querySelector<SVGLinearGradientElement>('#sir-comet-grad');
    if (!svgEl || !rectEl || !gradEl) return;

    const updateSize = () => {
      const host = svgEl.closest('.global-search-shell') as HTMLElement | null;
      if (!host) return;
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      const r = 27;
      // Perímetro rectángulo redondeado
      this.cometPerimeter = 2 * (w - 2*r) + 2 * (h - 2*r) + 2 * Math.PI * r;
      rectEl.setAttribute('width',  String(w - 2));
      rectEl.setAttribute('height', String(h - 2));
      rectEl.setAttribute('x', '1');
      rectEl.setAttribute('y', '1');
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svgEl.style.inset = '0';
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      const baseEl = svgEl.querySelector<SVGRectElement>('.comet-base');
      if (baseEl) {
        baseEl.setAttribute('width',  String(w - 2));
        baseEl.setAttribute('height', String(h - 2));
        baseEl.setAttribute('x', '1');
        baseEl.setAttribute('y', '1');
      }
    };

    const updateGradient = () => {
      const [head, tail] = this.COMET_COLORS[this.cometColorIdx % this.COMET_COLORS.length];
      gradEl.innerHTML = `
        <stop offset="0%"   stop-color="${tail}" stop-opacity="0"/>
        <stop offset="25%"  stop-color="${tail}" stop-opacity="0.3"/>
        <stop offset="60%"  stop-color="${head}" stop-opacity="1"/>
        <stop offset="80%"  stop-color="${head}" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="${head}" stop-opacity="0"/>
      `;
    };

    updateSize();
    updateGradient();

    if (typeof ResizeObserver !== 'undefined') {
      const host = svgEl.closest('.global-search-shell') as HTMLElement | null;
      if (host) new ResizeObserver(updateSize).observe(host);
    }

    this.cometOffset = this.COMET_LEN;

    const loop = () => {
      this.cometOffset -= this.COMET_SPEED;
      if (this.cometOffset <= -this.cometPerimeter) {
        this.cometOffset = this.COMET_LEN;
        this.cometColorIdx++;
        updateGradient();
      }
      const gap = this.cometPerimeter - this.COMET_LEN;
      rectEl.style.strokeDasharray  = `${this.COMET_LEN} ${gap}`;
      rectEl.style.strokeDashoffset = String(this.cometOffset);
      this.cometRaf = requestAnimationFrame(loop);
    };

    this.cometRaf = requestAnimationFrame(loop);
  }

  // ─── Navigation helpers ────────────────────────────────────────
  close(): void {
    this.resetIa();
    this.isClosing.set(false);
    this.conversationHistory.set([]);
    this.iaService.clearHistorial();
    this.iaService.clearContext();
    this.search.closeSearch();
  }

  execute(result: GlobalSearchResult): void { this.search.executeAction(result); }

  executeAction(event: Event, action: any): void {
    event.stopPropagation();
    this.search.executeAction(action);
  }

  getFlatIndex(gi: number, ii: number): number {
    let o = 0;
    const g = this.groupedResults();
    for (let i = 0; i < gi; i++) o += g[i]?.items?.length || 0;
    return o + ii;
  }

  isSelected(i: number): boolean    { return this.selectedIndex() === i; }
  onResultHover(i: number): void    { this.selectedIndex.set(i); }

  @HostListener('document:keydown.escape', ['$event'])
  onEsc(e: Event): void {
    if (!this.search.open()) return;
    (e as KeyboardEvent).preventDefault();
    this.close();
  }

  @HostListener('document:keydown.arrowdown', ['$event'])
  onDown(e: Event): void {
    if (!this.search.open()) return;
    const t = this.flatResults().length;
    if (!t) return;
    (e as KeyboardEvent).preventDefault();
    this.selectedIndex.set((this.selectedIndex() + 1) % t);
  }

  @HostListener('document:keydown.arrowup', ['$event'])
  onUp(e: Event): void {
    if (!this.search.open()) return;
    const t = this.flatResults().length;
    if (!t) return;
    (e as KeyboardEvent).preventDefault();
    this.selectedIndex.set((this.selectedIndex() - 1 + t) % t);
  }
}
