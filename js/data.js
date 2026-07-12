/** 静态数据：俱乐部、名字、阵型 */

export const FIRST_NAMES = [
  "Jack", "Lucas", "Marcus", "Harvey", "Kevin", "Leon", "Noah", "Oscar",
  "Paul", "Ryan", "Sebastian", "Thomas", "Victor", "William", "Alex", "Ben",
  "Carlos", "Daniel", "Ethan", "Felix", "Gabriel", "Henry", "Ivan", "Joe",
  "Kai", "Luis", "Miguel", "Nico", "Oliver", "Pedro", "Quinn", "Rafael",
  "Sammy", "Timo", "Ulrich", "Vincent", "Xavier", "Yuri", "Zach", "Andy",
  "Bruce", "Chris", "David", "Eric", "Frank", "George", "Hans", "Ian",
  "James", "Liam", "Mason", "Nathan", "Owen", "Pablo", "Rico", "Sergio",
];

export const LAST_NAMES = [
  "Smith", "Muller", "Silva", "Rodriguez", "Brown", "Kim", "Chen", "Sato",
  "Jones", "Garcia", "Martin", "Anderson", "Taylor", "Moore", "Jackson", "White",
  "Harris", "Clark", "Lewis", "Walker", "Hall", "Allen", "Young", "Scott",
  "Green", "Adams", "Baker", "Gonzalez", "Navarro", "Costa", "Fernandez", "Diaz",
  "Lopez", "Perez", "Wilson", "Thompson", "Murphy", "Kelly", "Rossi", "Moreau",
  "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Santos", "Oliveira",
];

