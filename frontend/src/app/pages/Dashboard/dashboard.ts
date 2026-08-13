import { CommonModule }         from '@angular/common';
import { Component, ViewChild, inject, OnInit, AfterViewInit, ChangeDetectorRef, OnDestroy, DestroyRef, ChangeDetectionStrategy, HostListener } from '@angular/core';
import { FormsModule }          from '@angular/forms';
import { forkJoin, finalize, catchError, of } from 'rxjs';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

import { DashboardService, DashboardFilters, TourOccupancy } from '../../services/Dashboard/Dashboard.service';
import { SirAlertService }      from '../../services/Alertas/alert.service';
import { Tours } from '../../services/Tours/tours';
import { WebSocketConnectionState, WebSocketService } from '../../services/WebSocket/web-socket';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import {
  NgApexchartsModule, ChartComponent,
  ApexAxisChartSeries, ApexChart, ApexXAxis, ApexTitleSubtitle,
  ApexStroke, ApexFill, ApexTooltip, ApexDataLabels,
  ApexYAxis, ApexGrid, ApexLegend, ApexPlotOptions
} from 'ng-apexcharts';

// ─── Tipo de tour para el selector ───────────────────────────────────────────
export interface TourOption { Id_Tour: number; Nombre_Tour: string; }

export type ChartOptions = {
  series:       ApexAxisChartSeries | any;
  chart:        ApexChart;
  xaxis:        ApexXAxis;
  title?:       ApexTitleSubtitle;
  stroke:       ApexStroke;
  fill:         ApexFill;
  tooltip:      ApexTooltip;
  dataLabels:   ApexDataLabels;
  yaxis:        ApexYAxis;
  grid:         ApexGrid;
  legend?:      ApexLegend;
  plotOptions?: ApexPlotOptions;
  labels?:      string[];
  colors?:      string[];
  markers?:     any;
};

export type IncomeGranularity = 'mensual' | 'diario';

// ─── Tokens de diseño ─────────────────────────────────────────────────────────
// Los charts leen los colores reales del sistema (--accent-*) en vez de duplicarlos
// a mano, para que si el token cambia en styles.css los gráficos lo hereden solos.
// Teal/violeta/rosa/lima no tienen token semántico propio (son acentos exclusivos
// de gráficos con más de 4 series) y se quedan fijos a propósito.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const FONT  = 'Inter, sans-serif';
const BG    = 'transparent';
const AXIS  = '#8b93a1';
const GRID  = 'rgba(139, 147, 161, .16)';

const C_BLUE   = cssVar('--accent-blue',   '#0a84ff');
const C_GREEN  = cssVar('--accent-green',  '#30d158');
const C_RED    = cssVar('--accent-red',    '#ff453a');
const C_YELLOW = cssVar('--accent-yellow', '#ffd60a');
const C_ORANGE = cssVar('--accent-orange', '#ff9f0a');
const C_PURPLE = '#9d86e8';
const C_TEAL   = '#2dd4bf';
const C_PINK   = '#f472b6';
const C_LIME   = '#a3e635';

const DIST_PALETTE = [C_BLUE, C_GREEN, C_TEAL, C_ORANGE, C_PURPLE, C_PINK, C_LIME, C_YELLOW, '#60a5fa', C_RED];

const APEX_EASING: 'easeout' = 'easeout';

const COP = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

const COP_COMPACT = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', notation: 'compact', maximumFractionDigits: 1 }).format(v);

function grid(showX = false, showY = true): any {
  return { borderColor: GRID, strokeDashArray: 3, padding: { left: 6, right: 10 }, xaxis: { lines: { show: showX } }, yaxis: { lines: { show: showY } } };
}

function axisStyle(): any {
  return { style: { colors: AXIS, fontSize: '11px', fontFamily: FONT } };
}

interface IncomeSeriesSet {
  categories: string[];
  empresa: number[];
  tours: number[];
  transfers: number[];
}

const EMPTY_INCOME_SET: IncomeSeriesSet = { categories: [], empresa: [], tours: [], transfers: [] };

