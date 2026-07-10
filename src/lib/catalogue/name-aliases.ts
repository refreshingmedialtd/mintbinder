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

  return uniqueAliasValues(
    POKEMON_NAME_ALIASES.flatMap((entry) => {
      const terms = [entry.english, ...entry.aliases];
      const matches = terms.some((term) => normalized.includes(normalizeAliasText(term)));

      return matches ? terms : [];
    }),
  );
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

  return uniqueAliasValues([raw, ...aliasTerms]);
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
