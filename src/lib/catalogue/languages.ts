export type CatalogueLanguageOption = {
  code: string;
  label: string;
  region: string;
  regionLabel: string;
  tcgdexCode?: string;
  aliases: string[];
};

export const CATALOGUE_LANGUAGE_OPTIONS: CatalogueLanguageOption[] = [
  {
    code: "en",
    label: "English",
    region: "international",
    regionLabel: "International",
    tcgdexCode: "en",
    aliases: ["english", "eng", "en", "international"],
  },
  {
    code: "ja",
    label: "Japanese",
    region: "jp",
    regionLabel: "Japan",
    tcgdexCode: "ja",
    aliases: ["japanese", "japan", "jp", "ja", "nihongo", "日本語"],
  },
  {
    code: "zh-tw",
    label: "Traditional Chinese",
    region: "tw-hk",
    regionLabel: "Taiwan / Hong Kong",
    tcgdexCode: "zh-tw",
    aliases: ["traditional chinese", "chinese traditional", "zh-tw", "zhtw", "taiwan", "hong kong", "繁體中文", "繁体中文"],
  },
  {
    code: "zh-cn",
    label: "Simplified Chinese",
    region: "cn",
    regionLabel: "Mainland China",
    tcgdexCode: "zh-cn",
    aliases: ["simplified chinese", "chinese simplified", "zh-cn", "zhcn", "mainland china", "china", "简体中文", "簡體中文"],
  },
  {
    code: "ko",
    label: "Korean",
    region: "kr",
    regionLabel: "South Korea",
    tcgdexCode: "ko",
    aliases: ["korean", "korea", "south korea", "kr", "ko", "한국어"],
  },
];

const additionalLotLanguages: CatalogueLanguageOption[] = [
  {
    code: "de",
    label: "German",
    region: "international",
    regionLabel: "International",
    aliases: ["german", "deutsch", "de"],
  },
  {
    code: "fr",
    label: "French",
    region: "international",
    regionLabel: "International",
    aliases: ["french", "francais", "français", "fr"],
  },
  {
    code: "it",
    label: "Italian",
    region: "international",
    regionLabel: "International",
    aliases: ["italian", "italiano", "it"],
  },
  {
    code: "es",
    label: "Spanish",
    region: "international",
    regionLabel: "International",
    aliases: ["spanish", "espanol", "español", "es"],
  },
  {
    code: "pt",
    label: "Portuguese",
    region: "international",
    regionLabel: "International",
    aliases: ["portuguese", "portugues", "português", "pt"],
  },
  {
    code: "other",
    label: "Other",
    region: "other",
    regionLabel: "Other",
    aliases: ["other"],
  },
];

export const LOT_LANGUAGE_OPTIONS = [
  ...CATALOGUE_LANGUAGE_OPTIONS,
  ...additionalLotLanguages,
];

export function catalogueLanguageLabel(code?: string | null) {
  return languageOptionForCode(code)?.label ?? (code ? titleCaseLanguage(code) : "Unknown");
}

export function catalogueRegionForLanguage(code?: string | null) {
  return languageOptionForCode(code)?.region ?? "international";
}

export function catalogueRegionLabel(region?: string | null) {
  const normalized = region?.trim().toLowerCase();

  if (!normalized) {
    return "International";
  }

  const match = LOT_LANGUAGE_OPTIONS.find((option) => option.region === normalized);

  if (match) {
    return match.regionLabel;
  }

  const labels: Record<string, string> = {
    cn: "Mainland China",
    international: "International",
    jp: "Japan",
    kr: "South Korea",
    other: "Other",
    "tw-hk": "Taiwan / Hong Kong",
  };

  return labels[normalized] ?? titleCaseLanguage(normalized);
}

export function catalogueLanguageSearchAliases(code?: string | null) {
  const option = languageOptionForCode(code);

  if (!option) {
    return code ? [code] : [];
  }

  return uniqueLanguageValues([option.code, option.label, option.regionLabel, ...option.aliases]);
}

export function catalogueLanguageCodesForSearch(value?: string | null) {
  const normalized = normalizeLanguageValue(value);

  if (!normalized) {
    return [];
  }

  return LOT_LANGUAGE_OPTIONS
    .filter((option) =>
      [option.code, option.label, option.region, option.regionLabel, ...option.aliases]
        .some((entry) => normalizeLanguageValue(entry).includes(normalized)),
    )
    .map((option) => option.code);
}

export function normalizeCatalogueLanguageFilter(value?: string | null) {
  const normalized = normalizeLanguageValue(value);

  if (!normalized || normalized === "all") {
    return "all";
  }

  return languageOptionForCode(normalized)?.code ?? normalized;
}

export function languageLabelToCode(value?: string | null) {
  const normalized = normalizeLanguageValue(value);

  if (!normalized) {
    return "en";
  }

  return languageOptionForCode(normalized)?.code ?? normalized;
}

export function languageCodeToLotLabel(value?: string | null) {
  return catalogueLanguageLabel(value);
}

export function supportedTcgdexLanguages() {
  return CATALOGUE_LANGUAGE_OPTIONS
    .filter((option) => Boolean(option.tcgdexCode))
    .map((option) => ({
      code: option.code,
      label: option.label,
      region: option.region,
      tcgdexCode: option.tcgdexCode!,
    }));
}

function languageOptionForCode(value?: string | null) {
  const normalized = normalizeLanguageValue(value);

  if (!normalized) {
    return undefined;
  }

  return LOT_LANGUAGE_OPTIONS.find((option) =>
    [option.code, option.label, option.region, option.regionLabel, ...option.aliases]
      .some((entry) => normalizeLanguageValue(entry) === normalized),
  );
}

function normalizeLanguageValue(value?: string | null) {
  return value?.trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, " ") ?? "";
}

function titleCaseLanguage(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueLanguageValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
