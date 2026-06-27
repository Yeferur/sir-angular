import { CommonModule }         from '@angular/common';
import { Component, ViewChild, inject, OnInit, AfterViewInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule }          from '@angular/forms';
import { forkJoin, finalize, catchError, of } from 'rxjs';
import { DatepickerComponent } from '../../shared/datepicker/datepicker';

import { DashboardService, DashboardFilters } from '../../services/Dashboard/Dashboard.service';
import { SirAlertService }      from '../../services/Alertas/alert.service';

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
const AXIS  = '#6b7280';
const GRID  = '#1f2937';

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
  return { borderColor: GRID, strokeDashArray: 4, xaxis: { lines: { show: showX } }, yaxis: { lines: { show: showY } } };
}

function axisStyle(): any {
  return { style: { colors: AXIS, fontSize: '11px', fontFamily: FONT } };
}

// ─── Componente ───────────────────────────────────────────────────────────────
@Component({
  selector:    'app-dashboard',
  standalone:  true,
  imports:     [CommonModule, NgApexchartsModule, FormsModule, DatepickerComponent],
  templateUrl: './dashboard.html',
  styleUrls:   ['./dashboard.css']
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {

  private svc   = inject(DashboardService);
  private alert = inject(SirAlertService);
  private cdr   = inject(ChangeDetectorRef);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  totalReservas       = 0;
  totalPasajeros      = 0;
  totalIngresos       = 0;    // bruto
  totalIngresosNetos  = 0;    // neto
  totalTransfers      = 0;

  // ── Filtros ───────────────────────────────────────────────────────────────
  startDate  = '';
  endDate    = '';
  tours:      TourOption[] = [];
  selectedTourId: number | null = null;

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
  @ViewChild('chartOccupancy') chartOccupancy?: ChartComponent;

  // ── Chart options ─────────────────────────────────────────────────────────
  incomeChartOptions:    Partial<ChartOptions> | any = {};
  netIncomeChartOptions: Partial<ChartOptions> | any = {};
  dailyChartOptions:     Partial<ChartOptions> | any = {};
  paxChartOptions:       Partial<ChartOptions> | any = {};
  channelChartOptions:   Partial<ChartOptions> | any = {};
  occupancyChartOptions: Partial<ChartOptions> | any = {};

  // ── Flags ─────────────────────────────────────────────────────────────────
  isInitialLoading = true;
  isRefreshing     = false;
  hasIncomeData    = false;
  hasNetIncomeData = false;
  hasDailyData     = false;
  hasPaxData       = false;
  hasChannelData   = false;
  hasOccupancyData = false;

  private viewReady          = false;
  private lastResponse: any  = null;
  private refreshTimer:   ReturnType<typeof setTimeout> | null = null;
  private reqId              = 0;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ngOnInit() {
    const tomorrow = this.tomorrowValue();
    this.startDate = tomorrow;
    this.endDate   = tomorrow;
    this.initCharts();
    this.loadTours();
    this.loadData(true);
  }

  ngAfterViewInit() {
    this.viewReady = true;
    this.syncPickers();
    if (this.lastResponse) { this.applyAll(this.lastResponse); this.reflow(); }
  }

  ngOnDestroy() { if (this.refreshTimer) clearTimeout(this.refreshTimer); }

  // ── Tours ─────────────────────────────────────────────────────────────────
  private loadTours() {
    // Ajusta la ruta según tu ToursService real
    (this.svc as any).getTours?.().pipe(catchError(() => of([]))).subscribe((list: TourOption[]) => {
      this.tours = list;
      this.cdr.detectChanges();
    });
  }

  onTourChange(tourId: number | null) {
    this.selectedTourId = tourId;
    this.scheduleRefresh();
  }

  // ── Init charts ───────────────────────────────────────────────────────────
  private initCharts() {

    // ── 1. Ingresos Totales (bruto) — área anual ─────────────────────────
    this.incomeChartOptions = {
      series: [{ name: 'Ingresos brutos', data: Array(12).fill(0) }],
      chart: {
        id: 'income-bruto', type: 'area', height: 300, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 600 },
        redrawOnParentResize: true, redrawOnWindowResize: true,
        dropShadow: { enabled: true, color: C_GOLD, top: 8, blur: 14, opacity: 0.1 }
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2.5, colors: [C_GOLD] },
      xaxis: {
        categories: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
        labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false },
        crosshairs: { stroke: { color: C_GOLD, width: 1, dashArray: 3 } }
      },
      yaxis: { labels: { ...axisStyle(), formatter: COP_COMPACT } },
      fill: {
        type: 'gradient',
        gradient: { colorStops: [
          { offset: 0, color: C_GOLD, opacity: 0.28 },
          { offset: 65, color: C_GOLD, opacity: 0.05 },
          { offset: 100, color: C_GOLD, opacity: 0 }
        ]}
      },
      colors: [C_GOLD],
      grid: grid(),
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: COP } },
      markers: { size: 0, hover: { size: 5 } }
    };

    // ── 2. Ingresos Netos — área anual, verde ────────────────────────────
    this.netIncomeChartOptions = {
      series: [{ name: 'Ingresos netos', data: Array(12).fill(0) }],
      chart: {
        id: 'income-neto', type: 'area', height: 300, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 600 },
        redrawOnParentResize: true, redrawOnWindowResize: true,
        dropShadow: { enabled: true, color: C_GREEN, top: 8, blur: 14, opacity: 0.1 }
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2.5, colors: [C_GREEN] },
      xaxis: {
        categories: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
        labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false },
        crosshairs: { stroke: { color: C_GREEN, width: 1, dashArray: 3 } }
      },
      yaxis: { labels: { ...axisStyle(), formatter: COP_COMPACT } },
      fill: {
        type: 'gradient',
        gradient: { colorStops: [
          { offset: 0, color: C_GREEN, opacity: 0.28 },
          { offset: 65, color: C_GREEN, opacity: 0.05 },
          { offset: 100, color: C_GREEN, opacity: 0 }
        ]}
      },
      colors: [C_GREEN],
      grid: grid(),
      tooltip: { theme: 'dark', style: { fontFamily: FONT }, y: { formatter: COP } },
      markers: { size: 0, hover: { size: 5 } }
    };

    // ── 3. Ingresos bruto vs neto por día (rango) — columnas agrupadas ───
    this.dailyChartOptions = {
      series: [
        { name: 'Bruto', data: [] },
        { name: 'Neto',  data: [] }
      ],
      chart: {
        id: 'daily-income', type: 'bar', height: 280, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 500 },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: false, borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '55%', grouped: true }
      },
      colors: [C_GOLD, C_GREEN],
      dataLabels: { enabled: false },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      xaxis: { categories: [], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { ...axisStyle(), formatter: COP_COMPACT } },
      fill: { opacity: 0.88 },
      grid: grid(),
      legend: {
        position: 'top', horizontalAlign: 'right',
        labels: { colors: '#9ca3af' }, fontSize: '12px', fontFamily: FONT,
        markers: { size: 7 }
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
        animations: { enabled: true, easing: 'easeinout', speed: 500 },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: false, borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '48%' }
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

    // ── 5. Pasajeros por canal — donut ────────────────────────────────────
    this.channelChartOptions = {
      series: [],
      chart: {
        id: 'channel-pax', type: 'donut', height: 310,
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 600 },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      labels: [],
      colors: DIST_PALETTE,
      legend: {
        position: 'bottom', labels: { colors: '#9ca3af' },
        fontSize: '12px', fontFamily: FONT, itemMargin: { horizontal: 8 }
      },
      dataLabels: {
        enabled: true,
        style: { fontSize: '12px', fontFamily: FONT, fontWeight: 600, colors: ['#fff'] },
        dropShadow: { enabled: true, blur: 4, opacity: 0.4 }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              name:  { show: true, color: '#9ca3af', fontSize: '13px' },
              value: { show: true, color: '#fff', fontSize: '22px', fontWeight: 700,
                       formatter: (v: string) => v },
              total: {
                show: true, label: 'Total pax', color: '#9ca3af', fontSize: '13px', fontWeight: 600,
                formatter: (w: any) => w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0)
              }
            }
          }
        }
      },
      stroke: { show: false },
      tooltip: { theme: 'dark', style: { fontFamily: FONT } }
    };

    // ── 6. Top destinos — barras horizontales ─────────────────────────────
    this.occupancyChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'occupancy', type: 'bar', height: 310, toolbar: { show: false },
        fontFamily: FONT, background: BG,
        animations: { enabled: true, easing: 'easeinout', speed: 600 },
        redrawOnParentResize: true, redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 5, borderRadiusApplication: 'end', barHeight: '62%', distributed: true }
      },
      colors: DIST_PALETTE,
      dataLabels: {
        enabled: true, textAnchor: 'start', offsetX: 4,
        style: { fontSize: '11px', fontFamily: FONT, fontWeight: 600, colors: ['#fff'] }
      },
      xaxis: { categories: [], labels: axisStyle(), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: '#d1d5db', fontSize: '12px', fontFamily: FONT }, maxWidth: 160 } },
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
      income:   this.svc.getIncomeHistory(new Date().getFullYear(), f).pipe(catchError(() => { partial = true; return of({ bruto: Array(12).fill(0), neto: Array(12).fill(0) }); })),
      daily:    this.svc.getDailyIncome(f).pipe(catchError(() => { partial = true; return of([]); })),
      dailyPax: this.svc.getDailyPassengers(f).pipe(catchError(() => { partial = true; return of([]); })),
      channels: this.svc.getPassengersByChannel(f).pipe(catchError(() => { partial = true; return of([]); })),
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
          this.hasPaxData = this.hasChannelData = this.hasOccupancyData = false;
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
    this.hasIncomeData    = brutoArr.some((v: number) => v > 0);
    this.hasNetIncomeData = netoArr.some( (v: number) => v > 0);

    const bSeries = [{ name: 'Ingresos brutos', data: brutoArr }];
    const nSeries = [{ name: 'Ingresos netos',  data: netoArr  }];
    this.incomeChartOptions    = { ...this.incomeChartOptions,    series: bSeries };
    this.netIncomeChartOptions = { ...this.netIncomeChartOptions, series: nSeries };
    this.chartIncome?.updateSeries(bSeries, true);
    this.chartNetIncome?.updateSeries(nSeries, true);

    // 3. Ingresos diarios bruto + neto
    const daily = Array.isArray(res.daily) ? res.daily : [];
    const dailyLabels = daily.map((d: any) => this.fmtDate(d.fecha));
    const dailyBruto  = daily.map((d: any) => Number(d.bruto || 0));
    const dailyNeto   = daily.map((d: any) => Number(d.neto  || 0));
    this.hasDailyData = dailyBruto.some((v: number) => v > 0) || dailyNeto.some((v: number) => v > 0);

    const dSeries = [{ name: 'Bruto', data: dailyBruto }, { name: 'Neto', data: dailyNeto }];
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

    this.channelChartOptions = { ...this.channelChartOptions, labels: chLabels, series: this.hasChannelData ? chData : [] };
    if (this.chartChannel) {
      this.chartChannel.updateOptions({ labels: chLabels }, false, false);
      this.chartChannel.updateSeries(this.hasChannelData ? chData : [], true);
    }

    // 6. Top destinos
    const occ = Array.isArray(res.occupancy) ? res.occupancy : [];
    const occCats = occ.map((d: any) => d.Nombre_Tour);
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

  // ── Computed ──────────────────────────────────────────────────────────────
  isTodayRange(): boolean    { const t = this.toDateStr(new Date()); return this.startDate === t && this.endDate === t; }
  isTomorrowRange(): boolean { const t = this.tomorrowValue(); return this.startDate === t && this.endDate === t; }
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
}
