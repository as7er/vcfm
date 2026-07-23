/**
 * Stable, fictional football-world branding.
 *
 * Internal country/league IDs remain unchanged for save compatibility. The
 * display data below is deliberately independent of real competition brands.
 */

export const COUNTRY_BRANDING = Object.freeze({
  crownland: {
    id: "crownland",
    countryCode: "ENG",
    nameZh: "英格兰",
    nameEn: "England",
    shortName: "ENG",
    cupNameZh: "英格兰全国杯",
    cupNameEn: "England National Cup",
  },
  solara: {
    id: "solara",
    countryCode: "ESP",
    nameZh: "西班牙",
    nameEn: "Spain",
    shortName: "ESP",
    cupNameZh: "西班牙全国杯",
    cupNameEn: "Spain National Cup",
  },
  belladoro: {
    id: "belladoro",
    countryCode: "ITA",
    nameZh: "意大利",
    nameEn: "Italy",
    shortName: "ITA",
    cupNameZh: "意大利全国杯",
    cupNameEn: "Italy National Cup",
  },
  eisenmark: {
    id: "eisenmark",
    countryCode: "GER",
    nameZh: "德国",
    nameEn: "Germany",
    shortName: "GER",
    cupNameZh: "德国全国杯",
    cupNameEn: "Germany National Cup",
  },
  lumera: {
    id: "lumera",
    countryCode: "FRA",
    nameZh: "法国",
    nameEn: "France",
    shortName: "FRA",
    cupNameZh: "法国全国杯",
    cupNameEn: "France National Cup",
  },
});

export const LEAGUE_BRANDING = Object.freeze({
  1: { id: 1, countryId: "crownland", countryCode: "ENG", tier: 1, nameZh: "英格兰超级联赛", nameEn: "England Premier Division", shortName: "EPD" },
  2: { id: 2, countryId: "crownland", countryCode: "ENG", tier: 2, nameZh: "英格兰甲级联赛", nameEn: "England First Division", shortName: "EFD" },
  3: { id: 3, countryId: "crownland", countryCode: "ENG", tier: 3, nameZh: "英格兰乙级联赛", nameEn: "England Second Division", shortName: "ESD" },
  4: { id: 4, countryId: "solara", countryCode: "ESP", tier: 1, nameZh: "西班牙甲级联赛", nameEn: "Spanish First Division", shortName: "SFD" },
  5: { id: 5, countryId: "solara", countryCode: "ESP", tier: 2, nameZh: "西班牙乙级联赛", nameEn: "Spanish Second Division", shortName: "SSD" },
  6: { id: 6, countryId: "eisenmark", countryCode: "GER", tier: 1, nameZh: "德国甲级联赛", nameEn: "German First Division", shortName: "GFD" },
  7: { id: 7, countryId: "eisenmark", countryCode: "GER", tier: 2, nameZh: "德国乙级联赛", nameEn: "German Second Division", shortName: "GSD" },
  8: { id: 8, countryId: "belladoro", countryCode: "ITA", tier: 1, nameZh: "意大利甲级联赛", nameEn: "Italian First Division", shortName: "IFD" },
  9: { id: 9, countryId: "belladoro", countryCode: "ITA", tier: 2, nameZh: "意大利乙级联赛", nameEn: "Italian Second Division", shortName: "ISD" },
  10: { id: 10, countryId: "lumera", countryCode: "FRA", tier: 1, nameZh: "法国甲级联赛", nameEn: "French First Division", shortName: "FFD" },
  11: { id: 11, countryId: "lumera", countryCode: "FRA", tier: 2, nameZh: "法国乙级联赛", nameEn: "French Second Division", shortName: "FSD" },
});

export const COUNTRY_ID_BY_CODE = Object.freeze(
  Object.fromEntries(Object.values(COUNTRY_BRANDING).map((country) => [country.countryCode, country.id]))
);

