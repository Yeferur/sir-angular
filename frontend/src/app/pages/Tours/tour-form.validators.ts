import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';

export function tourPlanValidityValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const permanent = control.get('esPermanente')?.value !== false;
    const start = String(control.get('Fecha_Inicio')?.value || '');
    const end = String(control.get('Fecha_Fin')?.value || '');

    if (permanent) return null;
    if (!start || !end) return { vigenciaIncompleta: true };
    if (end < start) return { vigenciaInvalida: true };
    return null;
  };
}

export function tourAvailabilityValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const form = control as FormGroup;
    if (!form?.get) return null;

    const mode = form.get('Modo_Disponibilidad')?.value;
    if (mode !== 'TODO_EL_ANO') return null;

    const days = form.get('dias_base') as FormGroup | null;
    if (!days) return null;
    const selected = Object.keys(days.controls).some((key) => !!days.get(key)?.value);
    return selected ? null : { diasBaseVacios: true };
  };
}
