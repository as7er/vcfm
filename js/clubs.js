/**
 * 五国 188 家原创俱乐部。旧名称仅保留在 legacyName 迁移字段中；
 * clubId、实力、预算、联赛数量和开局资格不变。
 */

import { COUNTRY_BRANDING } from "./branding.js";

const BRAND_COLORS = [
  "#0f766e", "#b91c1c", "#1d4ed8", "#a16207", "#7e22ce", "#047857",
  "#be123c", "#0369a1", "#4d7c0f", "#c2410c", "#4338ca", "#0e7490",
  "#86198f", "#15803d", "#9f1239", "#1e40af", "#92400e", "#6d28d9",
  "#166534", "#c026d3", "#075985", "#3f6212", "#9a3412", "#334155",
];
const KIT_STYLES = ["solid", "stripes", "halves", "sash", "hoops"];
const CREST_SHAPES = ["circle", "shield", "diamond", "hexagon", "striped-shield"];
const CREST_SYMBOLS = ["peak", "river", "star", "tower", "tree", "wing"];
const STADIUM_SUFFIXES = [
  ["Park", "公园球场"],
  ["Ground", "球场"],
  ["Arena", "竞技场"],
  ["Field", "运动场"],
];

let brandingIndex = 0;
const usedShortNames = new Set();

function contrastText(hex) {
  const h = String(hex || "").replace("#", "");
  const rgb = [0, 2, 4].map((offset) => parseInt(h.slice(offset, offset + 2), 16) || 0);
  const luminance = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return luminance > 145 ? "#111827" : "#ffffff";
}