/** Exact-name guard for combinations that the generic nationality pools can form. */
export const REAL_PLAYER_NAME_REPLACEMENTS = Object.freeze({
  "Park Ji-sung": "Park Ji-won",
  "Thomas Muller": "Thomas Falk",
  "Paolo Rossi": "Paolo Rinaldi",
  "Bruno Fernandes": "Bruno Ferraz",
  "Bernardo Silva": "Bernardo Silveira",
  "Diogo Costa": "Diogo Costela",
  "Rui Costa": "Rui Costeira",
  "Thiago Silva": "Thiago Silveira",
  "Gabriel Jesus": "Gabriel Junqueira",
  "Emiliano Martinez": "Emiliano Martez",
  "Julian Alvarez": "Julian Alvero",
  "Mateo Kovacic": "Mateo Kovarek",
  "Luka Modric": "Luka Modran",
  "Luis Suarez": "Luis Suaredo",
  "Edinson Cavani": "Edinson Cavaro",
  "Federico Valverde": "Federico Valderez",
  "James Rodriguez": "James Rodero",
  "Luis Diaz": "Luis Dazaro",
  "Davinson Sanchez": "Davinson Sandez",
  "Javier Hernandez": "Javier Hernal",
  "Didier Drogba": "Didier Dromba",
  "Yaya Toure": "Yaya Tourel",
  "Kolo Toure": "Kolo Tourel",
  "Wilfried Zaha": "Wilfried Zada",
  "Serge Aurier": "Serge Auvier",
  "Eric Bailly": "Eric Baillon",
  "Franck Kessie": "Franck Kessan",
  "Nicolas Pepe": "Nicolas Pelet",
  "Salomon Kalou": "Salomon Kalet",
  "Achraf Hakimi": "Achraf Hakimel",
  "Hakim Ziyech": "Hakim Zayel",
  "Noussair Mazraoui": "Noussair Mazrane",
  "Youssef En-Nesyri": "Youssef En-Nasir",
  "Romain Saiss": "Romain Saisel",
  "Sofiane Boufal": "Sofiane Bourel",
  "Robert Lewandowski": "Robert Lewanski",
  "Piotr Zielinski": "Piotr Zielarek",
  "Dries Mertens": "Dries Mertenel",
  "Xherdan Shaqiri": "Xherdan Shakrel",
  "Burak Yilmaz": "Burak Yilmer",
  "Dusan Tadic": "Dusan Tader",
  "Aleksandar Mitrovic": "Aleksandar Mitren",
  "Filip Kostic": "Filip Kostar",
  "Andriy Shevchenko": "Andriy Shevarenko",
  "Andriy Yarmolenko": "Andriy Yarenko",
  "Oleksandr Zinchenko": "Oleksandr Zarenko",
  "Mykhailo Mudryk": "Mykhailo Mudren",
});

export function fictionalizePlayerName(name) {
  return REAL_PLAYER_NAME_REPLACEMENTS[name] || name;
}

export function countryBranding(countryId) {
  return COUNTRY_BRANDING[countryId] || null;
}

export function leagueBranding(leagueId) {
  return LEAGUE_BRANDING[leagueId] || null;
}

export function localizedName(entry, lang = "zh") {
  if (!entry) return "";
  return lang === "en" ? entry.nameEn || entry.nameZh || "" : entry.nameZh || entry.nameEn || "";
}

export function localizedClubName(club, lang = "zh") {
  if (!club) return "";
  return localizedName({ nameZh: club.nameZh || club.name, nameEn: club.nameEn || club.name }, lang);
}

/** Apply the latest display name without touching historical IDs or results. */
export function applyClubBranding(club, branding, lang = "zh") {
  if (!club || !branding) return club;
  club.nameEn = branding.nameEn;
  club.nameZh = branding.nameZh;
  club.shortName = branding.shortName;
  club.short = branding.shortName;
  club.countryId = branding.countryId;
  club.countryCode = branding.countryCode;
  club.leagueId = club.division || branding.leagueId;
  club.city = { en: branding.cityEn, zh: branding.cityZh };
  club.stadiumName = { en: branding.stadiumEn, zh: branding.stadiumZh };
  club.colors = { ...branding.colors };
  club.crest = { ...branding.crest };
  club.branding = {
    ...branding,
    colors: { ...branding.colors },
    crest: { ...branding.crest },
  };
  club.name = localizedClubName(club, lang);
  return club;
}

export function applyWorldClubBranding(world, clubBrandingById, lang = "zh") {
  let migrated = 0;
  for (const club of world?.clubs || []) {
    const branding = clubBrandingById?.[club.id];
    if (!branding) continue;
    applyClubBranding(club, branding, lang);
    migrated++;
  }
  const managed = world?.clubs?.find((club) => club.id === world.userClubId);
  if (managed) {
    world.countryId = managed.countryId;
    world.countryCode = managed.countryCode;
  }
  return migrated;
}

export function isCssColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function isValidShortName(value) {
  return typeof value === "string" && /^[A-Z]{2,4}$/.test(value);
}
