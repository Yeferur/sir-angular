import { CommonModule }         from '@angular/common';
import { Component, ViewChild, inject, OnInit, AfterViewInit, ChangeDetectorRef, OnDestroy, DestroyRef, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule }          from '@angular/forms';
import { forkJoin, finalize, catchError, of } from 'rxjs';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';
import { LoadingStateComponent } from '../../shared/loading-state/loading-state';

import { DashboardService, DashboardFilters } from '../../services/Dashboard/Dashboard.service';
import { SirAlertService }      from '../../services/Alertas/alert.service';
import { Tours } from '../../services/Tours/tours';
import { WebSocketConnectionState, WebSocketService } from '../../services/WebSocket/web-socket';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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

// ─── Tokens de diseño ─────────────────────────────────────────────────────────
const FONT  = 'Inter, sans-serif';
const BG    = 'transparent';
const AXIS  = '#8b93a1';
const GRID  = 'rgba(139, 147, 161, .16)';

const C_GOLD   = '#ffd700';
const C_GREEN  = '#34c759';
const C_BLUE   = '#0a84ff';
const C_PURPLE = '#9d86e8';
const C_TEAL   = '#2dd4bf';
const C_ORANGE = '#fb923c';
const C_PINK   = '#f472b6';
const C_LIME   = '#a3e635';
const C_RED    = '#f87171';

