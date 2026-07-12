/**
 * 主题（日间 / 夜间）+ 多语言（中文 / English）
 * 设置存 localStorage，与存档无关。
 */

export const THEME_KEY = "vcfm-theme";
export const LANG_KEY = "vcfm-lang";
const OLD_THEME_KEY = "vc-fm-theme";
const OLD_LANG_KEY = "vc-fm-lang";

export const THEMES = ["dark", "light"];
export const LANGS = ["zh", "en"];

const dict = {
  zh: {
    // meta
    "app.title": "VCFM",
    "app.subtitle": "轻量足球经理 · 灵感来自 FM",

    // prefs
    "prefs.theme": "主题",
    "prefs.theme.dark": "夜间",
    "prefs.theme.light": "日间",
    "prefs.lang": "语言",
    "prefs.lang.zh": "中文",
    "prefs.lang.en": "EN",

    // start
    "start.manager": "经理姓名",
    "start.manager.placeholder": "教练",
    "start.club": "选择球队（仅乙级联赛）",
    "start.leagueHint": "三级联赛：乙级 → 甲级 → 超联。开局只能从乙级起步，争取升级！",
    "start.slots": "存档槽",
    "start.slotCurrent": "当前：槽 {n}",
    "start.saveTip": "换手机/浏览器请先导出存档；清缓存会丢进度。",
    "start.saveTipHtml": "换手机/浏览器请先<strong>导出存档</strong>；清缓存会丢进度。",
    "start.newGame": "开始新赛季",
    "start.loadGame": "读取当前槽",
    "start.export": "导出存档",
    "start.import": "导入到当前槽",
    "start.slotEmptyClick": "点击选中，再「开始新赛季」",
    "start.slotManager": "经理 {name}",
    "start.clubOption": "{name} · 乙级（实力 {power}）",
    "start.div3Only": "只能选择乙级联赛球队开局。",
    "start.overwriteConfirm": "开始新赛季将覆盖「槽 {n}」存档，确定？",
    "start.noSave": "槽 {n} 没有存档。",
    "start.noExport": "槽 {n} 没有可导出的存档。",
    "start.detectSave": "检测到存档（当前槽 {n}）。刷新会自动继续；也可点读取，或换设备前先导出。",
    "start.autoResume": "已自动读取槽 {n}",
    "start.filled": "共 {filled}/{total} 个存档 · 换设备请导出",
    "start.slotEmpty": "已选槽 {n}（空），可开始新赛季",
    "start.slotReady": "已选槽 {n}，可读取或覆盖",
    "start.slotDelete": "删除此槽存档",
    "start.slotDeleteShort": "删除",
    "start.slotDeleteConfirm": "确定删除槽 {n} 的存档？此操作不可恢复（建议先导出备份）。",
    "start.slotDeleted": "已删除槽 {n}",
    "start.slotDeleteFail": "删除失败",
    "start.backMenu": "已返回菜单。有存档可继续读取。",
    "start.backMenuEmpty": "已返回菜单。",

    // topbar
    "tab.dashboard": "概览",
    "tab.squad": "阵容",
    "tab.youth": "青训",
    "tab.facilities": "设施",
    "tab.staff": "职员",
    "tab.training": "训练",
    "tab.tactics": "战术",
    "tab.table": "积分榜",
    "tab.clubs": "俱乐部",
    "tab.stats": "数据榜",
    "tab.media": "媒体",
    "tab.transfer": "转会",
    "tab.career": "生涯",
    "tab.fixtures": "赛程",
    "btn.save": "存档",
    "btn.export": "导出",
    "btn.menu": "菜单",
    "top.season": "赛季 {n}",
    "top.day": "第 {n} 天",

    // dashboard
    "dash.nextMatch": "下一场比赛",
    "dash.noFixture": "暂无赛程",
    "dash.play": "进入比赛",
    "dash.advance": "推进一天",
    "dash.advanceMatchday": "推进到比赛日",
    "dash.advanceSeasonEnd": "推进到赛季末",
    "dash.advanceSeasonEndTitle": "自动推进，遇到我方比赛会停下",
    "dash.nextSeason": "进入下一赛季",
    "dash.rank": "联赛排名",
    "dash.board": "董事会目标",
    "dash.window": "转会窗",
    "dash.training": "训练日程",
    "dash.form": "近期战绩",
    "dash.career": "经理生涯",
    "dash.news": "新闻",
    "dash.noNext": "暂无下场比赛，可推进日程。",
    "dash.seasonOver": "赛季已结束",
    "dash.notMatchday": "尚未到比赛日",
    "dash.facilities": "俱乐部设施",
    "dash.trainHint": " · 在「训练」页调整",
    "dash.facHint": " · 在「设施」页扩建/升级",

    // squad
    "squad.title": "球队阵容",
    "squad.count": "{n} 名球员",
    "squad.appsTitle": "本赛季出场",
    "squad.goalsTitle": "本赛季进球",
    "squad.astTitle": "本赛季助攻",
    "squad.csTitle": "本赛季零封（门将）",
    "squad.gaTitle": "本赛季失球（门将）",
    "squad.seasonHint": "本赛季数据：出场 / 进球（门将为零封）/ 助攻（门将为失球）",
    "th.num": "#",
    "th.name": "姓名",
    "th.nation": "国籍",
    "th.pos": "位置",
    "th.age": "年龄",
    "th.ovr": "能力",
    "th.fit": "体能",
    "th.morale": "士气",
    "th.scout": "球探估值",
    "th.wage": "周薪",
    "th.pot": "潜力",
    "th.club": "球队",
    "th.goals": "进球",
    "th.assists": "助攻",
    "th.apps": "出场",
    "th.value": "身价",
    "th.round": "轮次",
    "th.date": "日期",
    "th.home": "主队",
    "th.score": "比分",
    "th.away": "客队",
    "th.status": "状态",
    "th.player": "球员",
    "th.gk": "门将",
    "th.cs": "零封",
    "th.ga": "失球",
    "th.gavg": "场均失球",
    "th.role": "职位",
    "th.fee": "签约费",
    "th.p": "赛",
    "th.w": "胜",
    "th.d": "平",
    "th.l": "负",
    "th.gf": "进",
    "th.gaShort": "失",
    "th.gd": "净",
    "th.pts": "分",
    "th.div": "联赛",
    "th.rank": "排名",
    "th.form": "近况",
    "th.squadAvg": "阵容",
    "th.money": "资金",

    // clubs browser
    "clubs.title": "俱乐部一览",
    "clubs.allDiv": "全部级别",
    "clubs.searchPh": "搜索队名…",
    "clubs.hint": "浏览三级联赛全部球队：积分、阵容实力、近期赛程。也可从积分榜或赛程点击队名打开。",
    "clubs.view": "查看",
    "clubs.empty": "没有匹配的俱乐部",
    "clubs.rank": "第 {n} 名",
    "clubs.pts": "{n} 分",
    "clubs.record": "{w}胜 {d}平 {l}负",
    "clubs.money": "资金",
    "clubs.squadAvg": "阵容均能",
    "clubs.power": "模板实力",
    "clubs.formHint": "近 5 场",
    "clubs.squad": "主力阵容",
    "clubs.squadHint": "共 {n} 名球员，按能力显示前 16 人（点击姓名查看详情）",
    "clubs.noSquad": "暂无球员",
    "clubs.upcoming": "接下来赛程",
    "clubs.recent": "近期战绩",
    "clubs.noFixtures": "暂无赛程",
    "clubs.honors": "俱乐部荣誉",
    "clubs.noHonors": "暂无荣誉记录",

    // youth
    "youth.title": "青训学院",
    "youth.upgrade": "升级设施",
    "youth.helpTitle": "说明",
    "youth.help1": "青训球员会随时间成长（每周概率涨属性）",
    "youth.help2": "约每 30 天自动招生",
    "youth.help3": "提拔可升入一线队；不合适可释放",
    "youth.help4": "升级学院可提高容量、招生数与成长速度",
    "youth.list": "青训名单",
    "youth.count": "{n} 名学员",
    "youth.maxed": "学院已是世界级，专心培养好苗子吧。也可在「设施」页查看球场与训练。",
    "youth.building": "正在升级至 Lv.{lv} {name}，完工后自动生效。",
    "youth.next": "下级：{name} · 容量 {cap} · 成长更快（「设施」页可一并管理球场/训练）",
    "youth.fullBtn": "已满级",
    "youth.buildingBtn": "施工中（{n} 天）",
    "youth.upBtn": "升级至 Lv.{lv}（{cost} · 有工期）",

    // facilities
    "fac.title": "俱乐部设施",
    "fac.hint": "扩建球场提高主场收入；升级训练设施加快成长与恢复；青训设施提高招生与培养。升级需建设工期，期间不可重复开工。",
    "fac.building": "施工中 · {n} 天后完工",
    "fac.maxed": "已满级",
    "fac.upgrade": "升级至 Lv.{lv}（{cost} · {days}天）",
    "fac.expand": "扩建至 Lv.{lv}（{cost} · {days}天）",
    "fac.buildNew": "新建至 Lv.{lv}（{cost} · {days}天）",

    // staff
    "staff.title": "教练团队",
    "staff.hint": "教练强化比赛与成长 · 球探优化转会与青训 · 队医降低伤病、加速恢复。周薪计入工资单。",
    "staff.market": "职员市场",
    "staff.refresh": "刷新候选人",

    // training
    "train.focus": "训练重点",
    "train.focusHint": "每日推进时生效；高强度更易成长也更易受伤。教练能力影响成长与恢复。",
    "train.intensity": "训练强度",
    "train.fitness": "阵容体能一览",

    // tactics
    "tac.formation": "阵型",
    "tac.style": "战术倾向",
    "tac.styleLabel": "风格",
    "tac.pressing": "压迫强度",
    "tac.tempo": "传球节奏",
    "tac.hint": "阵型与战术会影响比赛模拟结果。",
    "tac.autoXi": "自动排出最佳十一人",
    "style.balanced": "均衡",
    "style.attack": "进攻",
    "style.defend": "防守",
    "style.possession": "控球",
    "style.counter": "反击",

    // table
    "table.title": "联赛积分榜",
    "table.titleNamed": "{name}积分榜",
    "div.1": "超级联赛",
    "div.2": "甲级联赛",
    "div.3": "乙级联赛",

    // media
    "media.title": "媒体中心",
    "media.hint": "赛后通稿、转会官宣、青训特写、传闻与专栏都会出现在这里。",
    "media.count": "{n} 篇报道",

    // stats
    "stats.goals": "射手榜",
    "stats.assists": "助攻榜",
    "stats.keepers": "门将榜（零封 / 失球）",

    // transfer
    "tr.market": "转会市场",
    "tr.hint": "夏窗 D1–D35 · 冬窗 D120–D145；窗外无法买卖（AI 同样受限）。买入可谈合同年限与周薪。",
    "tr.poach": "来自其他俱乐部的报价",
    "tr.allPos": "全部位置",
    "tr.refresh": "刷新列表",
    "tr.sell": "可出售球员",
    "pos.GK": "门将",
    "pos.DEF": "后卫",
    "pos.MID": "中场",
    "pos.ATT": "前锋",

    // fixtures
    "fix.title": "本队赛程",
    "fix.played": "已赛",
    "fix.pending": "未赛",

    // match
    "match.htTitle": "中场休息 · 调整",
    "match.style": "风格",
    "match.pressing": "压迫",
    "match.tempo": "节奏",
    "match.subOut": "下场（在场）",
    "match.subIn": "上场（替补）",
    "match.addSub": "确认换人",
    "match.subsLeft": "剩余换人 {n} 次",
    "match.subsLeftFull": "剩余换人 {n} 次（本场最多 {max}）",
    "match.htContinue": "下半场开始",
    "match.htSkip": "不调整，直接踢",
    "match.commentary": "实时评论",
    "match.xg": "xG",
    "match.poss": "控球",
    "match.shots": "射门",
    "match.fast": "快速模拟（中场可调）",
    "match.live": "直播（中场可调）",
    "match.instant": "一键完赛",
    "match.speed": "倍速",
    "match.continue": "赛后继续",
    "match.report": "赛后报告",
    "match.reportMeta": "{meta} · 比分 {score}",
    "match.regular": "常规比赛",
    "match.stats": "数据",
    "match.xg": "期望进球 xG",
    "match.shots": "射门",
    "match.shotsOn": "射正",
    "match.poss": "控球 %",
    "match.corners": "角球",
    "match.fouls": "犯规",
    "match.yellows": "黄牌",
    "match.reds": "红牌",
    "match.saves": "扑救",
    "match.woodwork": "中柱/横梁",
    "match.scorers": "进球",
    "match.noMatch": "还没有可踢的比赛",
    "match.notDay": "尚未到比赛日，请推进日程",
    "match.pickSub": "请选择下场与上场球员",
    "match.subsFull": "换人次数已满",
    "match.subDup": "该球员已在换人列表中",
    "match.htScore": "半场 {home} {hg} - {ag} {away} · 可改战术与换人（最多 {max} 次，已用 {used}）",
    "match.err": "比赛模拟出错：{msg}",
    "match.err2": "下半场出错：{msg}",
    "match.cup": "VCFM 杯",
    "match.leagueRound": "联赛第 {n} 轮",

    // toast / common
    "toast.saved": "已存到槽 {n}",
    "toast.saveFail": "存档失败",
    "toast.exported": "存档已下载 · 换设备请导入此文件",
    "toast.exportFail": "导出失败",
    "toast.exportedOk": "存档已下载 · 请保存到网盘/文件，换设备可导入",
    "toast.importBad": "存档文件无效",
    "toast.imported": "已导入到槽 {n}",
    "toast.importFail": "导入失败",
    "toast.autoXi": "已自动排出最佳十一人",
    "toast.staffRefresh": "已刷新职员市场（-€50K）",
    "toast.staffRefreshFree": "资金不足，仍已刷新列表",
    "toast.trainFocus": "训练重点：{name}",
    "toast.trainInt": "训练强度：{name}",
    "toast.seasonOver": "赛季已结束，请进入下一赛季",
    "toast.playFirst": "今天有比赛，请先进入比赛！",
    "toast.matchday": "{label} · 比赛日到了！",
    "toast.seasonEndNews": "赛季结束！查看新闻中的退役与年龄变化",
    "toast.advanced": "推进 {n} 天",
    "common.buy": "买入",
    "common.sell": "出售",
    "common.details": "详情",
    "common.promote": "提拔",
    "common.release": "释放",
    "common.hire": "聘请",
    "common.fire": "解雇",
    "common.confirm": "确定",
    "common.cancel": "取消",
  },

  en: {
    "app.title": "VCFM",
    "app.subtitle": "Lightweight football manager · FM-inspired",

    "prefs.theme": "Theme",
    "prefs.theme.dark": "Night",
    "prefs.theme.light": "Day",
    "prefs.lang": "Lang",
    "prefs.lang.zh": "中文",
    "prefs.lang.en": "EN",

    "start.manager": "Manager name",
    "start.manager.placeholder": "Coach",
    "start.club": "Club (Division 3 only)",
    "start.leagueHint": "Three tiers: Div 3 → Div 2 → Premier. You must start in Div 3 and climb!",
    "start.slots": "Save slots",
    "start.slotCurrent": "Active: slot {n}",
    "start.saveTip": "Export before switching devices; clearing cache deletes saves.",
    "start.saveTipHtml": "Export your save before switching devices; <strong>clearing cache</strong> deletes progress.",
    "start.newGame": "New season",
    "start.loadGame": "Load active slot",
    "start.export": "Export save",
    "start.import": "Import to slot",
    "start.slotEmptyClick": "Select, then start a new season",
    "start.slotManager": "Manager {name}",
    "start.clubOption": "{name} · Div 3 (power {power})",
    "start.div3Only": "You can only start with a Division 3 club.",
    "start.overwriteConfirm": "Starting a new season will overwrite slot {n}. Continue?",
    "start.noSave": "Slot {n} is empty.",
    "start.noExport": "Slot {n} has nothing to export.",
    "start.detectSave": "Save found (slot {n}). Refresh auto-resumes; or load manually / export before switching devices.",
    "start.autoResume": "Resumed slot {n}",
    "start.filled": "{filled}/{total} slots used · export to move devices",
    "start.slotEmpty": "Slot {n} selected (empty) — ready for a new season",
    "start.slotReady": "Slot {n} selected — load or overwrite",
    "start.slotDelete": "Delete this slot",
    "start.slotDeleteShort": "Delete",
    "start.slotDeleteConfirm": "Delete save in slot {n}? This cannot be undone (export first if unsure).",
    "start.slotDeleted": "Slot {n} deleted",
    "start.slotDeleteFail": "Delete failed",
    "start.backMenu": "Back to menu. You can load a save.",
    "start.backMenuEmpty": "Back to menu.",

    "tab.dashboard": "Home",
    "tab.squad": "Squad",
    "tab.youth": "Youth",
    "tab.facilities": "Facilities",
    "tab.staff": "Staff",
    "tab.training": "Training",
    "tab.tactics": "Tactics",
    "tab.table": "Table",
    "tab.clubs": "Clubs",
    "tab.stats": "Stats",
    "tab.media": "Media",
    "tab.transfer": "Transfers",
    "tab.career": "Career",
    "tab.fixtures": "Fixtures",
    "btn.save": "Save",
    "btn.export": "Export",
    "btn.menu": "Menu",
    "top.season": "Season {n}",
    "top.day": "Day {n}",

    "dash.nextMatch": "Next match",
    "dash.noFixture": "No fixtures",
    "dash.play": "Play match",
    "dash.advance": "Advance 1 day",
    "dash.advanceMatchday": "To next matchday",
    "dash.advanceSeasonEnd": "To season end",
    "dash.advanceSeasonEndTitle": "Auto-advance; stops on your matchdays",
    "dash.nextSeason": "Next season",
    "dash.rank": "League position",
    "dash.board": "Board objective",
    "dash.window": "Transfer window",
    "dash.training": "Training plan",
    "dash.form": "Recent form",
    "dash.career": "Manager career",
    "dash.news": "News",
    "dash.noNext": "No upcoming match — advance the calendar.",
    "dash.seasonOver": "Season over",
    "dash.notMatchday": "Not matchday yet",
    "dash.facilities": "Club facilities",
    "dash.trainHint": " · edit on Training tab",
    "dash.facHint": " · upgrade on Facilities tab",

    "squad.title": "Squad",
    "squad.count": "{n} players",
    "squad.appsTitle": "Season appearances",
    "squad.goalsTitle": "Season goals",
    "squad.astTitle": "Season assists",
    "squad.csTitle": "Season clean sheets (GK)",
    "squad.gaTitle": "Season goals conceded (GK)",
    "squad.seasonHint": "Season stats: Apps / Goals (CS for GK) / Assists (GA for GK)",
    "th.num": "#",
    "th.name": "Name",
    "th.nation": "Nat",
    "th.pos": "Pos",
    "th.age": "Age",
    "th.ovr": "OVR",
    "th.fit": "Fit",
    "th.morale": "Mor",
    "th.scout": "Scout value",
    "th.wage": "Wage",
    "th.pot": "Pot",
    "th.club": "Club",
    "th.goals": "G",
    "th.assists": "A",
    "th.apps": "Apps",
    "th.value": "Value",
    "th.round": "Rd",
    "th.date": "Day",
    "th.home": "Home",
    "th.score": "Score",
    "th.away": "Away",
    "th.status": "Status",
    "th.player": "Player",
    "th.gk": "GK",
    "th.cs": "CS",
    "th.ga": "GA",
    "th.gavg": "GA/g",
    "th.role": "Role",
    "th.fee": "Fee",
    "th.p": "P",
    "th.w": "W",
    "th.d": "D",
    "th.l": "L",
    "th.gf": "GF",
    "th.gaShort": "GA",
    "th.gd": "GD",
    "th.pts": "Pts",
    "th.div": "Div",
    "th.rank": "Pos",
    "th.form": "Form",
    "th.squadAvg": "Squad",
    "th.money": "Cash",

    "clubs.title": "Clubs",
    "clubs.allDiv": "All divisions",
    "clubs.searchPh": "Search clubs…",
    "clubs.hint": "Browse all clubs: table position, squad strength and fixtures. Click a name on the table or fixtures list too.",
    "clubs.view": "View",
    "clubs.empty": "No clubs match",
    "clubs.rank": "Pos {n}",
    "clubs.pts": "{n} pts",
    "clubs.record": "{w}W {d}D {l}L",
    "clubs.money": "Cash",
    "clubs.squadAvg": "Avg OVR",
    "clubs.power": "Power",
    "clubs.formHint": "Last 5",
    "clubs.squad": "Squad",
    "clubs.squadHint": "{n} players — top 16 by OVR (click name for profile)",
    "clubs.noSquad": "No players",
    "clubs.upcoming": "Upcoming",
    "clubs.recent": "Recent results",
    "clubs.noFixtures": "No fixtures",
    "clubs.honors": "Club honours",
    "clubs.noHonors": "No honours yet",

    "youth.title": "Youth academy",
    "youth.upgrade": "Upgrade facility",
    "youth.helpTitle": "How it works",
    "youth.help1": "Youth players grow over time (weekly attribute gains)",
    "youth.help2": "New intake about every 30 days",
    "youth.help3": "Promote to first team or release",
    "youth.help4": "Higher academy level: capacity, intake, growth",
    "youth.list": "Youth list",
    "youth.count": "{n} prospects",
    "youth.maxed": "World-class academy. Focus on developing talent. Check Facilities for stadium & training.",
    "youth.building": "Upgrading to Lv.{lv} {name} — applies when finished.",
    "youth.next": "Next: {name} · cap {cap} · faster growth (also on Facilities tab)",
    "youth.fullBtn": "Max level",
    "youth.buildingBtn": "Building ({n}d)",
    "youth.upBtn": "Upgrade to Lv.{lv} ({cost} · build time)",

    "fac.title": "Club facilities",
    "fac.hint": "Expand the stadium for matchday income; upgrade training for growth & recovery; youth facilities for intake. Builds take time; one project per facility.",
    "fac.building": "Building · {n}d left",
    "fac.maxed": "Max level",
    "fac.upgrade": "Upgrade to Lv.{lv} ({cost} · {days}d)",
    "fac.expand": "Expand to Lv.{lv} ({cost} · {days}d)",
    "fac.buildNew": "Rebuild to Lv.{lv} ({cost} · {days}d)",

    "staff.title": "Coaching staff",
    "staff.hint": "Coach: matches & growth · Scout: transfers & youth · Doctor: injuries & recovery. Wages count weekly.",
    "staff.market": "Staff market",
    "staff.refresh": "Refresh candidates",

    "train.focus": "Training focus",
    "train.focusHint": "Applies each day. Higher intensity grows faster but risks injury. Coach rating matters.",
    "train.intensity": "Intensity",
    "train.fitness": "Squad fitness",

    "tac.formation": "Formation",
    "tac.style": "Tactics",
    "tac.styleLabel": "Style",
    "tac.pressing": "Pressing",
    "tac.tempo": "Tempo",
    "tac.hint": "Formation and tactics affect match simulation.",
    "tac.autoXi": "Auto best XI",
    "style.balanced": "Balanced",
    "style.attack": "Attacking",
    "style.defend": "Defensive",
    "style.possession": "Possession",
    "style.counter": "Counter",

    "table.title": "League table",
    "table.titleNamed": "{name} table",
    "div.1": "Premier Division",
    "div.2": "Championship",
    "div.3": "Division 3",

    "media.title": "Media centre",
    "media.hint": "Match reports, transfers, youth features, rumours and columns appear here.",
    "media.count": "{n} stories",

    "stats.goals": "Top scorers",
    "stats.assists": "Assists",
    "stats.keepers": "Goalkeepers (clean sheets / GA)",

    "tr.market": "Transfer market",
    "tr.hint": "Summer D1–35 · Winter D120–145. No buys/sells outside the window (AI included). Negotiate contract years & wages when buying.",
    "tr.poach": "Incoming bids",
    "tr.allPos": "All positions",
    "tr.refresh": "Refresh list",
    "tr.sell": "Players for sale",
    "pos.GK": "GK",
    "pos.DEF": "DEF",
    "pos.MID": "MID",
    "pos.ATT": "ATT",

    "fix.title": "Club fixtures",
    "fix.played": "Played",
    "fix.pending": "Upcoming",

    "match.htTitle": "Half-time · Adjust",
    "match.style": "Style",
    "match.pressing": "Press",
    "match.tempo": "Tempo",
    "match.subOut": "Off (on pitch)",
    "match.subIn": "On (bench)",
    "match.addSub": "Confirm sub",
    "match.subsLeft": "{n} subs left",
    "match.subsLeftFull": "{n} subs left (max {max})",
    "match.htContinue": "Start 2nd half",
    "match.htSkip": "No changes — play",
    "match.commentary": "Commentary",
    "match.xg": "xG",
    "match.poss": "Poss.",
    "match.shots": "Shots",
    "match.fast": "Quick sim (HT break)",
    "match.live": "Live (HT break)",
    "match.instant": "Instant full match",
    "match.speed": "Speed",
    "match.continue": "Continue",
    "match.report": "Match report",
    "match.reportMeta": "{meta} · {score}",
    "match.regular": "Standard match",
    "match.stats": "Stats",
    "match.xg": "xG",
    "match.shots": "Shots",
    "match.shotsOn": "On target",
    "match.poss": "Possession %",
    "match.corners": "Corners",
    "match.fouls": "Fouls",
    "match.yellows": "Yellows",
    "match.reds": "Reds",
    "match.saves": "Saves",
    "match.woodwork": "Woodwork",
    "match.scorers": "Goals",
    "match.noMatch": "No match available",
    "match.notDay": "Not matchday yet — advance the calendar",
    "match.pickSub": "Pick player off and on",
    "match.subsFull": "No substitutions left",
    "match.subDup": "Player already in sub list",
    "match.htScore": "HT {home} {hg} - {ag} {away} · tactics & subs (max {max}, used {used})",
    "match.err": "Match error: {msg}",
    "match.err2": "2nd half error: {msg}",
    "match.cup": "VCFM Cup",
    "match.leagueRound": "League round {n}",

    "toast.saved": "Saved to slot {n}",
    "toast.saveFail": "Save failed",
    "toast.exported": "Save downloaded · import on the other device",
    "toast.exportFail": "Export failed",
    "toast.exportedOk": "Save downloaded · keep the file for other devices",
    "toast.importBad": "Invalid save file",
    "toast.imported": "Imported into slot {n}",
    "toast.importFail": "Import failed",
    "toast.autoXi": "Best XI selected",
    "toast.staffRefresh": "Staff market refreshed (−€50K)",
    "toast.staffRefreshFree": "Not enough money — list refreshed anyway",
    "toast.trainFocus": "Focus: {name}",
    "toast.trainInt": "Intensity: {name}",
    "toast.seasonOver": "Season over — start the next season",
    "toast.playFirst": "You have a match today — play it first!",
    "toast.matchday": "{label} · Matchday!",
    "toast.seasonEndNews": "Season over! Check news for ageing & retirements",
    "toast.advanced": "Advanced {n} days",
    "common.buy": "Buy",
    "common.sell": "Sell",
    "common.details": "Details",
    "common.promote": "Promote",
    "common.release": "Release",
    "common.hire": "Hire",
    "common.fire": "Fire",
    "common.confirm": "OK",
    "common.cancel": "Cancel",
  },
};

