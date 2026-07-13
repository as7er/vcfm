# VCFM

[中文](#中文) · [English](#english)

---

## 中文

轻量网页足球经理（**V**C **F**ootball **M**anager 缩写），灵感来自 [Football Manager](https://www.footballmanager.com/)。纯前端、无后端，适合通勤摸鱼：手机浏览器打开就能玩。

> 粉丝向简化娱乐作品，与 Sports Interactive / SEGA 无关联。

### 在线游玩

**https://as7er.github.io/vcfm/**

| 说明 | 详情 |
|------|------|
| 设备 | 手机 / 平板 / 电脑浏览器均可 |
| 存档 | 当前浏览器 `localStorage`，**3 个槽位** |
| 换机 | 游戏内 **导出 / 导入** JSON（清缓存会丢进度） |
| 安装 | 支持 PWA：浏览器「添加到主屏幕」更像 App |
| 语言 | 中文 / English · 日间 / 夜间主题 |

仓库：https://github.com/as7er/vcfm

> 旧地址 `vc-football-manager` 在仓库重命名后会跳转一段时间；书签请改用上方新链接。

### 怎么玩（30 秒）

1. 选乙级球队 → **开始新赛季**  
2. **推进一天** / **推进到比赛日**（有比赛时会停）  
3. **进入比赛** → 先看赛前简报 → 快速模拟 / 直播 / 一键完赛（倍速 ×0.5～×4）  
4. 可 **暂停 / 逐事件**；中场改战术与换人（最多 5 次）；下半场场边可再调  
5. 赛后看报告与评分；赛程里可 **回看旧战报**；随时 **存档**，换设备请 **导出**

### 主要系统

- **联赛**：超联 / 甲级 / 乙级，升降级 + **VCFM 杯**  
- **俱乐部浏览器**：积分榜 / 赛程 / 数据榜点队名，或「俱乐部」页筛选搜索；详情含排名、近况、阵容前 16、赛程与荣誉  
- **比赛日（FMM 风 2D 表现层）**  
  - 广播计分板：球衣色、分列比分、时钟、PRE / LIVE / HT / FT  
  - 实时 **xG / 控球 / 射门** 条；轻量 **音效**（可关）  
  - 连续 tick 表演（持球 / 传球飞行 / 射门）+ 事件导演，非物理引擎  
  - 俯视球场：割草纹、镜头跟随、**热区**、持球高亮、**传球网络**  
  - **进球高光**从当前场面接续；赛后 / 日志可 **回看**（带场面快照）  
  - **赛前简报**：天气（与开赛锁定一致）、德比/焦点、积分榜与近况、伤停黄牌体能、对方威胁、交锋、董事会目标  
  - **中场**：提示 + **首发体能条**、战术与换人；下半场 **场边战术**即时反馈  
  - 赛后：**MOTM**、文字复盘、球员评分；每队最多 **5 次换人**  
  - **赛程战报**：已赛场次可打开旧报告与进球回看  
  - 点场上 / 名单球员看资料卡  
- **纪律**：累计黄牌停赛、红牌停赛；60'/75' 教练席提示  
- **阵容**：体能、士气、伤病、潜力、球衣号、自动阵容；**本赛季出场 / 进球·零封 / 助攻·失球** 与评分相关展示  
- **姓名生成**：按国籍拼音 / 罗马字（中日韩等），短名按姓显示  
- **球员资料**：阵容、青训、数据榜、转会、战术板、训练条、赛后射手等处 **点名字** 即可打开详情  
- **设施**：球场 / 训练 / 青训等级升级  
- **转会与合同**：夏窗·冬窗、买入合同谈判、**续约 / 解约**、**外租·租入·召回**、球探报告、AI 挖角报价  
- **经营**：董事会目标与解雇压力、职员、训练日程、周薪与设施维护  
- **生涯**：经理战绩、赛季结算页、俱乐部荣誉墙、球员分赛季历史与个人荣誉  
- **存档**：多槽、自动存、刷新后自动恢复当前槽、导出提醒（约 7 天未导出会提示）

### 本地运行

ES Module 需通过 HTTP 打开（不要直接双击 `index.html`）。

```bash
# Python
python -m http.server 8080
# open http://localhost:8080

# or Node
npx serve .
```

推送到 `master` 后 GitHub Pages 会更新在线版（可能有缓存，可强刷）。

### 技术栈

- 静态站点：HTML + CSS + ES Modules（无构建）  
- 进度：浏览器 `localStorage`  
- 部署：[GitHub Pages](https://pages.github.com/)  
- 可选离线：`manifest.webmanifest` + Service Worker

### 许可证

**[MIT License](./LICENSE)** — 可自由使用、修改、分发（含商业用途），请保留版权与许可证声明。游戏内随机生成的名称仅为玩法素材。

### 反馈

https://github.com/as7er/vcfm/issues

---

## English

A lightweight browser football manager (**V**C **F**ootball **M**anager). Inspired by [Football Manager](https://www.footballmanager.com/). Pure frontend, no backend — open it on your phone and play on the commute.

> Fan-made simplified entertainment. Not affiliated with Sports Interactive / SEGA.

### Play online

**https://as7er.github.io/vcfm/**

| | |
|--|--|
| Devices | Phone, tablet, or desktop browser |
| Saves | Browser `localStorage`, **3 slots** |
| Switch device | In-game **export / import** JSON (clearing cache wipes progress) |
| Install | PWA — “Add to Home Screen” for an app-like feel |
| Language | Chinese / English · day / night theme |

Repo: https://github.com/as7er/vcfm

> The old repo name `vc-football-manager` may redirect for a while after the rename; update bookmarks to the link above.

### How to play (30 seconds)

1. Pick a Division 3 club → **New season**  
2. **Advance one day** / **Advance to matchday** (stops when you have a match)  
3. **Enter match** → pre-match briefing → quick sim / live / instant (speed ×0.5–×4)  
4. **Pause / step** modes; half-time tactics & subs (max 5); touchline tweaks in the 2nd half  
5. Post-match report & ratings; **rewatch** past reports from Fixtures; **save** often; **export** when changing devices

### Features

- **Leagues**: three tiers with promotion/relegation + **VCFM Cup**  
- **Club browser**: click club names on the table / fixtures / stats, or use the **Clubs** tab (filter & search). Detail modal: standings, form, top squad, fixtures, honours  
- **Matchday (FMM-style 2D presentation)**  
  - Broadcast scoreboard: kit colours, split score, clock, PRE / LIVE / HT / FT  
  - Live **xG / possession / shots** bars; light **SFX** (toggle)  
  - Continuous tick performance (carry / pass flight / shot) + event director — not a physics sim  
  - Top-down pitch: mow stripes, camera follow, **heat map**, carrier glow, **pass network**  
  - **Goal highlights** continue from the current scene; **rewatch** from the log / report (scene snapshots)  
  - **Pre-match briefing**: locked weather, derby/spotlight, table & form, absences, threats, H2H, board goal  
  - **Half-time**: tips + **XI fitness bars**, tactics & subs; **touchline tactics** feedback in the 2nd half  
  - Full-time: **MOTM**, narrative recap, player ratings; **5 subs** per team  
  - **Fixture reports**: open past match reports and goal replays from the fixtures list  
  - Click pitch / list players for profiles  
- **Discipline**: yellow accumulation bans, reds; 60'/75' coach tips  
- **Squad**: fitness, morale, injury, potential, shirt numbers, auto XI; **season apps / goals·CS / assists·GA** and rating-related views  
- **Names**: nationality-based pools (pinyin / romaji for CHN/JPN/KOR, etc.); short labels use surnames  
- **Player profiles**: click names on squad, youth, stats, transfers, tactics pitch, training bar, match scorers, etc.  
- **Facilities**: stadium / training / youth upgrades  
- **Transfers & contracts**: summer/winter windows, buy negotiations, **renew / release**, **loan out·in·recall**, scout reports, AI poaching bids  
- **Club**: board objectives & sack risk, staff, training schedule, wages & upkeep  
- **Career**: manager record, season review, club honours, player season history & awards  
- **Saves**: multi-slot, autosave, auto-resume on refresh, export reminder (~7 days)

### Run locally

Serve over HTTP (don’t open `index.html` as a file).

```bash
# Python
python -m http.server 8080
# open http://localhost:8080

# or Node
npx serve .
```

Pushing to `master` updates GitHub Pages (allow a short cache delay; hard-refresh if needed).

### Stack

- Static site: HTML + CSS + ES Modules (no build step)  
- Progress: browser `localStorage`  
- Hosting: [GitHub Pages](https://pages.github.com/)  
- Optional offline: `manifest.webmanifest` + Service Worker

### License

**[MIT License](./LICENSE)** — free to use, modify, and distribute (including commercially), with copyright and license notice retained. Generated player/club names are fictional gameplay content only.

### Feedback

https://github.com/as7er/vcfm/issues