function cityFromEnglishName(name) {
  return String(name)
    .replace(/\b(AC|AS|CF|FC|SC|SV|VfR|Athletic|Borough|Calcio|City|Club|County|Deportivo|Eintracht|Fortuna|Olympique|Racing|Rovers|Sporting|Sportiva|Stade|Town|Union|Unión|Unione|United|Vale|Virtus|Wanderers|Atletico|Atlético)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cityFromChineseName(name) {
  return String(name)
    .replace(/(足球俱乐部|竞技协会|奥林匹克|自治镇|流浪者|漫游者|维尔图斯|体育会|竞速会|足球会|竞技会|团结队|福图纳|俱乐部|郡队|竞技|体育|联盟|城|谷)$/u, "")
    .trim();
}

function makeShortName(countryCode, cityEn, index) {
  const compact = cityEn
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  const prefix = countryCode[0];
  let code = (prefix + compact.slice(0, 3)).padEnd(3, "X").slice(0, 4);
  let attempt = 0;
  while (usedShortNames.has(code)) {
    const suffix = String.fromCharCode(65 + ((index + attempt) % 26));
    code = (prefix + compact.slice(0, 2) + suffix).padEnd(3, "X").slice(0, 4);
    attempt++;
  }
  usedShortNames.add(code);
  return code;
}

function buildBranding(base, renamed, division, countryId) {
  const [nameEn, nameZh] = renamed;
  const index = brandingIndex++;
  const countryCode = COUNTRY_BRANDING[countryId].countryCode;
  const cityEn = cityFromEnglishName(nameEn);
  const cityZh = cityFromChineseName(nameZh);
  const shortName = makeShortName(countryCode, cityEn, index);
  const primary = BRAND_COLORS[index % BRAND_COLORS.length];
  let secondary = BRAND_COLORS[(index * 7 + Math.floor(index / BRAND_COLORS.length) * 5 + 9) % BRAND_COLORS.length];
  if (secondary === primary) secondary = BRAND_COLORS[(index + 11) % BRAND_COLORS.length];
  const accent = BRAND_COLORS[(index * 11 + 4) % BRAND_COLORS.length];
  const style = KIT_STYLES[index % KIT_STYLES.length];
  const [stadiumSuffixEn, stadiumSuffixZh] = STADIUM_SUFFIXES[index % STADIUM_SUFFIXES.length];
  return {
    clubId: base.id,
    legacyName: base.name,
    legacyShortName: base.short,
    nameEn,
    nameZh,
    shortName,
    countryId,
    countryCode,
    leagueId: division,
    cityEn,
    cityZh,
    stadiumEn: `${cityEn} ${stadiumSuffixEn}`,
    stadiumZh: `${cityZh}${stadiumSuffixZh}`,
    colors: { primary, secondary, accent },
    kit: { style, primary, secondary, numberColor: contrastText(primary) },
    crest: {
      shape: CREST_SHAPES[index % CREST_SHAPES.length],
      symbol: CREST_SYMBOLS[(index * 5 + 1) % CREST_SYMBOLS.length],
      monogram: shortName,
      primary,
      secondary,
    },
    replaceCrest: true,
    migrateOldSave: true,
  };
}

/** 超联 20 — 顶级都会 / 豪门气质（英超量级虚构名） */
const D1 = [
  ["vcc", "Vanguard City", "Vanguard", 82, 55_000_000],
  ["harbor", "Harbourgate Athletic", "Harbour", 80, 48_000_000],
  ["north", "Northbridge United", "Northbridge", 79, 42_000_000],
  ["river", "Riverside Rovers", "Riverside", 78, 38_000_000],
  ["steel", "Steelborough FC", "Steelboro", 77, 35_000_000],
  ["capital", "Capital Borough", "Capital", 76, 33_000_000],
  ["royal", "Royal Crest Athletic", "Crest", 75, 30_000_000],
  ["metro", "Metrovale FC", "Metrovale", 74, 28_000_000],
  ["crown", "Crownfield United", "Crownfield", 74, 27_000_000],
  ["atlas", "Atlas Park", "Atlas", 73, 26_000_000],
  ["nova", "Novabridge FC", "Novabridge", 73, 25_000_000],
  ["olympic", "Olympia Town", "Olympia", 72, 24_000_000],
  ["titan", "Titanford United", "Titanford", 72, 23_000_000],
  ["horizon", "Horizon Athletic", "Horizon", 71, 22_000_000],
  ["empire", "Empire Lane", "Empire", 71, 21_000_000],
  ["summit", "Summit United", "Summit", 70, 20_000_000],
  ["legend", "Legendale FC", "Legendale", 70, 19_500_000],
  ["prime", "Primrose City", "Primrose", 69, 19_000_000],
  ["galaxy", "Galeway United", "Galeway", 69, 18_500_000],
  ["zenith", "Zenith Borough", "Zenith", 68, 18_000_000],
];

/** 甲级 20 — 中游工业城 / 海滨镇气质（英冠量级虚构名） */
const D2 = [
  ["eagle", "Eaglecliff United", "Eaglecliff", 67, 14_000_000],
  ["forest", "Greenwood Rovers", "Greenwood", 66, 13_000_000],
  ["lion", "Lionsgate Athletic", "Lionsgate", 65, 12_000_000],
  ["wave", "Tideswell FC", "Tideswell", 65, 11_500_000],
  ["canyon", "Canyondale Town", "Canyondale", 64, 11_000_000],
  ["harbor2", "Southharbour FC", "S.Harbour", 64, 10_500_000],
  ["phoenix", "Phoenixford", "Phoenixford", 63, 10_000_000],
  ["aurora", "Aurorafield", "Aurora", 63, 9_500_000],
  ["raven", "Raventhorpe", "Raven", 62, 9_000_000],
  ["iron", "Ironbridge Athletic", "Ironbridge", 62, 8_800_000],
  ["storm", "Stormhaven FC", "Stormhaven", 61, 8_500_000],
  ["delta", "Deltamouth United", "Deltamouth", 61, 8_200_000],
  ["beacon", "Beacon Hill", "Beacon", 60, 8_000_000],
  ["falcon", "Falconridge", "Falcon", 60, 7_800_000],
  ["ridge", "Ridgeway Rovers", "Ridgeway", 59, 7_500_000],
  ["coral", "Coral Bay FC", "Coral Bay", 59, 7_200_000],
  ["pioneer", "Pioneer Athletic", "Pioneer", 58, 7_000_000],
  ["comet", "Cometbury Town", "Cometbury", 58, 6_800_000],
  ["bastion", "Bastion United", "Bastion", 57, 6_500_000],
  ["mirage", "Mirage Town", "Mirage", 57, 6_200_000],
];

/** 乙级 20（开局可选）— 小镇 / 码头 / 矿区气质（英甲量级虚构名） */
const D3 = [
  ["sunset", "Westend Town", "Westend", 55, 3_800_000],
  ["mill", "Millford United", "Millford", 54, 3_500_000],
  ["dock", "Dockside Athletic", "Dockside", 54, 3_300_000],
  ["valley", "Valleyford FC", "Valleyford", 53, 3_100_000],
  ["bridge", "Longbridge Rovers", "Longbridge", 53, 3_000_000],
  ["mines", "Miners United", "Miners", 52, 2_800_000],
  ["farm", "Farmstead FC", "Farmstead", 52, 2_600_000],
  ["village", "Village Green", "V.Green", 51, 2_500_000],
  ["harbor3", "Westbay United", "Westbay", 51, 2_400_000],
  ["chapel", "Chapelgate", "Chapelgate", 50, 2_300_000],
  ["quarry", "Quarrytown FC", "Quarrytown", 50, 2_200_000],
  ["meadow", "Meadowbank", "Meadowbank", 49, 2_100_000],
  ["lantern", "Lantern Borough", "Lantern", 49, 2_000_000],
  ["ferry", "Ferrybridge Athletic", "Ferrybridge", 48, 1_900_000],
  ["orchard", "Orchard United", "Orchard", 48, 1_850_000],
  ["slate", "Slateford Town", "Slateford", 47, 1_800_000],
  ["willow", "Willowdale FC", "Willowdale", 47, 1_750_000],
  ["brook", "Brookside Athletic", "Brookside", 46, 1_700_000],
  ["anchor", "Anchorage FC", "Anchorage", 46, 1_650_000],
  ["hearth", "Hearthfield Town", "Hearthfield", 45, 1_600_000],
];

const ENG_D1_BRANDS = [
  ["Kingsford Athletic", "金斯福德竞技"],
  ["Redhaven City", "红港城"],
  ["Northcastle Rovers", "北堡流浪者"],
  ["Westmere Borough", "西米尔自治镇"],
  ["Stonebridge County", "石桥郡队"],
  ["Ashbourne Vale", "阿什伯恩谷"],
  ["Highmoor Athletic", "高沼竞技"],
  ["Ravenswick City", "雷文斯维克城"],
  ["Oakshire Rovers", "橡树郡流浪者"],
  ["Blackwater Borough", "黑水自治镇"],
  ["Eastmere Wanderers", "东米尔漫游者"],
  ["Greycastle Vale", "灰堡谷"],
  ["Alderwick City", "奥尔德维克城"],
  ["Briarford Athletic", "布莱尔福德竞技"],
  ["Mossley County", "莫斯利郡队"],
  ["Fairhaven Rovers", "费尔黑文流浪者"],
  ["Wynthorpe Borough", "温索普自治镇"],
  ["Rosewick City", "罗斯维克城"],
  ["Coldmere Athletic", "科尔德米尔竞技"],
  ["Elmstead Vale", "埃尔姆斯特德谷"],
];

const ENG_D2_BRANDS = [
  ["Brackenford City", "布拉肯福德城"],
  ["Pinehurst Rovers", "松林流浪者"],
  ["Foxmere Athletic", "福克斯米尔竞技"],
  ["Tidecroft Borough", "泰德克罗夫特自治镇"],
  ["Emberton County", "恩伯顿郡队"],
  ["Southmere Wanderers", "南米尔漫游者"],
  ["Flintwick City", "弗林特维克城"],
  ["Moorland Vale", "荒原谷"],
  ["Redbrook Athletic", "红溪竞技"],
  ["Copperfield Rovers", "铜原流浪者"],
  ["Rainford Borough", "雷恩福德自治镇"],
  ["Marshgate City", "沼门城"],
  ["Beaconhurst County", "灯塔赫斯特郡队"],
  ["Falconmere Athletic", "猎鹰米尔竞技"],
  ["Ridgeholt Rovers", "里奇霍尔特流浪者"],
  ["Coralwick Town", "珊瑚维克镇"],
  ["Pioneerford City", "拓荒福德城"],
  ["Starling Vale", "椋鸟谷"],
  ["Graniteby Athletic", "花岗比竞技"],
  ["Larkspur Borough", "飞燕草自治镇"],
];

const ENG_D3_BRANDS = [
  ["Sunmere Wanderers", "桑米尔漫游者"],
  ["Millhaven Athletic", "米尔黑文竞技"],
  ["Dockmere City", "多克米尔城"],
  ["Valleydown Rovers", "谷地流浪者"],
  ["Longfen Borough", "朗芬自治镇"],
  ["Quarrymere County", "奎里米尔郡队"],
  ["Farmleigh Athletic", "法姆利竞技"],
  ["Greenhollow Vale", "绿谷"],
  ["Westbay Wanderers", "西湾漫游者"],
  ["Chapelwick City", "查珀尔维克城"],
  ["Slatebury Rovers", "斯莱特伯里流浪者"],
  ["Meadowcroft Borough", "草甸克罗夫特自治镇"],
  ["Lanternmere Athletic", "兰特恩米尔竞技"],
  ["Ferryholt County", "费里霍尔特郡队"],
  ["Orchardwick Vale", "果园维克谷"],
  ["Willowfen Rovers", "柳沼流浪者"],
  ["Brookmere City", "布鲁克米尔城"],
  ["Anchorleigh Athletic", "安克利竞技"],
  ["Hearthmoor Borough", "炉原自治镇"],
  ["Dunridge Wanderers", "邓里奇漫游者"],
];

function pack(list, renamedList, division, countryId = "crownland") {
  return list.map((row, i) => {
    const [id, name, short, power, money] = row;
    const branding = buildBranding({ id, name, short }, renamedList[i], division, countryId);
    return {
      id,
      name: branding.nameZh,
      nameEn: branding.nameEn,
      nameZh: branding.nameZh,
      short: branding.shortName,
      shortName: branding.shortName,
      legacyName: name,
      legacyShortName: short,
      power,
      money,
      color: branding.colors.primary,
      division,
      countryId,
      countryCode: branding.countryCode,
      leagueId: division,
      city: { en: branding.cityEn, zh: branding.cityZh },
      stadiumName: { en: branding.stadiumEn, zh: branding.stadiumZh },
      colors: { ...branding.colors },
      kit: { ...branding.kit },
      crest: { ...branding.crest },
      branding,
    };
  });
}

function packGenerated(names, renamedList, division, countryId, { maxPower, minPower, maxMoney, minMoney }) {
  return names.map((name, i) => {
    const ratio = names.length <= 1 ? 0 : i / (names.length - 1);
    const power = Math.round(maxPower + (minPower - maxPower) * ratio);
    const money = Math.round(maxMoney + (minMoney - maxMoney) * ratio);
    const id = `${countryId.slice(0, 3)}_${division}_${String(i + 1).padStart(2, "0")}`;
    const legacyShortName = name.split(/\s+/)[0].slice(0, 14);
    const branding = buildBranding(
      { id, name, short: legacyShortName },
      renamedList[i],
      division,
      countryId
    );
    return {
      id,
      name: branding.nameZh,
      nameEn: branding.nameEn,
      nameZh: branding.nameZh,
      short: branding.shortName,
      shortName: branding.shortName,
      legacyName: name,
      legacyShortName,
      power,
      money,
      color: branding.colors.primary,
      division,
      countryId,
      countryCode: branding.countryCode,
      leagueId: division,
      city: { en: branding.cityEn, zh: branding.cityZh },
      stadiumName: { en: branding.stadiumEn, zh: branding.stadiumZh },
      colors: { ...branding.colors },
      kit: { ...branding.kit },
      crest: { ...branding.crest },
      branding,
    };
  });
}

const SOLARA_TOP = [
  "Aurelia CF", "Puerto Celeste", "Monteluz Union", "Valdora Atletico",
  "Costa Alba FC", "Sierra Dorada", "Maravilla SC", "Rio Claro Athletic",
  "Estrella Roja", "Campo Verde", "Torreluna FC", "Bahia Serena",
  "Alcazar Nova", "Villasol United", "Cobre Vista", "Mirador CF",
];

const SOLARA_SECOND = [
  "Loma Azul", "Puerto Sol", "Valmera Deportivo", "Prado Alto",
  "Roca Blanca", "Nueva Espera", "Arco del Mar", "Santa Vega",
  "Fuente Oro", "Brisa Norte", "Olivar FC", "Canto Claro",
  "Arena Sur", "Lago Rojo", "Camino Unido", "Sol del Este",
];

const EISENMARK_TOP = [
  "Falkenstadt SV", "Eisenhafen 04", "Kronberg FC", "Adlerbruck",
  "Stahlheim Union", "Nordfels 09", "Waldkirch SC", "Blauwerk FC",
  "Rotental 08", "Bergwacht", "Lindenbruck", "Hafenkrone",
  "Silbersee", "Donnerfeld", "Morgenstadt", "Westtor SV",
];

const EISENMARK_SECOND = [
  "Kupferwald", "Steinbach 07", "Grunhafen", "Ostmarke FC",
  "Tannenfels", "Hochbruck", "Eisental", "Sudtor 05",
  "Nebelstadt", "Hammersee", "Weissburg", "Rotbruck",
  "Feldkrone", "Adlerhain", "Werkstadt", "Mondtal SC",
];

const BELLADORO_TOP = [
  "Aurora Calcio", "Porto d'Oro", "Valdoro FC", "Citta Nova",
  "Rosalba 1912", "Montechiaro", "Rivabella", "Aquila Nera",
  "Stella Marina", "Fortuna Verde", "Torriano", "Lago Azzurro",
  "Borgo Sole", "Granvista", "Virtu Bellena", "Pietraluna",
];

const BELLADORO_SECOND = [
  "Colleverde", "Marina Rossa", "Casalvento", "Fontebella",
  "Alba Nuova", "Portoforte", "Vigna d'Oro", "Serradoro",
  "Pontechiaro", "Rocca Nova", "Campo Fiore", "Valle Serena",
  "Marevento", "Luna Calcio", "Ferrovia AC", "Orizzonte",
];

const LUMERA_TOP = [
  "Lumeris FC", "Belle-Rive AC", "Valcroix Union", "Aurore Sport",
  "Rochebleue", "Port-Lumiere", "Ciel Rouge FC", "Grandval Athletic",
  "Bois d'Argent", "Vallonne SC", "Marais Royal", "Etoile d'Azur",
  "Couronne FC", "Riveneuve", "Montfleur", "Nordlac",
];

const LUMERA_SECOND = [
  "Petit-Pont", "Clairbois", "Rougeval", "Sudriviere",
  "Chateau-Lune", "Fontelune", "Aigle Blanc", "Verteville",
  "Port d'Aube", "Lac d'Or", "Vieux Marche", "Haute-Rive",
  "Moulin Vert", "Cote Claire", "Jardin FC", "Plein-Ciel",
];

const ESP_TOP_BRANDS = [
  ["Atlético Solmar", "索尔马竞技"],
  ["Deportivo Valdoro", "瓦尔多罗体育"],
  ["Unión Monteclaro", "蒙特克拉罗联盟"],
  ["Sporting Puerto Realta", "雷阿尔塔港竞技"],
  ["Club Sierra Azul", "蓝山俱乐部"],
  ["Costa Roja CF", "红海岸足球会"],
  ["Villaluna Atlético", "维拉露娜竞技"],
  ["Río Blanco Deportivo", "白河体育"],
  ["Campo Verde CF", "绿野足球会"],
  ["Altamira Unión", "阿尔塔米拉联盟"],
  ["Marazul Sporting", "蓝海竞技"],
  ["Cerro Dorado CF", "金丘足球会"],
  ["Valle Serena Deportivo", "塞雷纳谷体育"],
  ["Luzmar Atlético", "卢兹马尔竞技"],
  ["Ribera Clara CF", "克拉拉河岸足球会"],
  ["Solcanto Unión", "索尔坎托联盟"],
];

const ESP_SECOND_BRANDS = [
  ["Monteluna Deportivo", "蒙特露娜体育"],
  ["Puerto Brisa CF", "微风港足球会"],
  ["Sierra Alba Unión", "阿尔巴山联盟"],
  ["Costa Verde Sporting", "绿海岸竞技"],
  ["Villanueva Sol CF", "新村太阳足球会"],
  ["Río Carmesí Deportivo", "绯红河体育"],
  ["Campo Norte Unión", "北野联盟"],
  ["Loma Clara CF", "克拉拉山坡足球会"],
  ["Marina Azul Atlético", "蓝湾竞技"],
  ["Valdoro Sur Deportivo", "南瓦尔多罗体育"],
  ["Solierra CF", "索列拉足球会"],
  ["Piedra Serena Unión", "塞雷纳石镇联盟"],
  ["Bahía Luna Sporting", "月湾竞技"],
  ["Monte Rojo CF", "红山足球会"],
  ["Pradera Sol Deportivo", "阳光草原体育"],
  ["Canto del Mar Unión", "海歌联盟"],
];

const GER_TOP_BRANDS = [
  ["FC Eisenbruck", "艾森布吕克足球会"],
  ["SV Waldheim", "瓦尔德海姆体育会"],
  ["VfR Nordhafen", "诺德哈芬竞技协会"],
  ["Eintracht Falkenstadt", "法尔肯施塔特团结队"],
  ["Fortuna Silberberg", "锡尔伯格福图纳"],
  ["FC Grünwald", "格林瓦尔德足球会"],
  ["SV Rheinbruck", "莱茵布吕克体育会"],
  ["VfR Kronental", "克罗嫩塔尔竞技协会"],
  ["Eintracht Adlerfeld", "阿德勒费尔德团结队"],
  ["Fortuna Westtal", "韦斯特塔尔福图纳"],
  ["FC Morgenhain", "摩根海恩足球会"],
  ["SV Hohenmark", "霍恩马克体育会"],
  ["VfR Lichtwald", "利希特瓦尔德竞技协会"],
  ["Eintracht Brückenau", "布吕肯瑙团结队"],
  ["Fortuna Tannengrund", "坦嫩格伦德福图纳"],
  ["FC Kupferhain", "库普费尔海恩足球会"],
];

const GER_SECOND_BRANDS = [
  ["SV Falkenried", "法尔肯里德体育会"],
  ["FC Steinbrunn", "施泰因布伦足球会"],
  ["VfR Grünhafen", "格林哈芬竞技协会"],
  ["Eintracht Osttal", "奥斯塔尔团结队"],
  ["Fortuna Nebelgrund", "内贝尔格伦德福图纳"],
  ["FC Hochwald", "霍赫瓦尔德足球会"],
  ["SV Eisental", "艾森塔尔体育会"],
  ["VfR Südbrück", "南布吕克竞技协会"],
  ["Eintracht Silberhain", "锡尔伯海恩团结队"],
  ["Fortuna Hammerfeld", "哈默费尔德福图纳"],
  ["FC Weissental", "魏森塔尔足球会"],
  ["SV Rotheide", "罗特海德体育会"],
  ["VfR Feldkranz", "费尔德克兰茨竞技协会"],
  ["Eintracht Adlerhain", "阿德勒海恩团结队"],
  ["Fortuna Werkental", "韦尔克塔尔福图纳"],
  ["FC Mondtal", "蒙德塔尔足球会"],
];

const ITA_TOP_BRANDS = [
  ["AC Valdoria", "瓦尔多里亚竞技"],
  ["FC Monteverde", "蒙特韦尔德足球会"],
  ["Calcio Bellacosta", "贝拉科斯塔足球会"],
  ["Unione Porto Aurelio", "奥雷利奥港联盟"],
  ["Virtus San Celeste", "圣切莱斯特维尔图斯"],
  ["Rocca Nera Sportiva", "罗卡内拉体育"],
  ["Castelvento Calcio", "卡斯特尔文托足球会"],
  ["Rivabella FC", "里瓦贝拉足球会"],
  ["Altavilla Unione", "阿尔塔维拉联盟"],
  ["Fonteluce Sportiva", "丰特卢切体育"],
  ["AC Serenalto", "塞雷纳尔托竞技"],
  ["FC Pietradoro", "皮耶特拉多罗足球会"],
  ["Calcio Ventoalto", "文托阿尔托足球会"],
  ["Unione Marisole", "马里索莱联盟"],
  ["Virtus Collechiaro", "科莱基亚罗维尔图斯"],
  ["Rocca Verde FC", "罗卡韦尔德足球会"],
];

const ITA_SECOND_BRANDS = [
  ["AC Montelume", "蒙特卢梅竞技"],
  ["FC Bellariva", "贝拉里瓦足球会"],
  ["Calcio Portovento", "波尔托文托足球会"],
  ["Unione Valserena", "瓦尔塞雷纳联盟"],
  ["Virtus Castelsole", "卡斯特尔索莱维尔图斯"],
  ["Rivaforte Sportiva", "里瓦福尔泰体育"],
  ["AC Lunacosta", "卢纳科斯塔竞技"],
  ["FC Fontanera", "丰塔内拉足球会"],
  ["Calcio Borgoluce", "博尔戈卢切足球会"],
  ["Unione Roccaferma", "罗卡费尔马联盟"],
  ["Virtus Marechiaro", "马雷基亚罗维尔图斯"],
  ["AC Valleombra", "瓦莱翁布拉竞技"],
  ["FC Altacielo", "阿尔塔切洛足球会"],
  ["Calcio San Virello", "圣维雷洛足球会"],
  ["Unione Castelrosa", "卡斯特尔罗萨联盟"],
  ["Virtus Campolago", "坎波拉戈维尔图斯"],
];

const FRA_TOP_BRANDS = [
  ["FC Bellemont", "贝勒蒙足球会"],
  ["AS Valrouge", "瓦勒鲁日体育会"],
  ["Olympique Montclair", "蒙克莱尔奥林匹克"],
  ["Racing Saint-Aurel", "圣奥雷尔竞速会"],
  ["Union Cote d'Argent", "银岸联盟"],
  ["Stade Riviere Bleue", "蓝河体育会"],
  ["FC Port-Lumiere", "光港足球会"],
  ["AS Grandvallon", "大谷体育会"],
  ["Olympique Hautefort", "欧特福尔奥林匹克"],
  ["Racing Clairbois", "克莱尔布瓦竞速会"],
  ["Union Valdune", "瓦尔迪讷联盟"],
  ["Stade Belle-Rive", "贝尔里夫体育会"],
  ["FC Montdoriel", "蒙多里耶足球会"],
  ["AS Rivemont", "里夫蒙体育会"],
  ["Olympique Boisclair", "布瓦克莱尔奥林匹克"],
  ["Racing Auriville", "奥里维尔竞速会"],
];

const FRA_SECOND_BRANDS = [
  ["FC Valcendre", "瓦尔桑德足球会"],
  ["AS Montfauve", "蒙福沃体育会"],
  ["Union Portelune", "波特吕讷联盟"],
  ["Stade Hauterive", "欧特里夫体育会"],
  ["FC Clairval", "克莱瓦尔足球会"],
  ["Racing Grandbois", "格朗布瓦竞速会"],
  ["AS Neufrivage", "新河岸体育会"],
  ["Olympique Rochepale", "罗什帕勒奥林匹克"],
  ["Union Belleplaine", "贝勒普兰联盟"],
  ["Stade Luminac", "吕米纳克体育会"],
  ["FC Aubeval", "欧布瓦尔足球会"],
  ["AS Coteverte", "绿岸体育会"],
  ["Racing Montserein", "蒙瑟兰竞速会"],
  ["Union Boisroux", "布瓦鲁联盟"],
  ["Stade Rivazur", "里瓦祖尔体育会"],
  ["FC Hautebrise", "欧特布里兹足球会"],
];

export const CLUB_TEMPLATES = [
  ...pack(D1, ENG_D1_BRANDS, 1, "crownland"),
  ...pack(D2, ENG_D2_BRANDS, 2, "crownland"),
  ...pack(D3, ENG_D3_BRANDS, 3, "crownland"),
  ...packGenerated(SOLARA_TOP, ESP_TOP_BRANDS, 4, "solara", { maxPower: 79, minPower: 64, maxMoney: 44_000_000, minMoney: 13_000_000 }),
  ...packGenerated(SOLARA_SECOND, ESP_SECOND_BRANDS, 5, "solara", { maxPower: 62, minPower: 47, maxMoney: 9_500_000, minMoney: 2_000_000 }),
  ...packGenerated(EISENMARK_TOP, GER_TOP_BRANDS, 6, "eisenmark", { maxPower: 80, minPower: 65, maxMoney: 46_000_000, minMoney: 14_000_000 }),
  ...packGenerated(EISENMARK_SECOND, GER_SECOND_BRANDS, 7, "eisenmark", { maxPower: 63, minPower: 48, maxMoney: 10_000_000, minMoney: 2_100_000 }),
  ...packGenerated(BELLADORO_TOP, ITA_TOP_BRANDS, 8, "belladoro", { maxPower: 79, minPower: 64, maxMoney: 43_000_000, minMoney: 13_000_000 }),
  ...packGenerated(BELLADORO_SECOND, ITA_SECOND_BRANDS, 9, "belladoro", { maxPower: 62, minPower: 47, maxMoney: 9_200_000, minMoney: 1_900_000 }),
  ...packGenerated(LUMERA_TOP, FRA_TOP_BRANDS, 10, "lumera", { maxPower: 78, minPower: 63, maxMoney: 41_000_000, minMoney: 12_000_000 }),
  ...packGenerated(LUMERA_SECOND, FRA_SECOND_BRANDS, 11, "lumera", { maxPower: 61, minPower: 46, maxMoney: 8_800_000, minMoney: 1_800_000 }),
];

/** Complete, reviewable old-name to new-brand migration map. */
export const clubBrandingById = Object.freeze(
  Object.fromEntries(CLUB_TEMPLATES.map((club) => [club.id, club.branding]))
);