let currentLang = "zh";
let currentTheme = "dark";

export function getLang() {
  return currentLang;
}

export function getTheme() {
  return currentTheme;
}

/** 插值：t('key', { n: 1 }) */
export function t(key, vars) {
  const table = dict[currentLang] || dict.zh;
  let s = table[key] ?? dict.zh[key] ?? key;
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

export function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY) || localStorage.getItem(OLD_LANG_KEY);
    if (saved && LANGS.includes(saved)) return saved;
  } catch (_) {}
  const nav = (navigator.language || "zh").toLowerCase();
  if (nav.startsWith("zh")) return "zh";
  return "en";
}

export function detectTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY) || localStorage.getItem(OLD_THEME_KEY);
    if (saved && THEMES.includes(saved)) return saved;
  } catch (_) {}
  // 默认夜间（与当前深色 UI 一致）；若系统偏好浅色可跟系统
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function applyTheme(theme) {
  const th = THEMES.includes(theme) ? theme : "dark";
  currentTheme = th;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", th);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", th === "light" ? "#e8eef8" : "#0b1220");
    }
  }
  try {
    localStorage.setItem(THEME_KEY, th);
  } catch (_) {}
  syncPrefsUI();
  return th;
}

export function applyLang(lang) {
  const lg = LANGS.includes(lang) ? lang : "zh";
  currentLang = lg;
  if (typeof document !== "undefined") {
    document.documentElement.lang = lg === "zh" ? "zh-CN" : "en";
    document.title = t("app.title");
    applyStaticI18n();
  }
  try {
    localStorage.setItem(LANG_KEY, lg);
  } catch (_) {}
  syncPrefsUI();
  return lg;
}

