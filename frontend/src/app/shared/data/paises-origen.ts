export interface PaisOrigenOption {
  value: string;
  aliases?: string[];
}

export const PAISES_ORIGEN_OPTIONS: PaisOrigenOption[] = [
  { value: 'COLOMBIA', aliases: ['col'] },
  { value: 'VENEZUELA', aliases: ['ven', 'vzla'] },
  { value: 'ECUADOR', aliases: ['ecu'] },
  { value: 'PERÚ', aliases: ['peru'] },
  { value: 'CHILE', aliases: ['chi'] },
  { value: 'ARGENTINA', aliases: ['arg'] },
  { value: 'BRASIL', aliases: ['bra', 'brazil'] },
  { value: 'URUGUAY', aliases: ['uru'] },
  { value: 'PARAGUAY', aliases: ['par'] },
  { value: 'BOLIVIA', aliases: ['bol'] },
  { value: 'MÉXICO', aliases: ['mex', 'mexico'] },
  { value: 'ESTADOS UNIDOS', aliases: ['usa', 'eeuu', 'eua', 'united states'] },
  { value: 'CANADÁ', aliases: ['canada'] },
  { value: 'ESPAÑA', aliases: ['esp', 'espana', 'spain'] },
  { value: 'FRANCIA', aliases: ['fra', 'france'] },
  { value: 'ALEMANIA', aliases: ['ger', 'germany'] },
  { value: 'ITALIA', aliases: ['ita', 'italy'] },
  { value: 'REINO UNIDO', aliases: ['uk', 'gran bretana', 'great britain', 'inglaterra'] },
  { value: 'PORTUGAL', aliases: ['por'] },
  { value: 'PAÍSES BAJOS', aliases: ['paises bajos', 'holanda', 'netherlands', 'pais'] },
  { value: 'SUIZA', aliases: ['sui', 'switzerland'] },
  { value: 'BÉLGICA', aliases: ['bel', 'belgica', 'belgium'] },
  { value: 'AUSTRALIA', aliases: ['aus'] },
  { value: 'CHINA', aliases: ['chi', 'prc'] },
  { value: 'JAPÓN', aliases: ['japon', 'japan'] },
  { value: 'COREA DEL SUR', aliases: ['corea', 'korea', 'south korea'] },
  { value: 'INDIA', aliases: ['ind'] },
  { value: 'PANAMÁ', aliases: ['panama'] },
  { value: 'COSTA RICA', aliases: ['costa rica'] },
  { value: 'REPÚBLICA DOMINICANA', aliases: ['republica dominicana', 'dominicana', 'rd'] },
  { value: 'CUBA', aliases: ['cub'] },
  { value: 'PUERTO RICO', aliases: ['pr', 'puerto rico'] },
  { value: 'GUATEMALA', aliases: ['gua'] },
  { value: 'HONDURAS', aliases: ['hon'] },
  { value: 'EL SALVADOR', aliases: ['salvador'] },
  { value: 'NICARAGUA', aliases: ['nica'] },
];

export function normalizarBusquedaPais(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function buscarPaisesOrigen(query: unknown, limit = 8): string[] {
  const normalizedQuery = normalizarBusquedaPais(query);
  if (!normalizedQuery) {
    return PAISES_ORIGEN_OPTIONS.slice(0, limit).map((item) => item.value);
  }

  return PAISES_ORIGEN_OPTIONS
    .filter((item) => {
      const normalizedValue = normalizarBusquedaPais(item.value);
      if (normalizedValue.includes(normalizedQuery)) return true;
      return (item.aliases ?? []).some((alias) => normalizarBusquedaPais(alias).includes(normalizedQuery));
    })
    .map((item) => item.value)
    .slice(0, limit);
}
