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
3. **战术板** 设阵型 / 角色 / **核心球员 ⭐**，再 **进入比赛**
4. 赛前简报 → **直播**（高光跳播）/ 快速模拟 / 一键完赛
5. 可 **暂停**；中场改战术与换人（最多 5 次）；赛后看报告与评分
6. 随时 **存档**；换设备请 **导出** JSON

### 主要系统

- **联赛**：超联 / 甲级 / 乙级，升降级 + **VCFM 杯**
- **俱乐部浏览器**：积分榜 / 赛程 / 数据榜点队名，或「俱乐部」页筛选搜索
- **比赛日（空间模拟 + FMM 风表现）**
  - **用户场**：`SimEngine` 10Hz 空间模拟（持球决策、无球跑位、防守压迫、越位/死球）→ 结果缩放写入报告与积分
  - **直播**：半场预跑后按 **高光窗口** 细看（进球 / 射门 / 扑救等），平淡段短跳，整场约十分钟量级墙钟
  - **真空间投影**：录帧 + 插值，俯视球场画布；主客 **同一套跑位 AI**（非单方面）
  - 跑位包括：前锋回撤接应、**边锋回撤拿球内切** 射/传、边后卫前插传中、中场前插与远射
  - **核心球员**（主客各可有一名）：梅西 / C 罗式进攻绝对权——更爱拿球盘带射门，队友更愿意喂球；未指定时开赛自动选进攻最强者
  - 广播计分板、实时 **xG / 控球 / 射门**、轻量音效、进球撞网与助攻回放
  - **赛前简报**、中场换人换阵、赛后 MOTM / 评分；赛程可回看旧战报
  - 后台 AI 对 AI 场次仍用快速概率引擎（保证推进日不卡）
- **战术**
  - 阵型、风格、压迫 / 节奏 / 宽度 / 防线
  - **槽位角色**（边后卫套边、边路爆破、内切前锋、支点等）
  - 战术板拖拽换人 + **⭐ 指定核心**
- **纪律**：累计黄牌停赛、红牌停赛；60'/75' 教练席提示
- **阵容**：体能、士气、伤病、潜力、球衣号、自动阵容；本赛季出场 / 进球·零封 / 助攻·失球
- **姓名生成**：按国籍拼音 / 罗马字（中日韩等），短名按姓显示
- **球员资料**：阵容、青训、数据榜、转会、战术板等处 **点名字** 打开详情
- **设施 / 转会 / 经营 / 生涯**：球场升级、夏冬窗、续约外租、董事会、职员训练、荣誉与经理战绩
- **存档**：多槽、自动存、导出提醒

### 本地运行

ES Module 需通过 HTTP 打开（不要直接双击 `index.html`）。

```bash
# Python
python -m http.server 8080
# open http://localhost:8080

# or Node
npx serve .
```

开发预览空间引擎（原始未缩放手感）：打开同目录下的 `sim-viewer.html`。

推送到 `master` 后 GitHub Pages 会更新在线版（可能有缓存，请 **Ctrl+F5** 强刷）。

### 技术栈

- 静态站点：HTML + CSS + ES Modules（无构建）
- 比赛核心：`js/sim/engine.js`（空间模拟）+ `js/sim/adapt.js`（接入 match / 直播）
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
3. Set formation / roles / **core player ⭐** on the tactics board → **Enter match**
4. Pre-match briefing → **live** (highlight skip) / quick sim / instant finish
5. **Pause**; half-time tactics & subs (max 5); post-match report & ratings
6. **Save** often; **export** JSON when changing devices

### Features

- **Leagues**: three tiers with promotion/relegation + **VCFM Cup**
- **Club browser**: click names on the table / fixtures / stats, or use the **Clubs** tab
- **Matchday (spatial sim + FMM-style presentation)**
  - **User matches**: 10Hz `SimEngine` (on-ball decisions, off-ball runs, pressing, offside/restarts) → scaled results into reports & table
  - **Live**: half pre-simulated, then **highlight windows** (goals / shots / saves) with short skips — full match roughly ~10 minutes wall-clock
  - **True spatial projection**: recorded frames + interpolation on a top-down canvas; **same AI for both teams**
  - Movement: strikers drop to link, **wingers drop & cut inside** to shoot/pass, fullbacks overlap/cross, midfield runs & long shots
  - **Core player** (one per side): Messi/Ronaldo-style attack rights — more touches, dribbles, shots; teammates feed them. Auto-picked if unset
  - Scoreboard, live **xG / possession / shots**, light SFX, goal net FX & assist replays
  - Pre-match briefing, HT changes, MOTM / ratings; rewatch past reports from fixtures
  - AI-vs-AI background fixtures still use the fast probabilistic engine (calendar stays snappy)
- **Tactics**: formation, style, sliders, **slot roles**, pitch drag + **⭐ core**
- **Discipline**, **squad**, nationality-based **names**, click-through **profiles**
- **Facilities / transfers / board / career** as before
- **Saves**: multi-slot, autosave, export reminder

### Run locally

Serve over HTTP (don’t open `index.html` as a file).

```bash
# Python
python -m http.server 8080
# open http://localhost:8080

# or Node
npx serve .
```

Dev preview of the raw spatial engine: open `sim-viewer.html` in the same folder.

Pushing to `master` updates GitHub Pages (hard-refresh with **Ctrl+F5** if cached).

### Stack

- Static site: HTML + CSS + ES Modules (no build step)
- Match core: `js/sim/engine.js` + `js/sim/adapt.js`
- Progress: browser `localStorage`
- Hosting: [GitHub Pages](https://pages.github.com/)
- Optional offline: `manifest.webmanifest` + Service Worker

### License

**[MIT License](./LICENSE)** — free to use, modify, and distribute (including commercially), with copyright and license notice retained. Generated player/club names are fictional gameplay content only.

### Feedback

https://github.com/as7er/vcfm/issues