export function toggleTheme() {
  return applyTheme(currentTheme === "dark" ? "light" : "dark");
}

/** 扫描 data-i18n / data-i18n-html / data-i18n-placeholder / data-i18n-title */
export function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (key) el.innerHTML = t(key);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(key));
  });
  // option 元素
  root.querySelectorAll("option[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
}

function syncPrefsUI() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
    const v = btn.getAttribute("data-theme-btn");
    btn.classList.toggle("active", v === currentTheme);
    btn.setAttribute("aria-pressed", v === currentTheme ? "true" : "false");
  });
  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    const v = btn.getAttribute("data-lang-btn");
    btn.classList.toggle("active", v === currentLang);
    btn.setAttribute("aria-pressed", v === currentLang ? "true" : "false");
  });
}

export function initPrefs() {
  applyTheme(detectTheme());
  applyLang(detectLang());

  document.addEventListener("click", (e) => {
    const themeBtn = e.target.closest("[data-theme-btn]");
    if (themeBtn) {
      applyTheme(themeBtn.getAttribute("data-theme-btn"));
      window.dispatchEvent(new CustomEvent("vc-prefs-change", { detail: { theme: currentTheme, lang: currentLang } }));
      return;
    }
    const langBtn = e.target.closest("[data-lang-btn]");
    if (langBtn) {
      applyLang(langBtn.getAttribute("data-lang-btn"));
      window.dispatchEvent(new CustomEvent("vc-prefs-change", { detail: { theme: currentTheme, lang: currentLang } }));
    }
  });
}

/** 启动前同步主题，减少闪白（也可在 head 内联） */
export function bootThemeEarly() {
  try {
    const th = localStorage.getItem(THEME_KEY);
    if (th && THEMES.includes(th)) {
      document.documentElement.setAttribute("data-theme", th);
      currentTheme = th;
    }
  } catch (_) {}
}