const DIST_PALETTE = [C_BLUE, C_GREEN, C_TEAL, C_ORANGE, C_PURPLE, C_PINK, C_LIME, C_GOLD, '#60a5fa', C_RED];

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

  // ── KPIs ──────────────────────────────────────────────────────────────────
  totalReservas       = 0;
  totalPasajeros      = 0;
  totalIngresos       = 0;    // bruto
  totalIngresosNetos  = 0;    // neto
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
  updatedAt: Date | null = null;
  connectionState: WebSocketConnectionState = 'connecting';
  activeSection: 'resumen' | 'viaje' | 'ingresos' | 'comercial' = 'resumen';
  reservationTypeRows: any[] = [];

  // ── Filtros ───────────────────────────────────────────────────────────────
  startDate  = '';
  endDate    = '';
  tours:      TourOption[] = [];
  selectedTourId: number | null = null;
  selectedReservationType: '' | 'Grupal' | 'Privada' = '';
  selectedTourPlanCount = 0;

  get tourLabel(): string {
    if (!this.selectedTourId) return 'Todos los tours';
    return this.tours.find(t => t.Id_Tour === this.selectedTourId)?.Nombre_Tour ?? 'Tour seleccionado';
  }

  // ── ViewChild refs ────────────────────────────────────────────────────────
  @ViewChild('chartIncome')    chartIncome?:    ChartComponent;
  @ViewChild('chartNetIncome') chartNetIncome?: ChartComponent;
  @ViewChild('chartDaily')     chartDaily?:     ChartComponent;
  @ViewChild('chartPax')       chartPax?:       ChartComponent;
  @ViewChild('chartChannel')   chartChannel?:   ChartComponent;
  @ViewChild('chartAttendance') chartAttendance?: ChartComponent;
  @ViewChild('chartReservationType') chartReservationType?: ChartComponent;
  @ViewChild('chartOccupancy') chartOccupancy?: ChartComponent;

  // ── Chart options ─────────────────────────────────────────────────────────
  incomeChartOptions:    Partial<ChartOptions> | any = {};
  netIncomeChartOptions: Partial<ChartOptions> | any = {};
  dailyChartOptions:     Partial<ChartOptions> | any = {};
  paxChartOptions:       Partial<ChartOptions> | any = {};
  channelChartOptions:   Partial<ChartOptions> | any = {};
  attendanceChartOptions: Partial<ChartOptions> | any = {};
  reservationTypeChartOptions: Partial<ChartOptions> | any = {};
  occupancyChartOptions: Partial<ChartOptions> | any = {};

  // ── Flags ─────────────────────────────────────────────────────────────────
  isInitialLoading = true;
  isRefreshing     = false;
  hasIncomeData    = false;
  hasNetIncomeData = false;
  hasDailyData     = false;
  hasPaxData       = false;
  hasChannelData   = false;
  hasAttendanceData = false;
  hasReservationTypeData = false;
  hasOccupancyData = false;

  totalViajaron = 0;
  totalNoViajaron = 0;
  totalPendientes = 0;

  private viewReady          = false;
  private lastResponse: any  = null;
  private refreshTimer:   ReturnType<typeof setTimeout> | null = null;
  private reqId              = 0;
  private tourMetaReqId      = 0;
  private sectionObserver: IntersectionObserver | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit() {
    const today = new Date();
    this.startDate = this.toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
    this.endDate   = this.toDateStr(today);
    this.initCharts();
    this.loadTours();
    this.loadData(true);
    this.listenForRealtimeChanges();
    this.listenForConnectionState();
  }

  ngAfterViewInit() {
    this.viewReady = true;
    this.syncPickers();
    if (this.lastResponse) { this.applyAll(this.lastResponse); this.reflow(); }
    this.observeSections();
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.sectionObserver?.disconnect();
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
    this.selectedTourId = tourId;
    this.loadSelectedTourMeta();
  }

  onReservationTypeChange(type: '' | 'Grupal' | 'Privada') {
    this.selectedReservationType = type;
    this.scheduleRefresh();
  }

  get shouldShowOccupancyCard(): boolean {
    return !this.selectedTourId || this.selectedTourPlanCount > 1;
  }

  get occupancyTitle(): string {
    return this.selectedTourId && this.selectedTourPlanCount > 1
      ? 'Pasajeros por plan'
      : 'Top Destinos';
  }

  get occupancySubtitle(): string {
    return this.selectedTourId && this.selectedTourPlanCount > 1
      ? 'Cantidad de pasajeros por plan del tour seleccionado.'
      : 'Pasajeros por tour en el rango seleccionado.';
  }

  private loadSelectedTourMeta(): void {
    const requestId = ++this.tourMetaReqId;

    if (!this.selectedTourId) {
      this.selectedTourPlanCount = 0;
      this.scheduleRefresh();
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
      this.scheduleRefresh();
    });
  }

  // ── Init charts ───────────────────────────────────────────────────────────
  private initCharts() {

    // ── 1. Ingresos Totales (bruto) — área anual ─────────────────────────
    this.incomeChartOptions = {
      series: [
        { name: 'Empresa', data: Array(12).fill(0) },
        { name: 'Tours', data: Array(12).fill(0) },
        { name: 'Transfers', data: Array(12).fill(0) },
      ],
      chart: {
        id: 'income-bruto', type: 'area', height: 300, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 520, dynamicAnimation: { enabled: true, speed: 420 } },
        redrawOnParentResize: true, redrawOnWindowResize: true,
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: [3, 2, 2], colors: [C_BLUE, C_PURPLE, C_TEAL] },
      xaxis: {
        categories: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
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

    // ── 2. Ingresos Netos — área anual, verde ────────────────────────────
    this.netIncomeChartOptions = {
      series: [
        { name: 'Ingreso tours', data: Array(12).fill(0) },
        { name: 'Neto tras comisión', data: Array(12).fill(0) },
      ],
      chart: {
        id: 'income-neto', type: 'area', height: 300, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 520, dynamicAnimation: { enabled: true, speed: 420 } },
        redrawOnParentResize: true, redrawOnWindowResize: true,
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: [2, 3], colors: [C_GOLD, C_GREEN] },
      xaxis: {
        categories: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
        labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false },
        crosshairs: { stroke: { color: C_GREEN, width: 1, dashArray: 3 } }
      },
      yaxis: { labels: { ...axisStyle(), formatter: COP_COMPACT } },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: .24, opacityTo: .02, stops: [0, 72, 100] }
      },
      colors: [C_PURPLE, C_GREEN],
      grid: grid(),
      legend: {
        position: 'top', horizontalAlign: 'right', labels: { colors: AXIS },
        fontSize: '12px', fontFamily: FONT, markers: { size: 6 }
      },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: COP } },
      markers: { size: 0, hover: { size: 5 } }
    };

    // ── 3. Ingresos bruto vs neto por día (rango) — columnas agrupadas ───
    this.dailyChartOptions = {
      series: [
        { name: 'Tours', data: [] },
        { name: 'Transfers', data: [] },
        { name: 'Empresa', data: [] }
      ],
      chart: {
        id: 'daily-income', type: 'line', height: 280, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 480, dynamicAnimation: { enabled: true, speed: 380 } },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: false, borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '58%', grouped: true }
      },
      colors: [C_PURPLE, C_TEAL, C_BLUE],
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: [0, 0, 3] },
      xaxis: { categories: [], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { ...axisStyle(), formatter: COP_COMPACT } },
      fill: { opacity: [.82, .82, 1] },
      grid: grid(),
      legend: {
        position: 'top', horizontalAlign: 'right',
        labels: { colors: AXIS }, fontSize: '12px', fontFamily: FONT,
        markers: { size: 6 }
      },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, shared: true, intersect: false,
        y: { formatter: COP } }
    };

    // ── 4. Pasajeros totales por día — barras simples ─────────────────────
    this.paxChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'daily-pax', type: 'bar', height: 280, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 480, dynamicAnimation: { enabled: true, speed: 380 } },
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

    // ── 5. Pasajeros por canal — ranking horizontal ──────────────────────
    this.channelChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'channel-pax', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 520, dynamicAnimation: { enabled: true, speed: 400 } },
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

    // ── 6. Confirmación de viaje — donut ────────────────────────────────
    this.attendanceChartOptions = {
      series: [],
      chart: {
        id: 'attendance-pax', type: 'donut', height: 310,
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 600 },
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
              name: { show: true, color: '#9ca3af', fontSize: '13px' },
              value: { show: true, color: '#fff', fontSize: '22px', fontWeight: 700 },
              total: {
                show: true, label: 'Tasa de viaje', color: '#9ca3af', fontSize: '13px', fontWeight: 600,
                formatter: () => this.travelRate === null ? '—' : `${this.travelRate.toFixed(1)}%`
              }
            }
          }
        }
      },
      stroke: { show: false },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: (v: number) => `${v} pasajeros` } }
    };

    // ── 7. Reservas grupales vs. privadas — barras agrupadas ────────────
    this.reservationTypeChartOptions = {
      series: [
        { name: 'Reservas', data: [] },
        { name: 'Pasajeros', data: [] }
      ],
      chart: {
        id: 'reservation-type', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 500, dynamicAnimation: { enabled: true, speed: 400 } },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 5, borderRadiusApplication: 'end', barHeight: '58%' }
      },
      colors: [C_PURPLE, C_BLUE],
      dataLabels: { enabled: false },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      xaxis: { categories: ['Grupales', 'Privadas'], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { ...axisStyle(), formatter: (v: number) => Math.round(v).toString() } },
      fill: { opacity: .9 },
      grid: grid(),
      legend: {
        position: 'top', horizontalAlign: 'right', labels: { colors: AXIS },
        fontSize: '12px', fontFamily: FONT, markers: { size: 6 }
      },
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, shared: true, intersect: false }
    };

    // ── 8. Top destinos — barras horizontales ─────────────────────────────
    this.occupancyChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'occupancy', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 520, dynamicAnimation: { enabled: true, speed: 400 } },
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
        this.updatedAt = new Date();

        if (this.viewReady) { this.applyAll(res); this.reflow(); }

        if (partial) this.alert.showModal({
          type: 'warning', title: 'Dashboard parcialmente cargado',
          message: 'Algunas métricas no pudieron obtenerse.'
        });

        this.cdr.detectChanges();
      },
      error: err => {
        if (id !== this.reqId) return;
        console.error(err);
        this.totalReservas = this.totalPasajeros = this.totalIngresos =
          this.totalIngresosNetos = this.totalTransfers = 0;
        this.hasIncomeData = this.hasNetIncomeData = this.hasDailyData =
          this.hasPaxData = this.hasChannelData = this.hasAttendanceData =
          this.hasReservationTypeData = this.hasOccupancyData = false;
        this.alert.showModal({ type: 'error', title: 'Error al cargar el dashboard',
          message: 'No se pudo obtener la información.' });
        this.cdr.detectChanges();
      }
    });
  }

  // ── Apply chart data ──────────────────────────────────────────────────────
  private applyAll(res: any) {

    // 1 + 2. Ingresos bruto / neto mensual
    const brutoArr = Array.isArray(res.income?.bruto) ? res.income.bruto : Array(12).fill(0);
    const netoArr  = Array.isArray(res.income?.neto)  ? res.income.neto  : Array(12).fill(0);
    const transferArr = Array.isArray(res.income?.transfers) ? res.income.transfers : Array(12).fill(0);
    const companyArr = Array.isArray(res.income?.empresa) ? res.income.empresa : brutoArr.map((v: number, i: number) => v + Number(transferArr[i] || 0));
    this.hasIncomeData    = companyArr.some((v: number) => v > 0);
    this.hasNetIncomeData = netoArr.some( (v: number) => v > 0);

    const bSeries = [
      { name: 'Empresa', data: companyArr },
      { name: 'Tours', data: brutoArr },
      { name: 'Transfers', data: transferArr },
    ];
    const nSeries = [
      { name: 'Ingreso tours', data: brutoArr },
      { name: 'Neto tras comisión', data: netoArr },
    ];
    this.incomeChartOptions    = { ...this.incomeChartOptions,    series: bSeries };
    this.netIncomeChartOptions = { ...this.netIncomeChartOptions, series: nSeries };
    this.chartIncome?.updateSeries(bSeries, true);
    this.chartNetIncome?.updateSeries(nSeries, true);

    // 3. Ingresos diarios bruto + neto
    const daily = Array.isArray(res.daily) ? res.daily : [];
    const dailyLabels = daily.map((d: any) => this.fmtDate(d.fecha));
    const dailyBruto  = daily.map((d: any) => Number(d.bruto || 0));
    const dailyTransfer = daily.map((d: any) => Number(d.transfer || 0));
    const dailyCompany = daily.map((d: any) => Number(d.empresa || (Number(d.bruto || 0) + Number(d.transfer || 0))));
    this.hasDailyData = dailyCompany.some((v: number) => v > 0);

    const dSeries = [
      { name: 'Tours', type: 'column', data: dailyBruto },
      { name: 'Transfers', type: 'column', data: dailyTransfer },
      { name: 'Empresa', type: 'line', data: dailyCompany },
    ];
    this.dailyChartOptions = {
      ...this.dailyChartOptions,
      xaxis: { ...this.dailyChartOptions.xaxis, categories: dailyLabels },
      series: dSeries
    };
    this.chartDaily?.updateOptions({ xaxis: { ...this.dailyChartOptions.xaxis, categories: dailyLabels } }, false, false);
    this.chartDaily?.updateSeries(dSeries, true);

    // 4. Pasajeros por día
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

    // 5. Pasajeros por canal (donut)
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

    // 6. Confirmación de viaje
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

    // 7. Reservas grupales vs. privadas
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

    // 8. Top destinos
    const occ = Array.isArray(res.occupancy) ? res.occupancy : [];
    const occCats = occ.map((d: any) => d.nombre);
    const occData = occ.map((d: any) => Number(d.pasajeros || 0));
    this.hasOccupancyData = occData.some((v: number) => v > 0);

    const oSeries = [{ name: 'Pasajeros', data: this.hasOccupancyData ? occData : [] }];
    this.occupancyChartOptions = {
      ...this.occupancyChartOptions,
      xaxis: { ...this.occupancyChartOptions.xaxis, categories: occCats },
      series: oSeries
    };
    this.chartOccupancy?.updateOptions({ xaxis: { ...this.occupancyChartOptions.xaxis, categories: occCats } }, false, false);
    this.chartOccupancy?.updateSeries(oSeries, true);

    this.cdr.detectChanges();
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
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadData(false), 180);
  }

  setTodayRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const t = this.toDateStr(new Date());
    this.startDate = t; this.endDate = t;
    this.syncPickers(); this.loadData(false);
  }

  setTomorrowRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const t = this.tomorrowValue();
    this.startDate = t; this.endDate = t;
    this.syncPickers(); this.loadData(false);
  }

  setNextSevenDaysRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 6);
    this.startDate = this.toDateStr(start);
    this.endDate = this.toDateStr(end);
    this.syncPickers();
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
  hasAnyActivity(): boolean  { return this.totalReservas > 0 || this.totalPasajeros > 0 || this.totalIngresos > 0; }

  getOperationVolumeLabel(): string {
    if (this.totalPasajeros >= 100) return 'Alto';
    if (this.totalPasajeros >= 30)  return 'Medio';
    if (this.totalPasajeros > 0)    return 'Bajo';
    return 'Sin operación';
  }

  getOperationVolumeClass(): string {
    if (this.totalPasajeros >= 100) return 'high';
    if (this.totalPasajeros >= 30)  return 'medium';
    if (this.totalPasajeros > 0)    return 'low';
    return 'none';
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
    if (id === 'resumen' || id === 'viaje' || id === 'ingresos' || id === 'comercial') {
      this.activeSection = id;
      this.cdr.markForCheck();
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  private observeSections(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.sectionObserver?.disconnect();
    this.sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const id = visible?.target.id;
      if (id === 'resumen' || id === 'viaje' || id === 'ingresos' || id === 'comercial') {
        this.activeSection = id;
        this.cdr.markForCheck();
      }
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, .15, .35] });

    for (const id of ['resumen', 'viaje', 'ingresos', 'comercial']) {
      const element = document.getElementById(id);
      if (element) this.sectionObserver.observe(element);
    }
  }
}
