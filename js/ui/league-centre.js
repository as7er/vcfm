/**
 * VCFM · 联赛中心：积分榜与数据榜
 *
 * 这两页共享 selectedLeagueDivision / selectedStatsDivision 两个筛选状态，
 * 且互相写入（选联赛会同步数据榜范围，反之亦然），因此必须同模块拆出。
 * 状态仍由 main.js 托管：这里通过 state 对象读写，main.js 负责持久化到
 * 自己的模块变量，避免同一份筛选出现两个真相。
 */

import { $, escapeHtml } from "./dom.js";
import { clubLinkHtml, playerLinkHtml } from "./links.js";
import { getLang, t } from "../i18n.js";
import { DIVISIONS } from "../data.js";
import { getSortedTable, getStatLeaders } from "../engine.js";
import {
  seasonAvgRating,
  ratingClass,
  formatRating,
  ensurePlayerHistory,
  emptyMatchStats,
} from "../models.js";

function playerStats(p) {
  ensurePlayerHistory(p);
  return p.stats || emptyMatchStats();
}

function statsLeagueCompactLabel(division) {
  const info = DIVISIONS[Number(division)];
  if (!info) return "—";
  if (getLang() === "en") return `${info.countryCode} ${info.tier}`;
  const prefix = { ENG: "英", ESP: "西", GER: "德", ITA: "意", FRA: "法" }[info.countryCode] || info.countryCode;
  const tier = info.countryCode === "ENG"
    ? info.tier === 1
      ? "超"
      : info.tier === 2
        ? "甲"
        : "乙"
    : info.tier === 1
      ? "甲"
      : "乙";
  return `${prefix}${tier}`;
}

function statsLeagueCell(club) {
  const division = Number(club?.division || 0);
  const full = t(`div.${division}`) || DIVISIONS[division]?.name || "—";
  return `<td class="stats-league-cell" title="${escapeHtml(full)}">${escapeHtml(statsLeagueCompactLabel(division))}</td>`;
}

/**
 * 积分榜。
 * @param {object} world
 * @param {object} club 用户俱乐部
 * @param {{ leagueDivision: number|null, statsDivision: string }} state 筛选状态，就地更新后由调用方持久化
 * @param {{ fillDivisionSelects: (prefer: number|null) => void, onRerender: () => void }} deps
 */
