/** Fuso padrão do estabelecimento (D-09). */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Zonas IANA do Brasil aceitas para a instância (D-09), filtradas pelas que o runtime conhece.
 * Ampliar exige decisão: os produtos tratam datas civis no fuso do estabelecimento (COM-023).
 */
const BRAZIL = [
  "America/Araguaina",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Eirunepe",
  "America/Fortaleza",
  "America/Maceio",
  "America/Manaus",
  "America/Noronha",
  "America/Porto_Velho",
  "America/Recife",
  "America/Rio_Branco",
  "America/Santarem",
  "America/Sao_Paulo",
];

const known = new Set(Intl.supportedValuesOf("timeZone"));

export const SUPPORTED_TIMEZONES: readonly string[] = BRAZIL.filter((zone) => known.has(zone));

export const isSupportedTimezone = (zone: string) => SUPPORTED_TIMEZONES.includes(zone);
