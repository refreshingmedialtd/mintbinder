import { GENERATED_POKEMON_NAME_ALIASES } from "./pokemon-name-aliases.generated.ts";

type PokemonNameAlias = {
  english: string;
  aliases: string[];
};

const POKEMON_NAME_ALIASES: PokemonNameAlias[] = [
  {
    english: "Charizard",
    aliases: ["Lizardon", "リザードン", "噴火龍", "喷火龙", "리자몽"],
  },
  {
    english: "Pikachu",
    aliases: ["ピカチュウ", "皮卡丘", "피카츄"],
  },
  {
    english: "Eevee",
    aliases: ["イーブイ", "伊布", "이브이"],
  },
  {
    english: "Umbreon",
    aliases: ["Blacky", "ブラッキー", "月亮伊布", "블래키"],
  },
  {
    english: "Espeon",
    aliases: ["Eifie", "エーフィ", "太陽伊布", "太阳伊布", "에브이"],
  },
  {
    english: "Sylveon",
    aliases: ["Nymphia", "ニンフィア", "仙子伊布", "님피아"],
  },
  {
    english: "Leafeon",
    aliases: ["Leafia", "リーフィア", "葉伊布", "叶伊布", "리피아"],
  },
  {
    english: "Glaceon",
    aliases: ["Glacia", "グレイシア", "冰伊布", "글레이시아"],
  },
  {
    english: "Vaporeon",
    aliases: ["Showers", "シャワーズ", "水伊布", "샤미드"],
  },
  {
    english: "Jolteon",
    aliases: ["Thunders", "サンダース", "雷伊布", "쥬피썬더"],
  },
  {
    english: "Flareon",
    aliases: ["Booster", "ブースター", "火伊布", "부스터"],
  },
  {
    english: "Mew",
    aliases: ["ミュウ", "夢幻", "梦幻", "뮤"],
  },
  {
    english: "Mewtwo",
    aliases: ["Mewtwo", "ミュウツー", "超夢", "超梦", "뮤츠"],
  },
  {
    english: "Rayquaza",
    aliases: ["Rayquaza", "レックウザ", "烈空坐", "레쿠쟈"],
  },
  {
    english: "Lugia",
    aliases: ["ルギア", "洛奇亞", "洛奇亚", "루기아"],
  },
  {
    english: "Ho-Oh",
    aliases: ["Houou", "ホウオウ", "鳳王", "凤王", "칠색조"],
  },
  {
    english: "Gengar",
    aliases: ["Gangar", "ゲンガー", "耿鬼", "팬텀"],
  },
  {
    english: "Gardevoir",
    aliases: ["Sirnight", "サーナイト", "沙奈朵", "가디안"],
  },
  {
    english: "Greninja",
    aliases: ["Gekkouga", "ゲッコウガ", "甲賀忍蛙", "甲贺忍蛙", "개굴닌자"],
  },
  {
    english: "Lucario",
    aliases: ["ルカリオ", "路卡利歐", "路卡利欧", "루카리오"],
  },
  {
    english: "Gyarados",
    aliases: ["Gyarados", "ギャラドス", "暴鯉龍", "暴鲤龙", "갸라도스"],
  },
  {
    english: "Dragonite",
    aliases: ["Kairyu", "カイリュー", "快龍", "快龙", "망나뇽"],
  },
  {
    english: "Blastoise",
    aliases: ["Kamex", "カメックス", "水箭龜", "水箭龟", "거북왕"],
  },
  {
    english: "Venusaur",
    aliases: ["Fushigibana", "フシギバナ", "妙蛙花", "이상해꽃"],
  },
  {
    english: "Magikarp",
    aliases: ["Koiking", "コイキング", "鯉魚王", "鲤鱼王", "잉어킹"],
  },
  {
    english: "Arceus",
    aliases: ["アルセウス", "阿爾宙斯", "阿尔宙斯", "아르세우스"],
  },
  {
    english: "Giratina",
    aliases: ["ギラティナ", "騎拉帝納", "骑拉帝纳", "기라티나"],
  },
  {
    english: "Dialga",
    aliases: ["ディアルガ", "帝牙盧卡", "帝牙卢卡", "디아루가"],
  },
  {
    english: "Palkia",
    aliases: ["パルキア", "帕路奇亞", "帕路奇亚", "펄기아"],
  },
  {
    english: "Darkrai",
    aliases: ["ダークライ", "達克萊伊", "达克莱伊", "다크라이"],
  },
  {
    english: "Latias",
    aliases: ["ラティアス", "拉帝亞斯", "拉帝亚斯", "라티아스"],
  },
  {
    english: "Latios",
    aliases: ["ラティオス", "拉帝歐斯", "拉帝欧斯", "라티오스"],
  },
  {
    english: "Zapdos",
    aliases: ["Thunder", "サンダー", "閃電鳥", "闪电鸟", "썬더"],
  },
  {
    english: "Moltres",
    aliases: ["Fire", "ファイヤー", "火焰鳥", "火焰鸟", "파이어"],
  },
  {
    english: "Articuno",
    aliases: ["Freezer", "フリーザー", "急凍鳥", "急冻鸟", "프리져"],
  },
  {
    english: "Snorlax",
    aliases: ["Kabigon", "カビゴン", "卡比獸", "卡比兽", "잠만보"],
  },
  {
    english: "Psyduck",
    aliases: ["Koduck", "コダック", "可達鴨", "可达鸭", "고라파덕"],
  },
  {
    english: "Slowpoke",
    aliases: ["Yadon", "ヤドン", "呆呆獸", "呆呆兽", "야돈"],
  },
  {
    english: "Meowth",
    aliases: ["Nyarth", "ニャース", "喵喵", "나옹"],
  },
  {
    english: "Deoxys",
    aliases: ["Deoxys", "デオキシス", "代歐奇希斯", "代欧奇希斯", "테오키스"],
  },
  {
    english: "Milotic",
    aliases: ["Milokaross", "ミロカロス", "美納斯", "美纳斯", "밀로틱"],
  },
];

