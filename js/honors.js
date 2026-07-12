/** 球员个人荣誉（无依赖 engine，避免循环引用） */

import { DIVISIONS } from "./data.js";
import { pushMedia } from "./media.js";

export function ensureHonors(p) {
  if (!Array.isArray(p.honors)) p.honors = [];
  return p.honors;
}

export function grantHonor(p, honor) {
  ensureHonors(p);
  if (
    p.honors.some(
      (h) =>
        h.season === honor.season &&
        h.type === honor.type &&
        h.division === honor.division
    )
  ) {
    return false;
  }
  p.honors.unshift(honor);
  if (p.honors.length > 40) p.honors.length = 40;
  p.morale = Math.min(100, (p.morale || 70) + 4);
  return true;
}

export const HONOR_LABELS = {
  golden_boot: "金靴奖",
  assist_king: "助攻王",
  best_gk: "最佳门将",
  poty: "赛季最佳球员",
  team_of_season: "赛季最佳阵容",
  champion: "联赛冠军",
  promotion: "升级功臣",
  intl_caps_10: "国家队10场",
  intl_caps_25: "国家队25场",
  intl_caps_50: "国家队50场",
};

function sortedTable(world, division) {
  return world.clubs
    .filter((c) => (c.division || 3) === division)
    .map((c) => {
      const t = world.table[c.id] || {
        played: 0,
        w: 0,
        d: 0,
        l: 0,
        gf: 0,
        ga: 0,
        pts: 0,
      };
      return {
        id: c.id,
        name: c.name,
        ...t,
        gd: (t.gf || 0) - (t.ga || 0),
      };
    })
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

function leadersInDivision(world, division) {
  const all = [];
  for (const club of world.clubs) {
    if ((club.division || 3) !== division) continue;
    for (const p of club.players) {
      const s = p.stats || {};
      all.push({ player: p, club, s });
    }
  }
  const goals = all
    .filter((x) => (x.s.goals || 0) > 0)
    .sort((a, b) => b.s.goals - a.s.goals || b.s.assists - a.s.assists)
    .slice(0, 5);
  const assists = all
    .filter((x) => (x.s.assists || 0) > 0)
    .sort((a, b) => b.s.assists - a.s.assists || b.s.goals - a.s.goals)
    .slice(0, 5);
  const keepers = all
    .filter((x) => x.player.pos === "GK" && (x.s.apps || 0) > 0)
    .sort(
      (a, b) =>
        (b.s.cleanSheets || 0) - (a.s.cleanSheets || 0) ||
        (a.s.goalsConceded || 0) - (b.s.goalsConceded || 0)
    )
    .slice(0, 5);
  return { goals, assists, keepers, all };
}

/**
 * 赛季末颁发各级联赛个人荣誉
 */
export function awardSeasonHonors(world) {
  const season = world.season;
  const grantedUser = [];

  for (const div of [1, 2, 3]) {
    const divName = DIVISIONS[div]?.name || `第${div}级`;
    const table = sortedTable(world, div);
    if (table.length < 4) continue;

    const { goals, assists, keepers, all } = leadersInDivision(world, div);

    if (goals[0]) {
      const { player, club, s } = goals[0];
      if (
        grantHonor(player, {
          season,
          type: "golden_boot",
          title: `${divName}金靴`,
          detail: `${s.goals} 球`,
          clubId: club.id,
          clubName: club.name,
          division: div,
        }) &&
        club.id === world.userClubId
      ) {
        grantedUser.push(`${player.name} · ${divName}金靴`);
      }
    }

    if (assists[0]) {
      const { player, club, s } = assists[0];
      if (
        grantHonor(player, {
          season,
          type: "assist_king",
          title: `${divName}助攻王`,
          detail: `${s.assists} 助攻`,
          clubId: club.id,
          clubName: club.name,
          division: div,
        }) &&
        club.id === world.userClubId
      ) {
        grantedUser.push(`${player.name} · ${divName}助攻王`);
      }
    }

    if (keepers[0]) {
      const { player, club, s } = keepers[0];
      if (
        grantHonor(player, {
          season,
          type: "best_gk",
          title: `${divName}最佳门将`,
          detail: `零封 ${s.cleanSheets || 0}`,
          clubId: club.id,
          clubName: club.name,
          division: div,
        }) &&
        club.id === world.userClubId
      ) {
        grantedUser.push(`${player.name} · ${divName}最佳门将`);
      }
    }

    // 赛季最佳球员
    const scored = all
      .map(({ player, club, s }) => ({
        player,
        club,
        score:
          (s.goals || 0) * 3 +
          (s.assists || 0) * 2 +
          (s.cleanSheets || 0) * 2 +
          (s.apps || 0) * 0.15 +
          (player.ovr || 0) * 0.5,
      }))
      .sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score > 2) {
      const { player, club } = scored[0];
      if (
        grantHonor(player, {
          season,
          type: "poty",
          title: `${divName}赛季最佳球员`,
          detail: `能力 ${player.ovr}`,
          clubId: club.id,
          clubName: club.name,
          division: div,
        }) &&
        club.id === world.userClubId
      ) {
        grantedUser.push(`${player.name} · ${divName}赛季最佳`);
      }
    }

    // 最佳阵容
    for (const { player, club } of pickTeamOfSeason(scored)) {
      if (
        grantHonor(player, {
          season,
          type: "team_of_season",
          title: `${divName}最佳阵容`,
          detail: player.pos,
          clubId: club.id,
          clubName: club.name,
          division: div,
        }) &&
        club.id === world.userClubId
      ) {
        grantedUser.push(`${player.name} · 最佳阵容`);
      }
    }

    // 冠军成员
    const champ = table[0];
    if (champ) {
      const club = world.clubs.find((c) => c.id === champ.id);
      if (club) {
        for (const p of club.players) {
          if ((p.stats?.apps || 0) < 3) continue;
          grantHonor(p, {
            season,
            type: "champion",
            title: `${divName}冠军`,
            detail: club.name,
            clubId: club.id,
            clubName: club.name,
            division: div,
          });
        }
        if (club.id === world.userClubId) {
          grantedUser.push(`全队 · ${divName}冠军`);
          pushMedia(world, {
            outlet: "联赛日报",
            headline: `荣耀！${club.name} 加冕${divName}冠军`,
            body: `球员们举起奖杯，烟火点亮夜空。这是写进俱乐部史册的一夜。`,
            tone: "positive",
            category: "league",
          });
        }
      }
    }
  }

  // 国家队里程碑
  for (const c of world.clubs) {
    for (const p of c.players) {
      const caps = p.intl?.caps || 0;
      for (const [th, type] of [
        [10, "intl_caps_10"],
        [25, "intl_caps_25"],
        [50, "intl_caps_50"],
      ]) {
        if (caps >= th) {
          const ok = grantHonor(p, {
            season,
            type,
            title: HONOR_LABELS[type],
            detail: `${caps} 次出场`,
            clubId: c.id,
            clubName: c.name,
            division: c.division,
          });
          if (ok && c.id === world.userClubId) {
            grantedUser.push(`${p.name} · ${HONOR_LABELS[type]}`);
          }
        }
      }
    }
  }

  if (grantedUser.length) {
    world.news.unshift({
      day: world.day,
      text: `🏅 个人荣誉：${grantedUser.slice(0, 8).join("；")}${
        grantedUser.length > 8 ? "…" : ""
      }`,
    });
  }

  return grantedUser;
}

function pickTeamOfSeason(scored) {
  const need = { GK: 1, DEF: 4, MID: 3, ATT: 3 };
  const picked = [];
  const used = new Set();
  for (const pos of ["GK", "DEF", "MID", "ATT"]) {
    const pool = scored
      .filter((x) => x.player.pos === pos && !used.has(x.player.id))
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < need[pos] && i < pool.length; i++) {
      used.add(pool[i].player.id);
      picked.push(pool[i]);
    }
  }
  return picked;
}
