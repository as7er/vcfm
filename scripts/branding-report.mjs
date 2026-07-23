import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CLUB_TEMPLATES } from "../js/clubs.js";
import { COUNTRIES, DIVISIONS } from "../js/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const output = resolve(repo, "docs", "branding-migration.md");
const counts = Object.fromEntries(
  Object.keys(DIVISIONS).map((id) => [id, CLUB_TEMPLATES.filter((club) => club.division === Number(id)).length])
);

const legacyCountries = {
  crownland: "克朗兰 / Crownland",
  solara: "索拉拉 / Solara",
  eisenmark: "艾森马克 / Eisenmark",
  belladoro: "贝拉多罗 / Belladoro",
  lumera: "卢梅拉 / Lumera",
};
const legacyLeagues = {
  1: "王冠超级联赛 / Crown Premier League",
  2: "王冠甲级联赛 / Crown Championship",
  3: "王冠乙级联赛 / Crown League Two",
  4: "索拉拉荣耀联赛 / Solara Glory League",
  5: "索拉拉挑战联赛 / Solara Challenge League",
  6: "艾森马克铁冠联赛 / Eisenmark Iron Crown",
  7: "艾森马克锻造联赛 / Eisenmark Forge League",
  8: "贝拉多罗金星联赛 / Belladoro Golden Star",
  9: "贝拉多罗银环联赛 / Belladoro Silver Ring",
  10: "卢梅拉光辉联赛 / Lumera Radiant League",
  11: "卢梅拉晨曦联赛 / Lumera Dawn League",
};

const lines = [
  "# VCFM 品牌迁移清单",
  "",
  "> 本文档由 `scripts/branding-report.mjs` 从集中式品牌数据生成。旧名称仅用于审查和旧存档迁移，不参与前台展示或业务关联。",
  "",
  "## 现状盘点",
  "",
  "- 国家与联赛元数据：`js/branding.js`，由 `js/data.js` 适配现有模型后导出。",
  "- 俱乐部、经济参数与完整品牌映射：`js/clubs.js`。",
  "- 球员、俱乐部与联赛赛程生成：`js/models.js`。",
  "- 存档编码与槽位摘要：`js/save.js`；旧世界迁移入口：`migrateWorld()`（`js/main.js`）。",
  "- 杯赛与洲际赛事：`js/cup.js`。",
  "- 队徽没有外部图片；`crest` 是通用程序化参数。球衣由 `ensureKit()` 与 `kitBackground()` 生成。",
  "- 球员用 `player.clubId`，赛程用 `fixture.home` / `fixture.away`，积分榜用 clubId 键；转会、租借、新闻、荣誉和用户执教球队也以 ID 关联。未发现用俱乐部显示名做主键的业务关系。",
  "- 存档保存完整俱乐部对象、球员、赛程、积分榜和赛事对象；加载时按 clubId 刷新当前品牌，不清空或重建这些数据。",
  "- 主要影响页面：开局国家/俱乐部选择、顶栏、积分榜、俱乐部详情、赛程、比赛计分板、转会、新闻、荣誉和存档槽摘要。",
  "",
  "## 国家迁移",
  "",
  "| internal countryId | countryCode | 旧显示名 | 新中文名 | 新英文名 |",
  "|---|---|---|---|---|",
  ...Object.values(COUNTRIES).map(
    (country) => `| ${country.id} | ${country.countryCode} | ${legacyCountries[country.id]} | ${country.nameZh} | ${country.nameEn} |`
  ),
  "",
  "## 联赛迁移",
  "",
  "| leagueId | countryCode | 旧显示名 | 新中文名 | 新英文名 | 简称 | 俱乐部数 |",
  "|---:|---|---|---|---|---|---:|",
  ...Object.values(DIVISIONS).map(
    (league) => `| ${league.id} | ${league.countryCode} | ${legacyLeagues[league.id]} | ${league.nameZh} | ${league.nameEn} | ${league.shortName} | ${counts[league.id]} |`
  ),
  "",
  "## 俱乐部完整映射",
  "",
  "| clubId | 旧名称 | 新中文名 | 新英文名 | 简称 | 国家 | leagueId | 主色 | 辅色 | 新球场 | 队徽 | 旧档 |",
  "|---|---|---|---|---|---|---:|---|---|---|---|---|",
  ...CLUB_TEMPLATES.map((club) => {
    const brand = club.branding;
    return `| ${club.id} | ${brand.legacyName} | ${brand.nameZh} | ${brand.nameEn} | ${brand.shortName} | ${brand.countryCode} | ${brand.leagueId} | ${brand.colors.primary} | ${brand.colors.secondary} | ${brand.stadiumZh} / ${brand.stadiumEn} | ${brand.crest.shape} + ${brand.crest.symbol} | 按 ID 刷新 |`;
  }),
  "",
  "## 迁移原则",
  "",
  "- 保留 internal countryId、leagueId 和 clubId。",
  "- `countryCode` 使用 ENG、ESP、ITA、GER、FRA；内部旧 countryId 只作为兼容键。",
  "- 俱乐部升降级后以当前 `division` 作为 `leagueId`，品牌映射中的 leagueId 仅记录初始归属。",
  "- 旧存档名称、简称、颜色、球衣和队徽快照按 clubId 覆盖；能力、预算、球员、赛程、积分和执教关系不变。",
  "- 未知 clubId 保留原数据作为安全 fallback。",
  "- 历史新闻和比赛报告中的文本快照不强制改写，避免破坏历史记录。",
  "",
];

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, lines.join("\n"), "utf8");
console.log(`Wrote ${CLUB_TEMPLATES.length} club mappings to ${output}`);
