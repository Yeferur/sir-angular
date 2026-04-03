import { Injectable, inject } from '@angular/core';
import { DynamicIslandGlobalService } from '../DynamicNavbar/global';

export enum TourId {
  RIO_CLARO = 1,
  HACIENDA_NAPOLES = 5,
}

export type TipoPasajero = 'ADULTO' | 'NINO' | 'INFANTE';

interface TourPolicy {
  allowInfantes: boolean;
  alerts?: Partial<Record<TipoPasajero, { key: string; title: string; message: string; type: 'info' | 'warning' | 'error' }>>;
}

const TOUR_POLICIES: Record<number, TourPolicy> = {
  [TourId.RIO_CLARO]: {
    allowInfantes: false,
    alerts: {
      NINO: {
        key: 'rioClaroNino',
        title: 'Recuerda',
        message: 'Para este tour, los niños deben tener 5+ años.',
        type: 'info'
      }
    }
  },
  [TourId.HACIENDA_NAPOLES]: {
    allowInfantes: true,
    alerts: {
      NINO: {
        key: 'napolesNino',
        title: 'Política de Niños',
        message: 'Niños ≥5 van como ADULTOS.',
        type: 'info'
      },
      INFANTE: {
        key: 'napolesInfante',
        title: 'Política de Infantes',
        message: 'Infantes >1 año van como NIÑOS.',
        type: 'info'
      }
    }
  }
};

@Injectable({ providedIn: 'root' })
export class TourRulesService {
  private navbar = inject(DynamicIslandGlobalService);
  private alertasMostradas = new Set<string>();

  allowsPassengerType(tourId: number, tipo: TipoPasajero): boolean {
    const policy = TOUR_POLICIES[tourId];
    if (!policy) return true;

    if (tipo === 'INFANTE') return policy.allowInfantes;
    return true;
  }

  adaptPassengerType(tourId: number, tipo: TipoPasajero): TipoPasajero {
    if (tourId === TourId.HACIENDA_NAPOLES) {
      if (tipo === 'NINO') return 'ADULTO';
      if (tipo === 'INFANTE') return 'NINO';
    }
    return tipo;
  }

  evaluateAlertsForPassenger(tourId: number, tipo: TipoPasajero): void {
    const policy = TOUR_POLICIES[tourId];
    if (!policy || !policy.alerts) return;

    const alertConfig = policy.alerts[tipo];
    if (alertConfig) {
      if (!this.alertasMostradas.has(alertConfig.key)) {
        this.alertasMostradas.add(alertConfig.key);
        this.navbar.alert.set({
          type: alertConfig.type,
          title: alertConfig.title,
          message: alertConfig.message,
          autoClose: true
        });
      }
    }
  }

  resetSession(): void {
    this.alertasMostradas.clear();
  }
}