export function catalogueNameAliasesForText(value?: string | null) {
  const normalized = normalizeAliasText(value);

  if (!normalized) {
    return [];
  }

  return uniqueAliasValues([
    ...POKEMON_NAME_ALIASES.flatMap((entry) => {
      const terms = [entry.english, ...entry.aliases];
      const matches = terms.some((term) => normalized.includes(normalizeAliasText(term)));

      return matches ? terms : [];
    }),
    ...generatedPokemonAliasesForText(value ?? ""),
  ]);
}

export function catalogueDisplayNameForText(value?: string | null) {
  return englishDisplayText(value, [
    ["かがやく", "Radiant "],
    ["輝く", "Radiant "],
    ["메가", "Mega "],
    ["メガ", "Mega "],
    ["超級", "Mega "],
    ["超级", "Mega "],
    ["ex", " ex"],
    ["EX", " EX"],
    ["VSTAR", " VSTAR"],
    ["VMAX", " VMAX"],
  ]);
}

export function catalogueDisplayCardForText(
  value?: string | null,
  options?: { number?: string | null; supertype?: string | null },
) {
  const translated = catalogueDisplayNameForText(value);

  if (!value || !hasInternationalScript(value)) {
    return translated;
  }

  if (translated && !hasInternationalScript(translated)) {
    return translated;
  }

  const type = options?.supertype?.toLowerCase() === "trainer"
    ? "Trainer card"
    : options?.supertype?.toLowerCase() === "energy"
      ? "Energy card"
      : "Pokemon card";
  const number = options?.number?.trim();

  return number ? `${type} ${number}` : type;
}

