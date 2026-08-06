import { CommonModule } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, HostListener, NgZone,
  Input,
  OnDestroy, ViewChild, computed, effect, inject, signal
} from '@angular/core';
import { GlobalSearchAction, GlobalSearchResult, GlobalSearchService } from '../../services/global-search.service';
import { PermisosService } from '../../services/Permisos/permisos.service';

interface SearchShortcut {
  label: string;
  route: string;
  permission: string;
  icon: string;
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
  private readonly permissions = inject(PermisosService);
  private readonly zone = inject(NgZone);
  @Input() integrated = false;

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  query    = this.search.query;
  submittedQuery = this.search.submittedQuery;
  results  = this.search.results;
  loading  = this.search.loading;
  isClosing = signal(false);
  inputFocused = signal(false);

  readonly shortcuts: SearchShortcut[] = [
    { label: 'Ver reservas', route: '/Reservas/VerReservas', permission: 'RESERVAS.LEER', icon: 'bx bx-calendar-check' },
    { label: 'Ver transfers', route: '/Transfers/VerTransfers', permission: 'TRANSFERS.LEER', icon: 'bx bx-car' },
    { label: 'Ver tours', route: '/Tours/VerTours', permission: 'TOURS.LEER', icon: 'bx bx-map-alt' },
    { label: 'Ver puntos', route: '/Puntos/VerPuntos', permission: 'PUNTOS.LEER', icon: 'bx bx-map-pin' },
  ];

  get availableShortcuts(): SearchShortcut[] {
    return this.shortcuts.filter((shortcut) => this.permissions.tienePermiso(shortcut.permission));
  }

  // ─── Computed ──────────────────────────────────────────────────
  selectedIndex = signal(0);

  groupedResults = computed(() => {
    const groups = new Map<string, GlobalSearchResult[]>();
    const labels: Record<GlobalSearchResult['type'], string> = {
      reserva: 'Reservas', transfer: 'Transfers', tour: 'Tours',
      punto: 'Puntos', servicio: 'Servicios de transfer', date: 'Consultas por fecha',
      usuario: 'Usuarios', module: 'Acciones', action: 'Acciones',
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
  isCurrentQuerySubmitted = computed(() =>
    this.hasQuery() && this.submittedQuery() === this.query().trim()
  );
  showInitialState = computed(() => !this.hasQuery() && !this.loading());
  showWelcome   = computed(() => this.showInitialState() && !this.isClosing());
  showAwaitingSubmit = computed(() =>
    this.hasQuery() && !this.loading() && !this.isCurrentQuerySubmitted()
  );
  showResults = computed(() =>
    this.isCurrentQuerySubmitted() && this.flatResults().length > 0
  );
  showNoResults    = computed(() =>
    this.isCurrentQuerySubmitted() && !this.loading() && this.flatResults().length === 0
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
    this.search.updateQuery(val);
  }

  onEnterSearch(): void {
    const q = this.query().trim();
    if (!q || this.loading()) return;
    this.search.searchGlobal(q);
  }

  openShortcut(shortcut: SearchShortcut): void {
    this.search.executeAction({
      label: shortcut.label,
      kind: 'navigate',
      route: shortcut.route,
      permission: shortcut.permission,
    });
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
    this.isClosing.set(false);
    this.search.closeSearch();
  }

  execute(result: GlobalSearchResult): void { this.search.executeAction(result); }

  executeSecondary(action: GlobalSearchAction, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.search.executeAction(action);
  }

  secondaryActions(result: GlobalSearchResult): GlobalSearchAction[] {
    return Array.isArray(result.actions) ? result.actions.slice(1) : [];
  }

  primaryActionLabel(result: GlobalSearchResult): string {
    const explicitLabel = result.actions?.[0]?.label?.trim();
    if (explicitLabel) return explicitLabel;

    const labels: Partial<Record<GlobalSearchResult['type'], string>> = {
      reserva: 'Ver detalle',
      transfer: 'Ver detalle',
      tour: 'Ver tour',
      punto: 'Ver punto',
      servicio: 'Ver transfers',
      date: 'Consultar fecha',
      usuario: 'Ver usuario',
    };
    return labels[result.type] || 'Abrir';
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