export function renderTable(world, club, state, deps) {
  if (!world) return;
  const { fillDivisionSelects, onRerender } = deps;
  const sel = $("#table-division");
  fillDivisionSelects(club?.division || 3);
  const requestedDivision = Number(state.leagueDivision || club?.division || 3);
  state.leagueDivision = DIVISIONS[requestedDivision]
    ? requestedDivision
    : Number(club?.division || 3);
  if (sel) sel.value = String(state.leagueDivision);
  if (sel && !sel._bound) {
    sel._bound = true;
    sel.addEventListener("change", () => {
      sel.dataset.touched = "1";
      state.leagueDivision = Number(sel.value);
      state.statsDivision = sel.value;
      onRerender();
    });
  }
  const div = Number(state.leagueDivision || club.division || 3);
  const info = DIVISIONS[div] || DIVISIONS[3];
  const table = getSortedTable(world, div);
  const n = table.length;
  const en = getLang() === "en";

  const divLabel = t("div." + div) || info.name || "";
  $("#table-title").textContent = t("table.titleNamed", { name: divLabel });
  const parts = [`${n} ${en ? "clubs" : "支球队"}`];
  if (info.promote) {
    const up = DIVISIONS[info.upperDivision];
    const upName = up ? t("div." + info.upperDivision) || up.name : en ? "upper tier" : "上级";
    parts.push(en ? `top ${info.promote} promote to ${upName}` : `前 ${info.promote} 名升${upName}`);
  }
  if (info.relegate) {
    const low = DIVISIONS[info.lowerDivision];
    const lowName = low ? t("div." + info.lowerDivision) || low.name : en ? "lower tier" : "下级";
    parts.push(en ? `bottom ${info.relegate} relegate to ${lowName}` : `后 ${info.relegate} 名降${lowName}`);
  }
  $("#table-hint").textContent = parts.join(en ? " · " : " · ");

  const tbody = $("#league-table tbody");
  const upN = info.promote || 0;
  const downN = info.relegate || 0;
  tbody.innerHTML = table.length
    ? table
        .map((r, i) => {
          const me = r.id === world.userClubId;
          const rank = i + 1;
          let zone = "";
          if (upN && rank <= upN) zone = ` <span class="badge MID">${en ? "Promotion" : "升级区"}</span>`;
          if (downN && rank > n - downN) zone = ` <span class="badge ATT">${en ? "Relegation" : "降级区"}</span>`;
          return `<tr class="${me ? "me" : ""}">
            <td>${rank}</td>
            <td>${clubLinkHtml(r.id, r.name)}${me ? " ★" : ""}${zone}</td>
            <td>${r.played}</td>
            <td>${r.w}</td>
            <td>${r.d}</td>
            <td>${r.l}</td>
            <td>${r.gf}</td>
            <td>${r.ga}</td>
            <td>${r.gd > 0 ? "+" : ""}${r.gd}</td>
            <td><strong>${r.pts}</strong></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="10" class="muted">${en ? "No clubs in this division. Start a new save to use the complete seven-nation league structure." : "该级别暂无球队（请开新档体验完整七国联赛）"}</td></tr>`;
}

/** 数据榜的范围选择器；返回当前生效范围 */
function renderStatsScope(state, onRerender) {
  const select = $("#stats-division-filter");
  if (!select) return state.statsDivision;
  const ids = Object.keys(DIVISIONS).map(Number).sort((a, b) => a - b);
  const requested = state.statsDivision;
  select.innerHTML = [
    `<option value="all">${escapeHtml(t("stats.allLeagues"))}</option>`,
    ...ids.map((id) => `<option value="${id}">${escapeHtml(t(`div.${id}`) || DIVISIONS[id]?.name || String(id))}</option>`),
  ].join("");
  select.value = requested === "all" || ids.includes(Number(requested)) ? String(requested) : "all";
  state.statsDivision = select.value;
  if (!select._bound) {
    select._bound = true;
    select.addEventListener("change", () => {
      state.statsDivision = select.value;
      if (select.value !== "all") state.leagueDivision = Number(select.value);
      onRerender();
    });
  }
  const summary = $("#stats-scope-summary");
  if (summary) {
    summary.textContent = state.statsDivision === "all"
      ? t("stats.scopeAllHint", { n: ids.length })
      : t("stats.scopeOneHint", { name: t(`div.${state.statsDivision}`) || "—" });
  }
  return state.statsDivision;
}

/**
 * 射手 / 助攻 / 评分 / 门将榜。
 * @param {object} world
 * @param {{ leagueDivision: number|null, statsDivision: string }} state
 * @param {() => void} onRerender 范围切换后重新渲染
 */
export function renderStats(world, state, onRerender) {
  if (!world) return;
  const scope = renderStatsScope(state, onRerender);
  const { goals, assists, keepers, ratings } = getStatLeaders(world, scope === "all" ? "all" : Number(scope));
  const uid = world.userClubId;
  const en = getLang() === "en";

  const goalsBody = $("#stats-goals tbody");
  goalsBody.innerHTML = goals.length
    ? goals
        .map(({ player: p, club, stats }, i) => {
          const s = stats || playerStats(p);
          const avgR = seasonAvgRating(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            ${statsLeagueCell(club)}
            <td><strong>${s.goals}</strong></td>
            <td>${s.assists}</td>
            <td>${s.apps}</td>
            <td class="rating-cell ${ratingClass(avgR)}">${formatRating(avgR)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="muted">${en ? "No goals yet in this scope. This table updates after matches." : "当前范围暂无进球数据，踢完比赛后更新"}</td></tr>`;

  const assistsBody = $("#stats-assists tbody");
  assistsBody.innerHTML = assists.length
    ? assists
        .map(({ player: p, club, stats }, i) => {
          const s = stats || playerStats(p);
          const avgR = seasonAvgRating(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            ${statsLeagueCell(club)}
            <td><strong>${s.assists}</strong></td>
            <td>${s.goals}</td>
            <td>${s.apps}</td>
            <td class="rating-cell ${ratingClass(avgR)}">${formatRating(avgR)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="muted">${en ? "No assists yet in this scope. This table updates after matches." : "当前范围暂无助攻数据，踢完比赛后更新"}</td></tr>`;

  const ratingsBody = $("#stats-ratings tbody");
  if (ratingsBody) {
    ratingsBody.innerHTML = ratings?.length
      ? ratings
          .map(({ player: p, club, avgRating, lastRating, apps }, i) => {
            const me = club.id === uid;
            return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            ${statsLeagueCell(club)}
            <td class="rating-cell ${ratingClass(avgRating)}"><strong>${formatRating(avgRating)}</strong></td>
            <td class="rating-cell ${ratingClass(lastRating)}">${formatRating(lastRating)}</td>
            <td>${apps}</td>
          </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="muted">${en ? "The ratings table appears after at least ten appearances in this scope." : "当前范围至少 10 场出场后显示评分榜"}</td></tr>`;
  }

  const keepersBody = $("#stats-keepers tbody");
  keepersBody.innerHTML = keepers.length
    ? keepers
        .map(({ player: p, club, stats, gaPerGame }, i) => {
          const s = stats || playerStats(p);
          const avgR = seasonAvgRating(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            ${statsLeagueCell(club)}
            <td>${s.apps}</td>
            <td><strong>${s.cleanSheets}</strong></td>
            <td>${s.goalsConceded}</td>
            <td>${gaPerGame.toFixed(2)}</td>
            <td class="rating-cell ${ratingClass(avgR)}">${formatRating(avgR)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="muted">${en ? "No goalkeeper data yet in this scope. This table updates after matches." : "当前范围暂无门将数据，踢完比赛后更新"}</td></tr>`;
}