const INTERNATIONAL_SET_DISPLAY_NAMES = new Map<string, string>([
  // Japanese catalogue
  ["VSTARユニバース", "VSTAR Universe"],
  ["きせきの結晶", "Miracle Crystal"],
  ["さいはての攻防", "The Furthest Ends of Offense and Defense"],
  ["まぼろしの森", "Mirage Forest"],
  ["めざめる伝説", "Awakening Legends"],
  ["インフェルノX", "Inferno X"],
  ["クリムゾンヘイズ", "Crimson Haze"],
  ["クレイバースト", "Clay Burst"],
  ["スカーレットex", "Scarlet ex"],
  ["スターターセット テラスタイプ：ステラ ソウブレイズex", "Starter Set Tera Type: Stellar Ceruledge ex"],
  ["スターターセット テラスタイプ：ステラ ニンフィアex", "Starter Set Tera Type: Stellar Sylveon ex"],
  ["スターバース", "Star Birth"],
  ["ステラミラクル", "Stellar Miracle"],
  ["スノーハザード", "Snow Hazard"],
  ["テラスタルフェスex", "Terastal Festival ex"],
  ["デッキビルドBOX ステラミラクル", "Deck Build Box Stellar Miracle"],
  ["トリプレットビート", "Triplet Beat"],
  ["バイオレットex", "Violet ex"],
  ["バトルパートナーズ", "Battle Partners"],
  ["バトルリージョン", "Battle Region"],
  ["パラダイムトリガー", "Paradigm Trigger"],
  ["ブラックボルト", "Black Bolt"],
  ["ホロンの幻影", "Holon Phantoms"],
  ["ホロンの研究塔", "Holon Research Tower"],
  ["ホワイトフレア", "White Flare"],
  ["ポケモンカード151", "Pokemon Card 151"],
  ["ポケモンカード★VS", "Pokemon Card VS"],
  ["ポケモンカード★web", "Pokemon Card web"],
  ["ポケモンジャングル", "Pokemon Jungle"],
  ["ムニキスゼロ", "Munikis Zero"],
  ["メガシンフォニア", "Mega Symphonia"],
  ["メガブレイブ", "Mega Brave"],
  ["リーダーズスタジアム", "Leaders' Stadium"],
  ["レイジングサーフ", "Raging Surf"],
  ["ロケット団", "Team Rocket"],
  ["ロケット団の栄光", "Glory of Team Rocket"],
  ["ロケット団の逆襲", "Rocket Gang Strikes Back"],
  ["ワイルドフォース", "Wild Force"],
  ["伝説の飛翔", "Flight of Legends"],
  ["化石の秘密", "Mystery of the Fossils"],
  ["古代の咆哮", "Ancient Roar"],
  ["地図にない町", "Town on No Map"],
  ["基本拡張パック", "Base Expansion Pack"],
  ["変幻の仮面", "Mask of Change"],
  ["拡張パック", "Expansion Pack"],
  ["未来の一閃", "Future Flash"],
  ["楽園ドラゴーナ", "Paradise Dragona"],
  ["海からの風", "Wind from the Sea"],
  ["熱風のアリーナ", "Heat Wave Arena"],
  ["神秘なる山", "Mysterious Mountains"],
  ["蒼空の激突", "Sky-Splitting Clash"],
  ["裂けた大地", "Split Earth"],
  ["超電ブレイカー", "Super Electric Breaker"],
  ["遺跡をこえて...", "Crossing the Ruins..."],
  ["金、銀、新世界へ...", "Gold, Silver, to a New World..."],
  ["金の空、銀の海", "Golden Sky, Silvery Ocean"],
  ["闇、そして光へ...", "Darkness, and to Light..."],
  ["闇からの挑戦", "Challenge from the Darkness"],
  ["黒炎の支配者", "Ruler of the Black Flame"],

  // Korean catalogue
  ["고대의 포효", "Ancient Roar"],
  ["미래의 일섬", "Future Flash"],
  ["와일드포스", "Wild Force"],

  // Simplified and Traditional Chinese catalogues
  ["太晶慶典ex", "Terastal Festival ex"],
  ["对战派对组合 奖励包", "Battle Party Combination Prize Pack"],
  ["對戰搭檔", "Battle Partners"],
  ["星晶奇跡", "Stellar Miracle"],
  ["樂園騰龍", "Paradise Dragona"],
  ["火箭隊的榮耀", "Glory of Team Rocket"],
  ["熱風競技場", "Heat Wave Arena"],
  ["超電突圍", "Super Electric Breaker"],
  ["25週年收藏款", "25th Anniversary Collection"],
  ["VMAX絕群壓軸", "VMAX Climax"],
  ["VSTAR&VMAX 高級牌組 代歐奇希斯", "VSTAR & VMAX High Class Deck Deoxys"],
  ["VSTAR&VMAX 高級牌組 捷拉奧拉", "VSTAR & VMAX High Class Deck Zeraora"],
  ["VSTAR特別組合", "VSTAR Special Set"],
  ["ex初階牌組", "ex Starter Deck"],
  ["ex特別組合", "ex Special Set"],
  ["一撃大師", "Single Strike Master"],
  ["三連音爆", "Triplet Beat"],
  ["伊布英雄", "Eevee Heroes"],
  ["冰雪險境", "Snow Hazard"],
  ["初階牌組100", "Starter Deck 100"],
  ["初階牌組100 特別版", "Starter Deck 100 Special Edition"],
  ["劍&盾", "Sword & Shield"],
  ["劍&盾 SET A", "Sword & Shield Set A"],
  ["劍&盾 SET B", "Sword & Shield Set B"],
  ["匯流藝術", "Fusion Arts"],
  ["古代咆哮", "Ancient Roar"],
  ["噴火龍", "Charizard"],
  ["天地萬物VSTAR", "VSTAR Universe"],
  ["寶可夢卡牌151", "Pokemon Card 151"],
  ["寶可夢卡牌家庭組合", "Pokemon Card Family Set"],
  ["對戰地區", "Battle Region"],
  ["強大", "Powerful"],
  ["思維激盪", "Paradigm Trigger"],
  ["挑戰", "Challenge"],
  ["搭檔", "Partner"],
  ["摩天巔峰", "Skyscraping Perfection"],
  ["星星誕生", "Star Birth"],
  ["時間觀察者", "Time Gazer"],
  ["未來密勒頓ex", "Future Miraidon ex"],
  ["未來閃光", "Future Flash"],
  ["朱ex", "Scarlet ex"],
  ["漆黑幽魂", "Jet-Black Spirit"],
  ["激狂駭浪", "Raging Surf"],
  ["無極力量", "Infinity Zone"],
  ["無極力量 SET A", "Infinity Zone Set A"],
  ["無極力量 SET B", "Infinity Zone Set B"],
  ["特典卡 朱&紫", "Scarlet & Violet Promo"],
  ["狂野之力", "Wild Force"],
  ["異度審判", "Cyber Judge"],
  ["白熱奧祕", "Incandescent Arcana"],
  ["皮卡丘", "Pikachu"],
  ["皮卡丘特別組合", "Pikachu Special Set"],
  ["碟旋暴擊", "Clay Burst"],
  ["空間魔術師", "Space Juggler"],
  ["紫ex", "Violet ex"],
  ["緋紅薄霧", "Crimson Haze"],
  ["蒼空烈流", "Blue Sky Stream"],
  ["藏瑪然特VS無極汰那", "Zamazenta vs Eternatus"],
  ["變幻假面", "Mask of Change"],
  ["起始組合VSTAR 路卡利歐", "VSTAR Starter Set Lucario"],
  ["起始組合VSTAR 達克萊伊", "VSTAR Starter Set Darkrai"],
  ["起始組合ex 呆火鱷&電龍 ex", "Starter Set ex Fuecoco & Ampharos ex"],
  ["起始組合ex 新葉喵&路卡利歐 ex", "Starter Set ex Sprigatito & Lucario ex"],
  ["起始組合ex 潤水鴨&謎擬Ｑ ex", "Starter Set ex Quaxly & Mimikyu ex"],
  ["超夢", "Mewtwo"],
  ["超夢ex", "Mewtwo ex"],
  ["連撃大師", "Rapid Strike Master"],
  ["進化", "Evolution"],
  ["銀白戰槍", "Silver Lance"],
  ["閃色寶藏ex", "Shiny Treasure ex"],
  ["閃色明星V", "Shiny Star V"],
  ["雙璧戰士", "Matchless Fighters"],
  ["頂級訓練家收藏箱 VSTAR", "Premium Trainer Box VSTAR"],
  ["頂級訓練家收藏箱ex", "Premium Trainer Box ex"],
  ["驚天伏特攻擊", "Amazing Volt Tackle"],
  ["骨紋巨聲鱷ex", "Skeledirge ex"],
  ["黑夜漫遊者", "Night Wanderer"],
  ["黑暗亡靈", "Dark Phantasma"],
  ["黯焰支配者", "Ruler of the Black Flame"],
]);

