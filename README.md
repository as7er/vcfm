# VCFM

[中文](#中文) · [English](#english)

---

## 中文

VCFM（**V**C **F**ootball **M**anager）是一款轻量网页足球经理游戏，灵感来自 [Football Manager](https://www.footballmanager.com/)。项目完全运行在浏览器中，无后端、无构建步骤，手机、平板和电脑都可以直接游玩。

> 粉丝向简化娱乐作品，与 Sports Interactive / SEGA 无关联。俱乐部、球员与赛事品牌均为虚构内容。

### 在线游玩

**https://as7er.github.io/vcfm/**

| 说明 | 详情 |
|------|------|
| 当前版本 | **v233** · 持久化球衣号码偏好与赛季登记 |
| 设备 | 手机 / 平板 / 电脑浏览器 |
| 存档 | 当前浏览器 `IndexedDB` 耐久存储，3 个槽位 |
| 换机 | 游戏内导出 / 导入 JSON；清理浏览器数据前请先导出 |
| 安装 | 支持 PWA，可使用浏览器“添加到主屏幕” |
| 语言与主题 | 中文 / English · 日间 / 夜间 |

仓库：https://github.com/as7er/vcfm

### v232 更新亮点

- 赞助合同按签约赛季重新定价，收入不再逐年被工资上涨侵蚀；已签合同保留原价，到期换约时自然跟上。5 赛季样本中位俱乐部重新靠踢球盈利，联赛债务余额下降三分之一。
- 比赛底栏不再溢出球场盖住解说折叠按钮，替补席空的一侧也不再让整条错位。
- 打完比赛后回到俱乐部更稳：结算不再因为工作台渲染出错而卡住「继续」按钮或丢失当场赛果。
- 信箱详情链接的解析开销大幅下降，长赛季的信箱和首页摘要不再随球员总数变慢。

### v231 更新亮点

- 新档首页增加可跳过、可持久化的首周经理引导：检查阵容、确认战术、安排训练、完成第一场比赛。
- 引导直接复用现有工作台和页签，不增加隐藏能力或比赛修正；旧存档按已建立生涯自动跳过。

### v230 更新亮点

- 无球跑位目标引入约 1.5 秒路线租约，同一持球人和阶段内不再因相邻决策反复折返；传球换人、阶段切换和首次二过一仍能立即改跑。
- 接应目标继续以战术几何为基础，只对相距不足 1.8 米的同队预留目标做横向分层；目标坐标、来源和路线租约进入空间快照与运动片段。
- 运动诊断新增“跑位目标反复”和“接应目标拥挤”，双轨回放球场绘制引擎与显示层实际跑位目标线。
- 24 场固定种子真实性样本中，标准档 3.17 球/场、81.7% 传球成功率，后台档 2.71 球/场、81.0% 传球成功率，两档均零停滞；强队分别取得 2.08 与 1.92 分/场。

### v229 更新亮点

- 直播画面持续检查非法坐标、球员或球的瞬移、无缘由急停反向、持续重叠、持球脱节及引擎/渲染坐标偏差，并保留最近 12 秒的双轨运动片段。
- 比赛底栏新增“保存运动片段”入口；诊断界面可逐帧比较引擎坐标与实际渲染坐标、跳转自动标记并导出可复现 JSON，不修改比赛随机流或结果。
- 门将接高速度来球改为连续减速收球，渲染层在第一脚控制完成前不再提前吸球；扑救不再叠加隐藏坐标侧移，球员碰撞纠正按时间步连续释放。
- 固定种子完整比赛门禁覆盖 2 场标准直播档与 6 场后台档：标准档零严重异常、零警告，后台档零严重异常，仅保留 4 次粗步长快速反向警告。
- 24 场真实性样本中，标准档 3.21 球/场、81.1% 传球成功率，后台档 2.92 球/场、81.0% 传球成功率，两档均零停滞。

前序版本（v199–v228）已覆盖球员属性原型、习惯与角色、发展队、长期阵容规划、AI 主教练生态、后台空间 Worker、耐久存档、比赛规则、连续触球、集体防守、球队阶段形态、转播和阶段阵型证据链。完整条目见 [CHANGELOG.md](./CHANGELOG.md) 与 [AGENTS.md](./AGENTS.md)。

### 快速开始

1. 从七国任一低级别联赛选择一家俱乐部，创建经理并开始赛季。
2. 在阵容和战术板安排首发、阵型、槽位角色与核心球员。
3. 推进一天或推进到比赛日；紧急信箱、伤病和比赛会自动中断推进。
4. 比赛日选择直播、快速高光或一键完赛：直播和快速高光使用同一套空间事件，一键完赛直接生成纯战报。
5. 中场可以换人、换阵和调整战术；赛后查看评分、xG、上座率和完整报告。
6. 经营转会、职员、训练、设施和财政，也可以请辞、待业并接受其他俱乐部邀请。

### 游戏世界

- **七国联赛体系**：15 个联赛、每个联赛 18 队，共 270 家虚构俱乐部；包含升降级、国内杯赛和完整赛程。
- **俱乐部洲际赛事**：欧冠、欧联和欧协联采用 8 场联赛阶段与淘汰赛，资格由七国顶级联赛排名决定。
- **国家队**：俱乐部球员与国家队共享同一能力、状态和伤病数据；包含世界国家杯、欧洲杯、国际比赛日、征召与赛事数据榜。
- **联赛与赛事中心**：可查看积分、赛程、赛果、射手、助攻、评分和门将榜；国内联赛、杯赛、洲际赛分别记账。
- **现实层级、虚构品牌**：球队实力、财政和人才分布参考现实竞争层级，但不保存或展示现实俱乐部身份。

### 比赛日

- **用户比赛使用空间引擎**：`SimEngine` 模拟持球决策、跑位、压迫、传射、门将、越位、犯规、伤病和定位球；比分、画面、统计与战报来自同一批事件。
- **三种观看方式**：直播保留完整高光节奏；快速高光跳过平淡时段但细看真实进球与扑救；一键完赛不播放球场动画，直接进入赛后报告。
- **真实战术因果**：主客队运行同一套 AI；阵型、角色、能力、状态、体能、士气和战术共同影响场上表现，没有只为界面结果服务的隐藏球队加权。
- **可读的转播表现**：俯视球场、真空间录帧、倍速、暂停、中场调整、进球回放、庆祝、球轨迹、xG、控球和射门统计；顶栏分钟单调前进，点球按站位、助跑、飞行、结算分阶段呈现，直播数据条按当前画面时刻切片。
- **双方真实换人**：直播、快速模拟、一键完赛与后台比赛共用同一决策，双方在 60′、75′ 依据比分、体能、黄牌风险、位置与替补实力换人，正常轮换 2–4 人；赛后评分展示所有实际出场球员并标注替补。
- **空间事件比赛分析**：赛后战报从同一批空间事件派生出脚前 xG、射门图、推进、压迫、行动热区和完成传球网络；分析随比赛报告保存，可回看且不使用赛后结果修饰机会质量。
- **真实性与可复现性**：每场比赛保存确定性随机种子；远射、射门高度、门将反应、抢断、点球、角球和强弱队表现经过固定种子批量审计。
- **统一临场因果**：教练、天气、备战、队内讲话、真实阵容和定位球训练共同进入空间模拟；下半场按 46–60、61–75、76–90 分段计算，换人和战术调整会影响尚未模拟的区间。
- **赛前票房因果**：上座与门票系数只读取开赛前状态，不受本场赛果倒灌；战报和财政概览展示杯赛、德比、争冠、联赛层级等收入系数。
- **后台比赛同源**：浏览器日历推进由独立 Worker 执行，AI 场次运行与用户比赛相同的空间引擎与全部因果；普通决策以 0.3 秒推进，关键球路和门将威胁窗口以 0.1 秒局部积分，性能档随战报持久化，Worker 失败时回退到主线程同一后台档。

### 球队管理

- **阵容与球员**：体能、士气、伤病、停赛、潜力、号码、合同、赛季数据和近 5 场滚动状态；球员另有稳定的惯用脚、身高、头球、传中与决策属性，并进入传中质量与争顶判定；五档出场定位按逐场真实分钟滚动复核，训练、青训成长和年龄曲线会留下可解释的属性变化记录；联赛与洲际赛事使用 25 人报名名单、本土培养名额和 U21/B 名单资格。
- **战术**：阵型、风格、压迫、节奏、宽度、防线、槽位角色、核心球员与战术板拖拽换位；队长、点球、直接任意球与角球职责必须来自当前首发，失效时按真实属性补位。
- **细分位置与阵容规划**：球员持有 13 个细分位置的熟悉度档案，阵型槽位按站位与纵深解析成细分位置，选人与换人共用同一份适配度；阵容页提供一至三年规划工作台，展示位置深度、未来合同、同级质量差与报名风险。
- **训练与青训**：训练重点、强度、赛前备战、青训名单和球员成长；发展队使用同一空间引擎产生真实分钟、伤病和比赛锐度，并驱动成长、提拔与外租决策；可委托助理教练按赛程与阵容短板安排。
- **转会与合同**：夏窗、冬窗、续约、租借、自由球员和 AI 报价；买入、出售、续约与租借均按现实参与方逐阶段审核，永久转会支持分期、出场奖金、二次转会分成和青训补偿。
- **职员体系**：主教练、球探和队医拥有能力、工资、合同与完整任职履历；主教练另有真实驱动阵型和临场应变的足球理念，AI 董事会会按连续成绩决定解雇、看守与再任命；姓名、国籍、国旗和头像来自同一份国籍事实。
- **经理生涯**：董事会目标、名望、成就与执教历史；被解雇或主动请辞后进入待业市场，也可能在任时收到更高水平球队邀请。

### 经营与体验

- **财政**：用户与 AI 俱乐部共同使用统一总账，结算门票、零售、接待、赞助、赛事奖金、转会、工资、设施、转播和联赛层级补助；财政页显示未来应收应付、债务本金与利息、现金储备和合规状态。
- **设施**：球场、训练、青训、医疗等设施可以升级，并影响收入、成长、恢复和伤病。
- **信息系统**：信箱、世界新闻、媒体、球探任务、关注列表、球员对话、全局搜索和可连续浏览的球员资料。
- **存档**：3 个槽位、自动保存、手动保存、JSON 导出与导入；旧存档会在加载时补齐新增字段。
- **存档可靠性**：Worker 压缩失败时同步保存各槽最新快照，页面退出前冲刷待存队列；版本化 Schema、深层引用检查与数值校验保护旧档迁移和导入。
- **球员路径**：出场承诺按可用比赛、首发、替补和实际分钟评估，连续违约会影响关系、士气与离队意愿；训练、青训、年龄变化和实际出场均留下可解释记录。
- **双精度人物肖像**：名单和战术板使用 32×32 程序脸，资料页从同一外貌生成原生 48×48 高精度肖像并显示为 96px；伤病外观读取实际诊断，无效结果会安全回退。
- **职责委托与经营模式**：训练、首发、战术、临场与培养职责可交由教练团队；支持阵型、关键球员和培养原则锁定。俱乐部经营模式下主教练全权带队，玩家专注转会、合同、财政、设施、青训和聘帅。
- **长期经营可靠性**：玩家经理与受聘主教练分别记录职业履历，AI 会进行债务处置；自动决策只读取真实能力、体能、状态、赛程和职员能力，不写入隐藏胜率或能力修正。
- **离线与性能**：Service Worker 按资源独立预缓存，单项失败不再清空整批离线资源；大型比赛视图只在进入比赛或战报时加载。
- **统一验证**：核心审计由 `node scripts/verify.mjs` 统一执行，`--full` 追加 24 场真实性校准；GitHub Actions 覆盖 push、PR、手动与定时验证。

### 本地运行

ES Modules 必须通过 HTTP 提供，不要直接双击 `index.html`。

以下启动方式需要 **Python 3**。Windows 一键启动脚本还需要 **PowerShell 7**（`pwsh`）；脚本会终止占用 `127.0.0.1:8765` 的现有进程，然后启动 no-store 服务并打开浏览器。

Windows 推荐使用仓库自带脚本：

```powershell
pwsh -File start-local.ps1
# http://127.0.0.1:8765/
```

其他环境可以直接使用 Python：

```bash
python -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/
```

原始空间引擎手感预览：`http://127.0.0.1:8765/sim-viewer.html`

### 验证与审计

开发与验证建议使用 **Node.js 22**。首次运行先安装开发依赖：

```bash
npm ci
npm test
npm run test:full
npm run test:browser
```

`npm test` 运行语法检查和核心审计，通常需要数分钟；`npm run test:full` 额外运行 24 场固定种子真实性校准。`npm run test:browser` 使用本机 Microsoft Edge，并通过 Python 在 `127.0.0.1:8876` 启动临时测试服务，覆盖桌面/手机布局、导航和弹窗焦点。

比赛真实性审计检查进球、射门距离与转化率、抢断、犯规、点球、角球、伤病、卡死和强弱队差距。禁区持球采样审计（`box-possession-sampling-audit`）另按 0.1 秒间隔采样真实比赛，观察禁区持球时长、回合结束方式、无人盯防机会频率与门将封角距离——合成摆位场景只能验证「摆成这样时会怎样」，测不到「这种局面在真实比赛里出现得多频繁」。直接调用统一入口也受支持：`node scripts/verify.mjs [--full]`。

### 技术栈

- HTML + CSS + 原生 ES Modules，无框架、无构建步骤
- `js/sim/engine.js`：用户比赛空间模拟
- `js/sim/adapt.js`：比赛系统、统计与高光接入
- `IndexedDB`：三槽耐久存档；`localStorage` 仅保留轻量偏好与旧档迁移入口
- GitHub Pages：在线部署
- Web App Manifest + Service Worker：安装与离线缓存

### 许可证与反馈

**[MIT License](./LICENSE)**：可自由使用、修改和分发（包括商业用途），请保留版权和许可证声明。

问题与建议：https://github.com/as7er/vcfm/issues

---

## English

VCFM (**V**C **F**ootball **M**anager) is a lightweight browser football-management game inspired by [Football Manager](https://www.footballmanager.com/). It runs entirely in the browser with no backend and no build step, on phones, tablets, and desktop browsers.

> A fan-made simplified game, not affiliated with Sports Interactive or SEGA. Clubs, players, and competition brands are fictional.

### Play online

**https://as7er.github.io/vcfm/**

| | |
|--|--|
| Current version | **v230** · 2D off-ball run continuity |
| Devices | Phone, tablet, or desktop browser |
| Saves | Durable browser `IndexedDB`, 3 slots |
| Move devices | In-game JSON export / import; export before clearing browser data |
| Install | PWA support through “Add to Home Screen” |
| Language and theme | Chinese / English · day / night |

Repository: https://github.com/as7er/vcfm

### What's new in v230

- Off-ball movement targets now use roughly 1.5-second route leases. Players avoid reversals between adjacent decisions within the same carrier and team phase, while a possession change, phase change, or the first explicit one-two can still establish a new route immediately.
- Support targets retain their tactical geometry and are only layered horizontally when same-team reservations for the same carrier and phase are less than 1.8 metres apart. Target coordinates, provenance, route kind, lease, carrier, and phase are retained in spatial snapshots and motion clips.
- Motion diagnostics add run-target churn and support-target crowding markers, with target lines drawn in both engine and rendered replay pitches.
- Seeded full-match motion gates cover two standard and six background matches with zero severe incidents. Across 24-match realism samples, the standard profile averages 3.17 goals with 81.7% pass completion and the background profile averages 2.71 goals with 81.0% pass completion; neither profile stalls.

### What's new in v229

- Live matches now check invalid coordinates, player and ball teleports, unexplained rapid reversals, persistent overlaps, owner/ball separation, and engine/render divergence while retaining the latest 12 seconds of dual-track motion frames.
- A new match-toolbar action saves the current motion clip. Its diagnostic view compares engine and rendered coordinates frame by frame, jumps to automatic markers, and exports deterministic JSON without consuming randomness or changing results.
- Goalkeepers now decelerate incoming balls through a continuous catch phase, the renderer no longer attaches a ball before first-touch control completes, saves no longer add a hidden position jump, and collision corrections are released over consecutive frames.
- Seeded full-match gates cover two standard live-profile matches and six background matches: the standard profile has zero severe incidents and zero warnings; the background profile has zero severe incidents and four coarse-step reversal warnings.
- Across 24-match realism samples, the standard profile averages 3.21 goals with 81.1% pass completion, while the background profile averages 2.92 goals with 81.0% pass completion; neither profile stalls.

Earlier releases (v199–v228) cover player attribute archetypes, habits and roles, development football, long-term squad planning, the AI head-coach ecosystem, background spatial workers, durable saves, edge rules, continuous control, collective defending, team phases, broadcast presentation, and phase-shape evidence. See [CHANGELOG.md](./CHANGELOG.md) and [AGENTS.md](./AGENTS.md).

### Quick start

1. Choose a club from any of the seven nations' lower divisions and create your manager.
2. Set the lineup, formation, slot roles, and core player on the tactics board.
3. Advance one day or to matchday; urgent inbox items, injuries, and matches stop progression automatically.
4. Choose Live, Quick Highlights, or Instant Finish. Live and Quick Highlights share the same spatial events; Instant Finish opens a report without playing the pitch animation.
5. Make substitutions and tactical changes at half-time, then review ratings, xG, attendance, and the full match report.
6. Manage transfers, staff, training, facilities, and finances, or resign and continue your career at another club.

### Game world

- **Seven-nation pyramid**: 15 leagues, 18 clubs per league, and 270 fictional clubs in total, with promotion, relegation, domestic cups, and full schedules.
- **Continental club competitions**: Champions League, Europa League, and Conference League with an eight-match league phase and knockouts. Qualification comes from top-flight finishes.
- **International football**: national teams share the same player ability, form, fitness, and injury data as clubs. Includes the World Nations Cup, European Championship, international breaks, call-ups, and competition leaderboards.
- **Competition centres**: tables, fixtures, results, scorers, assists, ratings, and goalkeeper rankings, with separate domestic-league, cup, and continental stat ledgers.
- **Realistic hierarchy, fictional identity**: competitive level, finances, and talent distribution follow explainable real-world tiers without storing or displaying real club identities.

### Matchday

- **Spatial engine for user matches**: `SimEngine` handles on-ball choices, off-ball movement, pressing, passing, shooting, goalkeepers, offside, fouls, injuries, and restarts. Score, visuals, statistics, and reports use the same events.
- **Three viewing modes**: Live keeps the full highlight rhythm; Quick Highlights skips quiet periods while showing real goals and saves; Instant Finish goes straight to the report.
- **Shared tactical causality**: both teams run the same AI. Formation, roles, ability, form, fitness, morale, and tactics drive performance without UI-only team weighting.
- **Broadcast presentation**: top-down pitch, recorded spatial frames, speed controls, pause, half-time changes, replays, celebrations, ball trails, xG, possession, and shot statistics. The clock only moves forward, penalties play out as staged dead-ball sequences (positioning, run-up, flight, outcome), and live stat bars are sliced to the moment currently on screen.
- **Realistic substitutions for both teams**: Live, Quick Highlights, Instant Finish, and background fixtures share one decision path. Both sides review at 60′ and 75′ using scoreline, fitness, booking risk, position, and bench strength, normally making 2–4 changes. Post-match ratings list every player who appeared, marked as starter or substitute.
- **Spatial-event match analysis**: post-match reports derive pre-shot xG, shot maps, progression, pressing, action heatmaps, and completed-pass networks from the same event stream. Saved analysis remains available in archived reports and never uses the shot outcome to rewrite chance quality.
- **Realism and reproducibility**: every fixture stores a deterministic seed. Long shots, shot height, goalkeeper reactions, tackles, penalties, corners, and strong-vs-weak performance are covered by seeded batch audits.
- **Unified live causality**: coaching, weather, preparation, team talks, the actual lineup, and set-piece training feed the spatial simulation. The second half is calculated in 46–60, 61–75, and 76–90 windows, so substitutions and tactical changes affect only the remaining play.
- **Pre-match gate causality**: attendance and gate modifiers use only information known before kickoff; match reports and the finance overview expose cup, derby, title-race, league-tier, and other income factors.
- **Shared background simulation**: calendar advancement runs in a dedicated Worker, and AI fixtures use the same spatial engine and full causality as user matches. Ordinary decisions advance at 0.3s, while critical ball-flight and goalkeeper-threat windows use local 0.1s integration. The performance profile is stored with each report, and Worker failure falls back to the same background profile on the main thread.

### Club management

- **Squad and players**: fitness, morale, injuries, suspensions, potential, numbers, contracts, season statistics, and rolling five-match form. Players also carry a stable preferred foot, height, heading, crossing, and decisions, which feed crossing quality and aerial duels. Five playing-time roles are reviewed against real match minutes, while training, academy growth, and ageing create explainable attribute-change records. League and continental matches use 25-player registrations, homegrown quotas, and U21/List B eligibility.
- **Tactics**: formation, style, pressing, tempo, width, defensive line, slot roles, core player, and drag-and-drop changes. Captain, penalty, direct free-kick, and corner duties must come from the current starting eleven, with attribute-based replacements when a duty lapses.
- **Detailed positions and squad planning**: every player carries familiarity for 13 detailed positions, formation slots resolve to those positions, and selection and substitutions share one aptitude view. The squad page includes a one-to-three-year planning workbench covering positional depth, future contracts, same-tier quality gaps, and registration risk.
- **Training and youth**: training focus, intensity, match preparation, and youth development. Development XIs use the same spatial engine to create real minutes, injuries, and match sharpness that drive growth, promotion, and loan decisions. Training can still be delegated by schedule and squad need.
- **Transfers and contracts**: summer and winter windows, renewals, loans, free agents, and AI bids. Purchases, sales, renewals, and loans use staged reviews, while permanent deals support installments, appearance bonuses, sell-on clauses, and training compensation.
- **Staff**: managers, scouts, and physios have ability, wages, contracts, and complete employment histories. Head coaches also have football identities that drive formation and match adaptation, while AI boards use sustained results for dismissals, caretakers, and appointments. Names, nationality, flags, and portraits come from one nationality fact.
- **Manager career**: board objectives, reputation, achievements, and job history. Sacking or resignation leads to unemployment and new offers; successful employed managers may receive prestige approaches.

### Operations and usability

- **Finances**: user and AI clubs share one ledger for tickets, retail, hospitality, sponsorships, competition awards, transfers, wages, facilities, broadcasts, and league-transition support. The finance page exposes future receivables/payables, debt principal and interest, cash reserves, and compliance status.
- **Facilities**: stadium, training, youth, and medical upgrades affect revenue, development, recovery, and injuries.
- **Information systems**: inbox, world news, media, scouting missions, shortlist, player talks, global search, and continuous player-profile browsing.
- **Saves**: 3 slots, autosave, manual save, and JSON export/import. Older saves are migrated with defaults for new fields.
- **Save reliability**: compression-worker failures synchronously persist each slot's newest snapshot, pending jobs flush before unload, and a versioned schema with deep-reference and numeric checks protects migrations and imports.
- **Player pathways**: playing-time promises use availability, starts, substitute appearances, and actual minutes; repeated breaches affect morale, relationships, and willingness to stay. Training, academy development, ageing, and real appearances all leave explainable records.
- **Dual-detail portraits**: lists and the tactics board use 32×32 procedural faces; profiles render a native 48×48 high-detail portrait from the same identity at 96px. Injury appearance follows the actual diagnosis, with safe fallback for invalid output.
- **Delegation and club-director mode**: coaching staff can handle training, selection, tactics, matchday changes, and development, with formation, key-player, and development principles available as locks. In club-director mode the head coach runs the team while the player manages transfers, contracts, finances, facilities, youth, and coaching appointments.
- **Long-term operating reliability**: the player's manager career and the employed head coach have separate records, while AI clubs take explicit debt actions. Automated decisions use only real ability, fitness, form, schedules, and staff quality, without hidden win-probability or ability modifiers.
- **Offline and performance**: Service Worker assets are precached independently so one failure cannot discard the batch; the large match view loads only when entering a match or archived report.
- **Unified verification**: `node scripts/verify.mjs` runs the core audits, while `--full` adds the 24-match realism calibration. GitHub Actions covers pushes, pull requests, manual runs, and a schedule.

### Run locally

ES Modules must be served over HTTP; do not open `index.html` directly.

The commands below require **Python 3**. The Windows launcher also requires **PowerShell 7** (`pwsh`); it stops any existing process listening on `127.0.0.1:8765`, then starts a no-store server and opens the browser.

On Windows, use the included launcher:

```powershell
pwsh -File start-local.ps1
# http://127.0.0.1:8765/
```

On other platforms:

```bash
python -m http.server 8765 --bind 127.0.0.1
# http://127.0.0.1:8765/
```

Raw spatial-engine preview: `http://127.0.0.1:8765/sim-viewer.html`

### Validation and audits

Development and validation are tested with **Node.js 22**. Install the development dependencies before the first run:

```bash
npm ci
npm test
npm run test:full
npm run test:browser
```

`npm test` runs syntax checks and the core audits and can take several minutes. `npm run test:full` adds the seeded 24-match realism calibration. `npm run test:browser` uses the locally installed Microsoft Edge and starts a temporary Python server on `127.0.0.1:8876` to cover desktop/mobile layout, navigation, and modal focus.

The realism audit measures goals, shot distance and conversion, tackles, fouls, penalties, corners, injuries, stalls, and strong-vs-weak performance. The box possession sampling audit (`box-possession-sampling-audit`) additionally samples real matches every 0.1s to observe how long the ball dwells in the box, how box spells end, how often unmarked close-range chances occur, and how far the keeper sits off the shooting lane — posed synthetic scenarios can only verify "what happens when set up this way", never "how often this situation actually arises in a real match". The unified runner can also be called directly as `node scripts/verify.mjs [--full]`.

### Stack

- HTML + CSS + native ES Modules, with no framework or build step
- `js/sim/engine.js`: spatial simulation for user matches
- `js/sim/adapt.js`: match-system, statistics, and highlight integration
- `IndexedDB`: durable three-slot saves; `localStorage` only holds lightweight preferences and the legacy migration entry point
- GitHub Pages: deployment
- Web App Manifest + Service Worker: installation and offline cache

### License and feedback

**[MIT License](./LICENSE)**: free to use, modify, and distribute, including commercially, with the copyright and license notice retained.

Issues and suggestions: https://github.com/as7er/vcfm/issues