// ─── Componente ───────────────────────────────────────────────────────────────
@Component({
  selector:    'app-dashboard',
  standalone:  true,
  imports:     [CommonModule, NgApexchartsModule, FormsModule, DatepickerComponent, LoadingStateComponent],
  templateUrl: './dashboard.html',
  styleUrls:   ['./dashboard.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {

  private svc   = inject(DashboardService);
  private toursSvc = inject(Tours);
  private alert = inject(SirAlertService);
  private cdr   = inject(ChangeDetectorRef);
  private ws    = inject(WebSocketService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  totalReservas       = 0;
  totalPasajeros      = 0;
  totalIngresos       = 0;    // bruto tours
  totalIngresosNetos  = 0;    // neto tours (tras comisión)
  totalTransfers      = 0;
  totalTransferPassengers = 0;
  companyRevenue = 0;
  transferRevenue = 0;
  scheduledTourRevenue = 0;
  tourCommission = 0;
  collectedRevenue = 0;
  pendingCollection = 0;
  noShowAdjustment = 0;
  closedJourneys = 0;
  pendingJourneys = 0;
  primaryCurrency = 'COP';
  mixedCurrencies = false;
  financialByCurrency: any[] = [];
  comparison: any = null;
  connectionState: WebSocketConnectionState = 'connecting';
  activeSection: 'resumen' | 'cobros' | 'ingresos' | 'comercial' = 'resumen';
  reservationTypeRows: any[] = [];

  // ── Filtros ───────────────────────────────────────────────────────────────
  startDate  = '';
  endDate    = '';
  tours:      TourOption[] = [];
  selectedTourId: number | null = null;
  selectedReservationType: '' | 'Grupal' | 'Privada' = '';
  selectedTourPlanCount = 0;
  tourPlanRows: TourOccupancy[] = [];

  get tourLabel(): string {
    if (!this.selectedTourId) return 'Todos los tours';
    return this.tours.find(t => t.Id_Tour === this.selectedTourId)?.Nombre_Tour ?? 'Tour seleccionado';
  }

  // ── ViewChild refs ────────────────────────────────────────────────────────
  @ViewChild('chartIncome')      chartIncome?:      ChartComponent;
  @ViewChild('chartPax')         chartPax?:         ChartComponent;
  @ViewChild('chartChannel')     chartChannel?:     ChartComponent;
  @ViewChild('chartAttendance')  chartAttendance?:  ChartComponent;
  @ViewChild('chartReservationType') chartReservationType?: ChartComponent;
  @ViewChild('chartTourPax')     chartTourPax?:     ChartComponent;
  @ViewChild('chartCompanySplit') chartCompanySplit?: ChartComponent;
  @ViewChild('chartTourSplit')   chartTourSplit?:   ChartComponent;

  // ── Chart options ─────────────────────────────────────────────────────────
  incomeChartOptions:    Partial<ChartOptions> | any = {};
  paxChartOptions:       Partial<ChartOptions> | any = {};
  channelChartOptions:   Partial<ChartOptions> | any = {};
  attendanceChartOptions: Partial<ChartOptions> | any = {};
  reservationTypeChartOptions: Partial<ChartOptions> | any = {};
  tourPaxChartOptions:   Partial<ChartOptions> | any = {};
  companySplitChartOptions: Partial<ChartOptions> | any = {};
  tourSplitChartOptions: Partial<ChartOptions> | any = {};

  // ── Ingresos: granularidad (reemplaza los 3 charts redundantes por 1 con toggle) ──
  incomeGranularity: IncomeGranularity = 'mensual';
  private incomeMonthly: IncomeSeriesSet = EMPTY_INCOME_SET;
  private incomeDaily:   IncomeSeriesSet = EMPTY_INCOME_SET;

  // ── Flags ─────────────────────────────────────────────────────────────────
  isInitialLoading = true;
  isRefreshing     = false;
  hasIncomeData    = false;
  hasPaxData       = false;
  hasChannelData   = false;
  hasAttendanceData = false;
  hasReservationTypeData = false;
  hasTourPaxData   = false;
  hasCompositionData = false;

  totalViajaron = 0;
  totalNoViajaron = 0;
  totalPendientes = 0;

  private viewReady          = false;
  private lastResponse: any  = null;
  private refreshTimer:   ReturnType<typeof setTimeout> | null = null;
  private reqId              = 0;
  private tourMetaReqId      = 0;
  private sectionScrollRaf: number | null = null;
  private readonly reportSectionIds = ['resumen', 'cobros', 'ingresos', 'comercial'] as const;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit() {
    const today = new Date();
    this.startDate = this.toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
    this.endDate   = this.toDateStr(today);
    this.restoreFiltersFromUrl();
    this.syncFiltersToUrl();
    this.initCharts();
    this.loadTours();
    if (this.selectedTourId) this.loadSelectedTourMeta(false);
    this.loadData(true);
    this.listenForRealtimeChanges();
    this.listenForConnectionState();
  }

  ngAfterViewInit() {
    this.viewReady = true;
    this.syncPickers();
    if (this.lastResponse) { this.applyAll(this.lastResponse); this.reflow(); }
    this.queueActiveSectionSync();
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.sectionScrollRaf !== null) cancelAnimationFrame(this.sectionScrollRaf);
  }

  // ── Tours ─────────────────────────────────────────────────────────────────
  private loadTours() {
    this.toursSvc.getTours().pipe(catchError(() => of([]))).subscribe((list) => {
      this.tours = (list || [])
        .filter((tour): tour is TourOption => typeof tour?.Id_Tour === 'number' && typeof tour?.Nombre_Tour === 'string');
      this.cdr.detectChanges();
    });
  }

  onTourChange(tourId: number | null) {
    const parsed = Number(tourId);
    this.selectedTourId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    this.selectedTourPlanCount = 0;
    this.tourPlanRows = [];
    this.syncFiltersToUrl();
    this.loadSelectedTourMeta();
  }

  onReservationTypeChange(type: '' | 'Grupal' | 'Privada') {
    this.selectedReservationType = type;
    this.scheduleRefresh();
  }

  get shouldShowTourPaxCard(): boolean {
    return !this.selectedTourId || this.selectedTourPlanCount > 1 || this.isPlanBreakdown;
  }

  get isPlanBreakdown(): boolean {
    return !!this.selectedTourId && this.tourPlanRows.length > 0;
  }

  get tourPaxTitle(): string {
    return this.isPlanBreakdown || (this.selectedTourId && this.selectedTourPlanCount > 1)
      ? 'Pasajeros por plan'
      : 'Pasajeros por tour';
  }

  get tourPaxSubtitle(): string {
    return this.isPlanBreakdown || (this.selectedTourId && this.selectedTourPlanCount > 1)
      ? 'Distribución del tour seleccionado en el rango.'
      : 'Tours con más pasajeros en el rango.';
  }

  private loadSelectedTourMeta(refreshAfterLoad = true): void {
    const requestId = ++this.tourMetaReqId;

    if (!this.selectedTourId) {
      this.selectedTourPlanCount = 0;
      if (refreshAfterLoad) this.scheduleRefresh();
      return;
    }

    this.toursSvc.getTourById(this.selectedTourId).pipe(
      catchError((error) => {
        console.error('Error fetching selected tour metadata:', error);
        return of(null);
      })
    ).subscribe((tour: any) => {
      if (requestId !== this.tourMetaReqId) return;
      this.selectedTourPlanCount = Array.isArray(tour?.Planes) ? tour.Planes.length : 0;
      if (refreshAfterLoad) this.scheduleRefresh();
    });
  }

  // ── Init charts ───────────────────────────────────────────────────────────
  private initCharts() {

    // ── 1. Ingresos — tendencia única, con toggle mensual/diario ─────────
    // Antes existían 3 charts (Evolución de la empresa / Ingreso y neto de
    // tours / Comportamiento diario) mostrando prácticamente la misma serie
    // Tours+Transfers+Empresa tres veces. Ahora es un solo chart que cambia
    // de granularidad con setIncomeGranularity().
    this.incomeChartOptions = {
      series: [
        { name: 'Empresa', data: [] },
        { name: 'Tours', data: [] },
        { name: 'Transfers', data: [] },
      ],
      chart: {
        id: 'income-trend', type: 'area', height: 320, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 480, dynamicAnimation: { enabled: true, speed: 380 } },
        redrawOnParentResize: true, redrawOnWindowResize: true,
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: [3, 2, 2], colors: [C_BLUE, C_PURPLE, C_TEAL] },
      xaxis: {
        categories: [],
        labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false },
        crosshairs: { stroke: { color: C_BLUE, width: 1, dashArray: 3 } }
      },
      yaxis: { labels: { ...axisStyle(), formatter: COP_COMPACT } },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: .6, opacityFrom: .2, opacityTo: .015, stops: [0, 76, 100] }
      },
      colors: [C_BLUE, C_PURPLE, C_TEAL],
      grid: grid(),
      legend: {
        position: 'top', horizontalAlign: 'right', labels: { colors: AXIS },
        fontSize: '12px', fontFamily: FONT, markers: { size: 6 }
      },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: COP } },
      markers: { size: 0, hover: { size: 5 } }
    };

    // ── 2. Pasajeros por día — ritmo operativo, vive en "Cobros" ─────────
    this.paxChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'daily-pax', type: 'bar', height: 280, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 480, dynamicAnimation: { enabled: true, speed: 380 } },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: false, borderRadius: 5, borderRadiusApplication: 'end', columnWidth: '44%' }
      },
      colors: [C_BLUE],
      dataLabels: {
        enabled: true,
        style: { fontSize: '11px', fontFamily: FONT, colors: ['#fff'] },
        formatter: (v: number) => v > 0 ? String(v) : ''
      },
      xaxis: { categories: [], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { ...axisStyle(), formatter: (v: number) => Math.round(v).toString() } },
      fill: {
        type: 'gradient',
        gradient: { colorStops: [
          { offset: 0,   color: C_BLUE, opacity: 0.95 },
          { offset: 100, color: C_BLUE, opacity: 0.55 }
        ]}
      },
      grid: grid(),
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => `${v} pax` } }
    };

    // ── 3. Pasajeros por canal — ranking horizontal ──────────────────────
    this.channelChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'channel-pax', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 520, dynamicAnimation: { enabled: true, speed: 400 } },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      colors: [C_BLUE],
      dataLabels: {
        enabled: true, textAnchor: 'start', offsetX: 5,
        style: { fontSize: '11px', fontFamily: FONT, fontWeight: 700, colors: ['#fff'] },
        formatter: (value: number) => value ? String(value) : ''
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 5, borderRadiusApplication: 'end', barHeight: '58%' }
      },
      xaxis: { categories: [], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: AXIS, fontSize: '12px', fontFamily: FONT }, maxWidth: 170 } },
      grid: grid(true, false),
      legend: { show: false },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => `${v} pasajeros` } }
    };

    // ── 4. Confirmación de viaje — donut, titular = cobertura real ───────
    this.attendanceChartOptions = {
      series: [],
      chart: {
        id: 'attendance-pax', type: 'donut', height: 310,
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 600 },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      labels: ['Viajaron', 'No viajaron', 'Pendientes'],
      colors: [C_GREEN, C_RED, C_ORANGE],
      legend: {
        position: 'bottom', labels: { colors: '#9ca3af' },
        fontSize: '12px', fontFamily: FONT, itemMargin: { horizontal: 8 }
      },
      dataLabels: {
        enabled: true,
        style: { fontSize: '12px', fontFamily: FONT, fontWeight: 700, colors: ['#fff'] },
        dropShadow: { enabled: true, blur: 4, opacity: 0.35 }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              // El titular ahora es cuánta asistencia está confirmada del total
              // de pasajeros (dato real de cierre), no la tasa de viaje del
              // subconjunto que ya se confirmó — antes decía "100%" con 605
              // pasajeros pendientes, que es engañoso para decidir.
              name: { show: true, color: '#9ca3af', fontSize: '13px' },
              value: { show: true, color: '#fff', fontSize: '22px', fontWeight: 700 },
              total: {
                show: true, label: 'Confirmado', color: '#9ca3af', fontSize: '13px', fontWeight: 600,
                formatter: () => this.attendanceCoverage === null ? '—' : `${this.attendanceCoverage.toFixed(1)}%`
              }
            }
          }
        }
      },
      stroke: { show: false },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => `${v} pasajeros` } }
    };

    // ── 5. Reservas grupales vs. privadas — barras agrupadas ────────────
    this.reservationTypeChartOptions = {
      series: [
        { name: 'Reservas', data: [] },
        { name: 'Pasajeros', data: [] }
      ],
      chart: {
        id: 'reservation-type', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 500, dynamicAnimation: { enabled: true, speed: 400 } },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 5, borderRadiusApplication: 'end', barHeight: '58%' }
      },
      colors: [C_PURPLE, C_BLUE],
      dataLabels: { enabled: false },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      xaxis: { categories: ['Grupales', 'Privadas'], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      // FIX: antes tenía formatter numérico (Math.round) aplicado también a
      // este eje; en un bar horizontal ApexCharts pasa las categorías por acá
      // y Math.round('Grupales') = NaN. Sin formatter numérico, como en
      // channel/tourPax, que sí funcionan bien.
      yaxis: { labels: { style: { colors: AXIS, fontSize: '12px', fontFamily: FONT } } },
      fill: { opacity: .9 },
      grid: grid(),
      legend: {
        position: 'top', horizontalAlign: 'right', labels: { colors: AXIS },
        fontSize: '12px', fontFamily: FONT, markers: { size: 6 }
      },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, shared: true, intersect: false }
    };

    // ── 6. Pasajeros por tour (antes "Top Destinos", no mostraba destinos) ─
    this.tourPaxChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'tour-pax', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 520, dynamicAnimation: { enabled: true, speed: 400 } },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 5, borderRadiusApplication: 'end', barHeight: '58%', distributed: false }
      },
      colors: [C_TEAL],
      dataLabels: {
        enabled: true, textAnchor: 'start', offsetX: 4,
        style: { fontSize: '11px', fontFamily: FONT, fontWeight: 600, colors: ['#fff'] }
      },
      xaxis: { categories: [], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: AXIS, fontSize: '12px', fontFamily: FONT }, maxWidth: 170 } },
      grid: grid(true, false),
      legend: { show: false },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => `${v} pax` } }
    };

    // ── 7 y 8. Composición financiera — reemplaza la lista de texto plano ──
    // Dos donuts pequeños que muestran las dos preguntas reales:
    // "¿de qué se compone el ingreso de la empresa?" y
    // "¿cuánto del ingreso de tours se queda vs. se paga en comisión?"
    const donutBase = {
      chart: {
        type: 'donut', height: 190, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: APEX_EASING, speed: 500 },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      dataLabels: { enabled: false },
      legend: { show: false },
      stroke: { show: false },
      plotOptions: { pie: { donut: { size: '72%' } } },
    };

    this.companySplitChartOptions = {
      ...donutBase,
      series: [],
      labels: ['Tours', 'Transfers'],
      colors: [C_BLUE, C_TEAL],
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => COP(v) } },
    };

    this.tourSplitChartOptions = {
      ...donutBase,
      series: [],
      labels: ['Neto', 'Comisión'],
      colors: [C_GREEN, C_ORANGE],
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => COP(v) } },
    };
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  private get filters(): DashboardFilters {
    const f: DashboardFilters = {};
    if (this.startDate) f.startDate = this.startDate;
    if (this.endDate)   f.endDate   = this.endDate;
    if (this.selectedTourId) f.tourId = this.selectedTourId;
    if (this.selectedReservationType) f.reservationType = this.selectedReservationType;
    return f;
  }

  loadData(initial = false) {
    const id = ++this.reqId;
    let partial = false;
    const f = this.filters;

    if (initial) { this.isInitialLoading = true; }
    else         { this.isRefreshing     = true; }
    this.cdr.detectChanges();

    forkJoin({
      stats:    this.svc.getStats(f).pipe(catchError(e => { console.error(e); partial = true; return of(null); })),
      income:   this.svc.getIncomeHistory(Number(this.startDate.slice(0, 4)) || new Date().getFullYear(), f).pipe(catchError(() => { partial = true; return of({ bruto: Array(12).fill(0), neto: Array(12).fill(0) }); })),
      daily:    this.svc.getDailyIncome(f).pipe(catchError(() => { partial = true; return of([]); })),
      dailyPax: this.svc.getDailyPassengers(f).pipe(catchError(() => { partial = true; return of([]); })),
      channels: this.svc.getPassengersByChannel(f).pipe(catchError(() => { partial = true; return of([]); })),
      attendance: this.svc.getPassengerDistribution(f).pipe(catchError(() => { partial = true; return of([]); })),
      reservationTypes: this.svc.getReservationBreakdown(f).pipe(catchError(() => { partial = true; return of([]); })),
      occupancy:this.svc.getTourOccupancy(f).pipe(catchError(() => { partial = true; return of([]); }))
    })
    .pipe(finalize(() => {
      if (id !== this.reqId) return;
      this.isInitialLoading = false;
      this.isRefreshing     = false;
      this.cdr.detectChanges();
    }))
    .subscribe({
      next: res => {
        if (id !== this.reqId) return;
        this.lastResponse = res;

        this.totalReservas      = Number(res.stats?.totalReservas      || 0);
        this.totalPasajeros     = Number(res.stats?.totalPasajeros     || 0);
        this.totalIngresos      = Number(res.stats?.totalIngresos      || 0);
        this.totalIngresosNetos = Number(res.stats?.totalIngresosNetos || 0);
        this.totalTransfers     = Number(res.stats?.totalTransfers     || 0);
        this.totalTransferPassengers = Number(res.stats?.totalTransferPassengers || 0);
        this.companyRevenue = Number(res.stats?.companyRevenue || 0);
        this.transferRevenue = Number(res.stats?.transferRevenue || 0);
        this.scheduledTourRevenue = Number(res.stats?.scheduledTourRevenue || 0);
        this.tourCommission = Number(res.stats?.tourCommission || 0);
        this.collectedRevenue = Number(res.stats?.collectedRevenue || 0);
        this.pendingCollection = Number(res.stats?.pendingCollection || 0);
        this.noShowAdjustment = Number(res.stats?.noShowAdjustment || 0);
        this.closedJourneys = Number(res.stats?.closedJourneys || 0);
        this.pendingJourneys = Number(res.stats?.pendingJourneys || 0);
        this.primaryCurrency = String(res.stats?.primaryCurrency || 'COP');
        this.mixedCurrencies = !!res.stats?.mixedCurrencies;
        this.financialByCurrency = Array.isArray(res.stats?.financialByCurrency) ? res.stats.financialByCurrency : [];
        this.comparison = res.stats?.comparison || null;
        if (this.viewReady) { this.applyAll(res); this.reflow(); }

        if (partial) this.alert.showModal({
          type: 'warning', title: 'Dashboard parcialmente cargado',
          message: 'Algunas métricas no pudieron obtenerse.'
        });

        this.cdr.detectChanges();
        this.queueActiveSectionSync();
      },
      error: err => {
        if (id !== this.reqId) return;
        console.error(err);
        this.totalReservas = this.totalPasajeros = this.totalIngresos =
          this.totalIngresosNetos = this.totalTransfers = 0;
        this.hasIncomeData = this.hasPaxData = this.hasChannelData =
          this.hasAttendanceData = this.hasReservationTypeData =
          this.hasTourPaxData = this.hasCompositionData = false;
        this.alert.showModal({ type: 'error', title: 'Error al cargar el dashboard',
          message: 'No se pudo obtener la información.' });
        this.cdr.detectChanges();
      }
    });
  }

  // ── Apply chart data ──────────────────────────────────────────────────────
  private applyAll(res: any) {

    // 1. Ingresos — arma los dos sets (mensual/diario) y pinta el activo
    const brutoArr = Array.isArray(res.income?.bruto) ? res.income.bruto : Array(12).fill(0);
    const netoArr  = Array.isArray(res.income?.neto)  ? res.income.neto  : Array(12).fill(0);
    const transferMonthlyArr = Array.isArray(res.income?.transfers) ? res.income.transfers : Array(12).fill(0);
    const companyMonthlyArr = Array.isArray(res.income?.empresa) ? res.income.empresa : brutoArr.map((v: number, i: number) => v + Number(transferMonthlyArr[i] || 0));

    this.incomeMonthly = {
      categories: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
      empresa: companyMonthlyArr,
      tours: brutoArr,
      transfers: transferMonthlyArr,
    };

    const daily = Array.isArray(res.daily) ? res.daily : [];
    const dailyBruto  = daily.map((d: any) => Number(d.bruto || 0));
    const dailyTransfer = daily.map((d: any) => Number(d.transfer || 0));
    const dailyCompany = daily.map((d: any) => Number(d.empresa || (Number(d.bruto || 0) + Number(d.transfer || 0))));

    this.incomeDaily = {
      categories: daily.map((d: any) => this.fmtDate(d.fecha)),
      empresa: dailyCompany,
      tours: dailyBruto,
      transfers: dailyTransfer,
    };

    this.applyIncomeGranularity(this.incomeGranularity);

    // 2. Composición financiera (dos donuts)
    const hasCompanySplit = this.totalIngresos > 0 || this.transferRevenue > 0;
    const hasTourSplit = this.totalIngresosNetos > 0 || this.tourCommission > 0;
    this.hasCompositionData = hasCompanySplit || hasTourSplit;

    const companySplitSeries = hasCompanySplit ? [this.totalIngresos, this.transferRevenue] : [];
    this.companySplitChartOptions = { ...this.companySplitChartOptions, series: companySplitSeries };
    this.chartCompanySplit?.updateSeries(companySplitSeries, true);

    const tourSplitSeries = hasTourSplit ? [this.totalIngresosNetos, this.tourCommission] : [];
    this.tourSplitChartOptions = { ...this.tourSplitChartOptions, series: tourSplitSeries };
    this.chartTourSplit?.updateSeries(tourSplitSeries, true);

    // 3. Pasajeros por día
    const dp = Array.isArray(res.dailyPax) ? res.dailyPax : [];
    const dpLabels = dp.map((d: any) => this.fmtDate(d.fecha));
    const dpData   = dp.map((d: any) => Number(d.pasajeros || 0));
    this.hasPaxData = dpData.some((v: number) => v > 0);

    const pSeries = [{ name: 'Pasajeros', data: dpData }];
    this.paxChartOptions = {
      ...this.paxChartOptions,
      xaxis: { ...this.paxChartOptions.xaxis, categories: dpLabels },
      series: pSeries
    };
    this.chartPax?.updateOptions({ xaxis: { ...this.paxChartOptions.xaxis, categories: dpLabels } }, false, false);
    this.chartPax?.updateSeries(pSeries, true);

    // 4. Pasajeros por canal
    const ch = Array.isArray(res.channels) ? res.channels : [];
    const chLabels = ch.map((d: any) => d.canal);
    const chData   = ch.map((d: any) => Number(d.cantidad || 0));
    this.hasChannelData = chData.some((v: number) => v > 0);

    const channelSeries = [{ name: 'Pasajeros', data: this.hasChannelData ? chData : [] }];
    this.channelChartOptions = {
      ...this.channelChartOptions,
      xaxis: { ...this.channelChartOptions.xaxis, categories: chLabels },
      series: channelSeries
    };
    if (this.chartChannel) {
      this.chartChannel.updateOptions({ xaxis: { ...this.channelChartOptions.xaxis, categories: chLabels } }, false, false);
      this.chartChannel.updateSeries(channelSeries, true);
    }

    // 5. Confirmación de viaje
    const attendance = Array.isArray(res.attendance) ? res.attendance : [];
    const attendanceMap = new Map<string, number>(
      attendance.map((item: any): [string, number] => [String(item.estado), Number(item.cantidad || 0)])
    );
    this.totalViajaron = attendanceMap.get('Viajaron') || 0;
    this.totalNoViajaron = attendanceMap.get('No viajaron') || 0;
    this.totalPendientes = attendanceMap.get('Pendientes') || 0;
    const attendanceData = [this.totalViajaron, this.totalNoViajaron, this.totalPendientes];
    this.hasAttendanceData = attendanceData.some((value) => value > 0);
    this.attendanceChartOptions = {
      ...this.attendanceChartOptions,
      series: this.hasAttendanceData ? attendanceData : []
    };
    this.chartAttendance?.updateSeries(this.hasAttendanceData ? attendanceData : [], true);

    // 6. Reservas grupales vs. privadas
    const typeRows = Array.isArray(res.reservationTypes) ? res.reservationTypes : [];
    this.reservationTypeRows = typeRows;
    const typeMap = new Map<string, any>(
      typeRows.map((item: any): [string, any] => [String(item.tipo), item])
    );
    const typeCategories = this.selectedReservationType
      ? [this.selectedReservationType === 'Grupal' ? 'Grupales' : 'Privadas']
      : ['Grupales', 'Privadas'];
    const bookingData = typeCategories.map((type) => Number(typeMap.get(type)?.reservas || 0));
    const passengerData = typeCategories.map((type) => Number(typeMap.get(type)?.pasajeros || 0));
    this.hasReservationTypeData = bookingData.some((value) => value > 0) || passengerData.some((value) => value > 0);
    const typeSeries = [
      { name: 'Reservas', data: bookingData },
      { name: 'Pasajeros', data: passengerData }
    ];
    this.reservationTypeChartOptions = {
      ...this.reservationTypeChartOptions,
      xaxis: { ...this.reservationTypeChartOptions.xaxis, categories: typeCategories },
      series: typeSeries
    };
    this.chartReservationType?.updateOptions({ xaxis: { ...this.reservationTypeChartOptions.xaxis, categories: typeCategories } }, false, false);
    this.chartReservationType?.updateSeries(typeSeries, true);

    // 7. Pasajeros por tour
    const occ = Array.isArray(res.occupancy) ? res.occupancy : [];
    this.tourPlanRows = this.selectedTourId && occ.some((item: TourOccupancy) => Object.hasOwn(item, 'idPlan'))
      ? occ
      : [];
    const occCats = occ.map((d: any) => d.nombre);
    const occData = occ.map((d: any) => Number(d.pasajeros || 0));
    this.hasTourPaxData = occData.some((v: number) => v > 0);

    const tourPaxSeries = [{ name: 'Pasajeros', data: this.hasTourPaxData ? occData : [] }];
    this.tourPaxChartOptions = {
      ...this.tourPaxChartOptions,
      xaxis: { ...this.tourPaxChartOptions.xaxis, categories: occCats },
      series: tourPaxSeries
    };
    this.chartTourPax?.updateOptions({ xaxis: { ...this.tourPaxChartOptions.xaxis, categories: occCats } }, false, false);
    this.chartTourPax?.updateSeries(tourPaxSeries, true);

    this.cdr.detectChanges();
  }

  // ── Ingresos: cambio de granularidad sin recrear el chart ─────────────────
  setIncomeGranularity(mode: IncomeGranularity): void {
    if (this.incomeGranularity === mode) return;
    this.incomeGranularity = mode;
    this.applyIncomeGranularity(mode);
    this.cdr.markForCheck();
  }

  private applyIncomeGranularity(mode: IncomeGranularity): void {
    const set = mode === 'mensual' ? this.incomeMonthly : this.incomeDaily;
    this.hasIncomeData = set.empresa.some((v) => v > 0);

    const series = [
      { name: 'Empresa', data: set.empresa },
      { name: 'Tours', data: set.tours },
      { name: 'Transfers', data: set.transfers },
    ];

    this.incomeChartOptions = {
      ...this.incomeChartOptions,
      xaxis: { ...this.incomeChartOptions.xaxis, categories: set.categories },
      series,
    };

    this.chartIncome?.updateOptions({ xaxis: { ...this.incomeChartOptions.xaxis, categories: set.categories } }, false, false);
    this.chartIncome?.updateSeries(series, true);
  }

  private fmtDate(raw: any): string {
    if (!raw) return '';
    const s = typeof raw === 'string' ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10);
    const [, m, d] = s.split('-');
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${Number(d)} ${meses[Number(m) - 1]}`;
  }

  private reflow() {
    requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  private tomorrowValue(): string {
    const t = new Date(); t.setDate(t.getDate() + 1); return this.toDateStr(t);
  }

  private normalizeYmd(value: unknown): string | null {
    const safe = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safe);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() + 1 !== month
      || date.getUTCDate() !== day
    ) return null;

    return safe;
  }

  private restoreFiltersFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    const startDate = this.normalizeYmd(params.get('startDate'));
    const endDate = this.normalizeYmd(params.get('endDate'));
    const tourId = Number(params.get('tourId'));
    const reservationType = String(params.get('reservationType') || '');

    if (startDate) this.startDate = startDate;
    if (endDate) this.endDate = endDate;
    if (this.startDate > this.endDate) this.endDate = this.startDate;
    this.selectedTourId = Number.isInteger(tourId) && tourId > 0 ? tourId : null;
    this.selectedReservationType = reservationType === 'Grupal' || reservationType === 'Privada'
      ? reservationType
      : '';
  }

  private syncFiltersToUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        startDate: this.startDate || null,
        endDate: this.endDate || null,
        tourId: this.selectedTourId || null,
        reservationType: this.selectedReservationType || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private syncPickers() {
    this.cdr.markForCheck();
  }

  onDateRangeChange(field: 'startDate' | 'endDate', value: string): void {
    if (!value) return;
    this[field] = value;
    if (this.startDate && this.endDate && this.startDate > this.endDate) {
      if (field === 'startDate') this.endDate = this.startDate;
      else                       this.startDate = this.endDate;
    }
    this.syncPickers();
    this.scheduleRefresh();
  }

  private scheduleRefresh() {
    this.syncFiltersToUrl();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadData(false), 180);
  }

  setTodayRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const t = this.toDateStr(new Date());
    this.startDate = t; this.endDate = t;
    this.syncPickers(); this.syncFiltersToUrl(); this.loadData(false);
  }

  setTomorrowRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const t = this.tomorrowValue();
    this.startDate = t; this.endDate = t;
    this.syncPickers(); this.syncFiltersToUrl(); this.loadData(false);
  }

  setNextSevenDaysRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 6);
    this.startDate = this.toDateStr(start);
    this.endDate = this.toDateStr(end);
    this.syncPickers();
    this.syncFiltersToUrl();
    this.loadData(false);
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  isTodayRange(): boolean    { const t = this.toDateStr(new Date()); return this.startDate === t && this.endDate === t; }
  isTomorrowRange(): boolean { const t = this.tomorrowValue(); return this.startDate === t && this.endDate === t; }
  isNextSevenDaysRange(): boolean {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 6);
    return this.startDate === this.toDateStr(start) && this.endDate === this.toDateStr(end);
  }
  get avgPaxPerBooking(): number | null {
    return this.totalReservas ? this.totalPasajeros / this.totalReservas : null;
  }

  get avgIncomePerBooking(): number | null {
    return this.totalReservas ? this.totalIngresos / this.totalReservas : null;
  }

  get marginPct(): number | null {
    if (!this.totalIngresos) return null;
    return ((this.totalIngresosNetos / this.totalIngresos) * 100);
  }

  get travelRate(): number | null {
    const closedPassengers = this.totalViajaron + this.totalNoViajaron;
    return closedPassengers ? (this.totalViajaron / closedPassengers) * 100 : null;
  }

  // Dato real de cierre: cuánta gente ya quedó confirmada (viajó o no viajó)
  // del total de pasajeros del rango. Es el titular del donut de asistencia
  // y de la card "Confirmación" en Resumen — reemplaza a travelRate ahí,
  // que solo describe al subconjunto ya confirmado y podía mostrar 100%
  // con la mayoría de pasajeros todavía pendientes.
  get attendanceCoverage(): number | null {
    if (!this.totalPasajeros) return null;
    return ((this.totalViajaron + this.totalNoViajaron) / this.totalPasajeros) * 100;
  }

  get paymentCoverage(): number | null {
    const expected = this.scheduledTourRevenue + this.transferRevenue;
    return expected > 0 ? Math.min(100, (this.collectedRevenue / expected) * 100) : null;
  }

  get companyRevenueComparison(): number | null {
    return this.comparison?.companyRevenuePct ?? null;
  }

  get passengerComparison(): number | null {
    return this.comparison?.passengersPct ?? null;
  }

  get bookingComparison(): number | null {
    return this.comparison?.reservationsPct ?? null;
  }

  get transfersIncluded(): boolean {
    return !this.selectedTourId && !this.selectedReservationType;
  }

  get groupReservations(): number {
    return Number(this.reservationTypeRows.find((item) => item.tipo === 'Grupales')?.reservas || 0);
  }

  get privateReservations(): number {
    return Number(this.reservationTypeRows.find((item) => item.tipo === 'Privadas')?.reservas || 0);
  }

  get groupPassengers(): number {
    return Number(this.reservationTypeRows.find((item) => item.tipo === 'Grupales')?.pasajeros || 0);
  }

  get privatePassengers(): number {
    return Number(this.reservationTypeRows.find((item) => item.tipo === 'Privadas')?.pasajeros || 0);
  }

  get planPassengerTotal(): number {
    return this.tourPlanRows.reduce((total, plan) => total + Number(plan.pasajeros || 0), 0);
  }

  planPassengerShare(plan: TourOccupancy): number {
    return this.planPassengerTotal > 0
      ? (Number(plan.pasajeros || 0) / this.planPassengerTotal) * 100
      : 0;
  }

  comparisonClass(value: number | null): string {
    if (value === null || Math.abs(value) < .05) return 'neutral';
    return value > 0 ? 'positive' : 'negative';
  }

  comparisonText(value: number | null, unit = '%'): string {
    if (value === null) return 'Sin base comparable';
    if (Math.abs(value) < .05) return `Sin cambio${unit === '%' ? '' : ` ${unit}`}`;
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`;
  }

  scrollToSection(id: string): void {
    if (id === 'resumen' || id === 'cobros' || id === 'ingresos' || id === 'comercial') {
      this.activeSection = id;
      this.cdr.markForCheck();
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onReportViewportChange(): void {
    this.queueActiveSectionSync();
  }

  printReport(): void {
    window.print();
  }

  private listenForRealtimeChanges(): void {
    const relevant = new Set([
      'reservaCreada',
      'reservaActualizada',
      'reservaEliminada',
      'transferCreado',
      'transferActualizado',
      'transferEliminado',
      'listadoActualizado',
    ]);
    this.ws.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (!relevant.has(String(event.type))) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.loadData(false), 500);
      });
  }

  private listenForConnectionState(): void {
    this.ws.connectionState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.connectionState = state;
        this.cdr.markForCheck();
      });
  }

  private queueActiveSectionSync(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || this.sectionScrollRaf !== null) return;

    this.sectionScrollRaf = requestAnimationFrame(() => {
      this.sectionScrollRaf = null;
      const activationLine = Math.min(220, Math.max(110, window.innerHeight * .28));
      let nextSection: typeof this.activeSection = 'resumen';

      for (const id of this.reportSectionIds) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= activationLine) nextSection = id;
      }

      const documentHeight = document.documentElement.scrollHeight;
      if (window.scrollY + window.innerHeight >= documentHeight - 4) nextSection = 'comercial';

      if (nextSection !== this.activeSection) {
        this.activeSection = nextSection;
        this.cdr.markForCheck();
      }
    });
  }
}