export function catalogueDisplaySetForText(
  value?: string | null,
  options?: { language?: string | null; providerCode?: string | null },
) {
  const raw = value?.trim();
  const exactMatch = raw
    ? INTERNATIONAL_SET_DISPLAY_NAMES.get(raw) ?? INTERNATIONAL_SET_DISPLAY_NAMES.get(raw.normalize("NFKC"))
    : undefined;

  if (exactMatch) {
    return exactMatch;
  }

  const translated = englishDisplayText(value, [
    ["インフェルノX", "Inferno X"],
    ["ポケモンカード151", "Pokemon Card 151"],
    ["デッキビルドBOX", "Deck Build Box "],
    ["ハイクラスパック", "High Class Pack "],
    ["強化拡張パック", "Enhanced Expansion Pack "],
    ["拡張パック", "Expansion Pack "],
    ["スターターセット", "Starter Set "],
    ["スタートデッキ", "Start Deck "],
    ["ステラミラクル", "Stellar Miracle"],
    ["ロケット団の栄光", "Glory of Team Rocket"],
    ["熱風のアリーナ", "Heat Wave Arena"],
    ["バトルパートナーズ", "Battle Partners"],
    ["テラスタルフェスex", "Terastal Festival ex"],
    ["超電ブレイカー", "Super Electric Breaker"],
    ["楽園ドラゴーナ", "Paradise Dragona"],
    ["ナイトワンダラー", "Night Wanderer"],
    ["変幻の仮面", "Mask of Change"],
    ["クリムゾンヘイズ", "Crimson Haze"],
    ["ワイルドフォース", "Wild Force"],
    ["サイバージャッジ", "Cyber Judge"],
    ["シャイニートレジャーex", "Shiny Treasure ex"],
    ["レイジングサーフ", "Raging Surf"],
    ["黒炎の支配者", "Ruler of the Black Flame"],
    ["スノーハザード", "Snow Hazard"],
    ["クレイバースト", "Clay Burst"],
    ["トリプレットビート", "Triplet Beat"],
    ["バイオレットex", "Violet ex"],
    ["スカーレットex", "Scarlet ex"],
    ["VSTARユニバース", "VSTAR Universe"],
    ["白熱のアルカナ", "Incandescent Arcana"],
    ["ロストアビス", "Lost Abyss"],
    ["ダークファンタズマ", "Dark Phantasma"],
    ["スペースジャグラー", "Space Juggler"],
    ["タイムゲイザー", "Time Gazer"],
    ["バトルリージョン", "Battle Region"],
    ["スターバース", "Star Birth"],
    ["VMAXクライマックス", "VMAX Climax"],
    ["フュージョンアーツ", "Fusion Arts"],
    ["イーブイヒーローズ", "Eevee Heroes"],
  ]);

  if (translated) {
    return translated;
  }

  if (value && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)) {
    const language = options?.language === "ja"
      ? "Japanese"
      : options?.language?.startsWith("zh")
        ? "Chinese"
        : options?.language === "ko"
          ? "Korean"
          : "International";

    return options?.providerCode ? `${language} set ${options.providerCode}` : `${language} set`;
  }

  return undefined;
}

