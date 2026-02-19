import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class DashboardService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/dashboard`;

    getStats(filters: any = {}): Observable<any> {
        let params = new HttpParams();
        if (filters.startDate) params = params.set('startDate', filters.startDate);
        if (filters.endDate) params = params.set('endDate', filters.endDate);
        return this.http.get<any>(`${this.apiUrl}/stats`, { params });
    }

    getIncomeHistory(year?: number): Observable<number[]> {
        let params = new HttpParams();
        if (year) params = params.set('year', year.toString());
        return this.http.get<number[]>(`${this.apiUrl}/income-history`, { params });
    }

    getPassengerDistribution(filters: any = {}): Observable<any[]> {
        let params = new HttpParams();
        if (filters.startDate) params = params.set('startDate', filters.startDate);
        if (filters.endDate) params = params.set('endDate', filters.endDate);
        return this.http.get<any[]>(`${this.apiUrl}/passengers-distribution`, { params });
    }

    getTourOccupancy(filters: any = {}): Observable<any[]> {
        let params = new HttpParams();
        if (filters.startDate) params = params.set('startDate', filters.startDate);
        if (filters.endDate) params = params.set('endDate', filters.endDate);
        return this.http.get<any[]>(`${this.apiUrl}/tour-occupancy`, { params });
    }
}