/** 国籍：code 用于标记，name 中文显示，flag 为 emoji */
export const NATIONALITIES = [
  { code: "ENG", name: "英格兰", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "ESP", name: "西班牙", flag: "🇪🇸" },
  { code: "GER", name: "德国", flag: "🇩🇪" },
  { code: "FRA", name: "法国", flag: "🇫🇷" },
  { code: "ITA", name: "意大利", flag: "🇮🇹" },
  { code: "POR", name: "葡萄牙", flag: "🇵🇹" },
  { code: "BRA", name: "巴西", flag: "🇧🇷" },
  { code: "ARG", name: "阿根廷", flag: "🇦🇷" },
  { code: "NED", name: "荷兰", flag: "🇳🇱" },
  { code: "BEL", name: "比利时", flag: "🇧🇪" },
  { code: "CRO", name: "克罗地亚", flag: "🇭🇷" },
  { code: "URU", name: "乌拉圭", flag: "🇺🇾" },
  { code: "COL", name: "哥伦比亚", flag: "🇨🇴" },
  { code: "MEX", name: "墨西哥", flag: "🇲🇽" },
  { code: "USA", name: "美国", flag: "🇺🇸" },
  { code: "JPN", name: "日本", flag: "🇯🇵" },
  { code: "KOR", name: "韩国", flag: "🇰🇷" },
  { code: "CHN", name: "中国", flag: "🇨🇳" },
  { code: "NGA", name: "尼日利亚", flag: "🇳🇬" },
  { code: "SEN", name: "塞内加尔", flag: "🇸🇳" },
  { code: "GHA", name: "加纳", flag: "🇬🇭" },
  { code: "CIV", name: "科特迪瓦", flag: "🇨🇮" },
  { code: "MAR", name: "摩洛哥", flag: "🇲🇦" },
  { code: "POL", name: "波兰", flag: "🇵🇱" },
  { code: "DEN", name: "丹麦", flag: "🇩🇰" },
  { code: "SWE", name: "瑞典", flag: "🇸🇪" },
  { code: "NOR", name: "挪威", flag: "🇳🇴" },
  { code: "SUI", name: "瑞士", flag: "🇨🇭" },
  { code: "AUT", name: "奥地利", flag: "🇦🇹" },
  { code: "TUR", name: "土耳其", flag: "🇹🇷" },
  { code: "SRB", name: "塞尔维亚", flag: "🇷🇸" },
  { code: "UKR", name: "乌克兰", flag: "🇺🇦" },
  { code: "SCO", name: "苏格兰", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { code: "WAL", name: "威尔士", flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿" },
  { code: "IRL", name: "爱尔兰", flag: "🇮🇪" },
  { code: "AUS", name: "澳大利亚", flag: "🇦🇺" },
];

/** 三级联赛：1 最高，3 最低；开局仅可选第 3 级；每级 20 队 */
export const DIVISIONS = {
  1: { id: 1, name: "超级联赛", short: "超联", promote: 0, relegate: 3 },
  2: { id: 2, name: "甲级联赛", short: "甲级", promote: 3, relegate: 3 },
  3: { id: 3, name: "乙级联赛", short: "乙级", promote: 3, relegate: 0 },
};

export const START_DIVISION = 3;

/** 60 队名单见 clubs.js */
export { CLUB_TEMPLATES } from "./clubs.js";

/** 阵型：位置槽位 { pos: GK|DEF|MID|ATT, x: 0-100, y: 0-100 } y=0 己方球门 */
export const FORMATIONS = {
  "4-3-3": {
    name: "4-3-3",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 28, y: 48 }, { pos: "MID", x: 50, y: 52 }, { pos: "MID", x: 72, y: 48 },
      { pos: "ATT", x: 22, y: 22 }, { pos: "ATT", x: 50, y: 18 }, { pos: "ATT", x: 78, y: 22 },
    ],
  },
  "4-4-2": {
    name: "4-4-2",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 18, y: 48 }, { pos: "MID", x: 40, y: 50 },
      { pos: "MID", x: 60, y: 50 }, { pos: "MID", x: 82, y: 48 },
      { pos: "ATT", x: 38, y: 20 }, { pos: "ATT", x: 62, y: 20 },
    ],
  },
  "3-5-2": {
    name: "3-5-2",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 28, y: 74 }, { pos: "DEF", x: 50, y: 76 }, { pos: "DEF", x: 72, y: 74 },
      { pos: "MID", x: 15, y: 50 }, { pos: "MID", x: 35, y: 48 }, { pos: "MID", x: 50, y: 55 },
      { pos: "MID", x: 65, y: 48 }, { pos: "MID", x: 85, y: 50 },
      { pos: "ATT", x: 38, y: 20 }, { pos: "ATT", x: 62, y: 20 },
    ],
  },
  "4-2-3-1": {
    name: "4-2-3-1",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 18, y: 72 }, { pos: "DEF", x: 38, y: 75 },
      { pos: "DEF", x: 62, y: 75 }, { pos: "DEF", x: 82, y: 72 },
      { pos: "MID", x: 38, y: 55 }, { pos: "MID", x: 62, y: 55 },
      { pos: "MID", x: 22, y: 35 }, { pos: "MID", x: 50, y: 38 }, { pos: "MID", x: 78, y: 35 },
      { pos: "ATT", x: 50, y: 16 },
    ],
  },
  "5-3-2": {
    name: "5-3-2",
    slots: [
      { pos: "GK", x: 50, y: 92 },
      { pos: "DEF", x: 12, y: 68 }, { pos: "DEF", x: 30, y: 74 }, { pos: "DEF", x: 50, y: 76 },
      { pos: "DEF", x: 70, y: 74 }, { pos: "DEF", x: 88, y: 68 },
      { pos: "MID", x: 30, y: 48 }, { pos: "MID", x: 50, y: 50 }, { pos: "MID", x: 70, y: 48 },
      { pos: "ATT", x: 38, y: 20 }, { pos: "ATT", x: 62, y: 20 },
    ],
  },
};

export const POS_LABEL = { GK: "门将", DEF: "后卫", MID: "中场", ATT: "前锋" };

export const STYLE_MOD = {
  balanced: { atk: 1, def: 1, possession: 1 },
  attack: { atk: 1.12, def: 0.9, possession: 1.05 },
  defend: { atk: 0.88, def: 1.14, possession: 0.95 },
  possession: { atk: 1.02, def: 1.02, possession: 1.15 },
  counter: { atk: 1.08, def: 1.05, possession: 0.85 },
};