export function catalogueSearchTermsForQuery(value?: string | null) {
  const normalized = normalizeAliasText(value);
  const raw = value?.trim();

  if (!normalized || !raw) {
    return [];
  }

  const aliasTerms = POKEMON_NAME_ALIASES.flatMap((entry) => {
    const terms = [entry.english, ...entry.aliases];
    const matches = terms.some((term) => {
      const normalizedTerm = normalizeAliasText(term);

      return normalizedTerm.includes(normalized) || normalized.includes(normalizedTerm);
    });

    return matches ? terms : [];
  });

  return uniqueAliasValues([raw, ...aliasTerms, ...generatedPokemonAliasesForText(raw, true)]);
}

function englishDisplayText(value: string | null | undefined, phraseReplacements: Array<[string, string]>) {
  const raw = value?.trim();

  if (!raw) {
    return undefined;
  }

  let display = raw;
  let changed = false;

  for (const [localized, english] of [...phraseReplacements, ...CURATED_POKEMON_REPLACEMENT_PAIRS]) {
    if (!display.includes(localized)) {
      continue;
    }

    display = display.replaceAll(localized, english);
    changed = true;
  }

  const generatedDisplay = replaceGeneratedPokemonNames(display);

  if (generatedDisplay !== display) {
    display = generatedDisplay;
    changed = true;
  }

  if (!changed) {
    return undefined;
  }

  return display
    .replace(/([A-Z])\s+(MAX|STAR)\b/g, "$1$2")
    .replace(/\b([A-Z])\s+ex\b/g, "$1 ex")
    .replace(/([a-z])([XY])\s+ex\b/g, "$1 $2 ex")
    .replace(/\s+/g, " ")
    .trim();
}

const CURATED_POKEMON_REPLACEMENT_PAIRS = POKEMON_NAME_ALIASES.flatMap((entry) =>
    entry.aliases
      .filter((alias) => /[^\u0000-\u007f]/.test(alias) || alias !== entry.english)
      .map((alias) => [alias, entry.english] as [string, string]),
  ).sort((left, right) => right[0].length - left[0].length);

const GENERATED_ALIASES_BY_FIRST_CHARACTER = generatedAliasesByFirstCharacter();
const GENERATED_ALIASES_BY_ENGLISH = generatedAliasesByEnglish();

function replaceGeneratedPokemonNames(value: string) {
  if (!hasInternationalScript(value)) {
    return value;
  }

  let display = value;

  for (const [alias, english] of generatedPokemonCandidates(value)) {
    if (display.includes(alias)) {
      display = display.replaceAll(alias, english);
    }
  }

  return display;
}

function generatedPokemonAliasesForText(value: string, includeEnglishMatches = false) {
  const matches = generatedPokemonCandidates(value).flatMap(([alias, english]) => [alias, english]);

  if (includeEnglishMatches) {
    const normalized = normalizeAliasText(value);

    for (const [english, aliases] of GENERATED_ALIASES_BY_ENGLISH) {
      if (normalizeAliasText(english).includes(normalized) || normalized.includes(normalizeAliasText(english))) {
        matches.push(english, ...aliases);
      }
    }
  }

  return matches;
}

function generatedPokemonCandidates(value: string) {
  const candidates = new Map<string, string>();

  for (const character of value) {
    for (const [alias, english] of GENERATED_ALIASES_BY_FIRST_CHARACTER.get(character) ?? []) {
      if (value.includes(alias)) {
        candidates.set(alias, english);
      }
    }
  }

  return [...candidates.entries()].sort((left, right) => right[0].length - left[0].length);
}

function generatedAliasesByFirstCharacter() {
  const buckets = new Map<string, Array<readonly [string, string]>>();

  for (const entry of GENERATED_POKEMON_NAME_ALIASES) {
    const [alias] = entry;
    const firstCharacter = [...alias][0];

    if (!firstCharacter) {
      continue;
    }

    const bucket = buckets.get(firstCharacter) ?? [];
    bucket.push(entry);
    buckets.set(firstCharacter, bucket);
  }

  return buckets;
}

function generatedAliasesByEnglish() {
  const aliasesByEnglish = new Map<string, string[]>();

  for (const [alias, english] of GENERATED_POKEMON_NAME_ALIASES) {
    const aliases = aliasesByEnglish.get(english) ?? [];
    aliases.push(alias);
    aliasesByEnglish.set(english, aliases);
  }

  return aliasesByEnglish;
}

function hasInternationalScript(value: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function normalizeAliasText(value?: string | null) {
  return value
    ?.trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "") ?? "";
}

function uniqueAliasValues(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalizeAliasText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(value);
  }

  return unique;
}
