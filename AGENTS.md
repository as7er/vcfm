# VCFM — 会话记忆点

> 仓库：https://github.com/as7er/vcfm.git · `master`  
> 预览：`python -m http.server 8765 --bind 127.0.0.1`  
> 缓存：**vcfm-v98**（角球主罚钉角旗+徽章不粘；禁区减堆；进球叙事）

## 已完成路线

### FM ①–⑤
角色 · 讲话 · Inbox · 球探雾/对手报告 · 中场换阵+角色复盘

### ABCD 扩展（v59）

| 线 | 内容 | 文件 |
|----|------|------|
| **A** | 关系 -2..+2、约谈、氛围、对立发信 | `relations.js` |
| **B** | 紧急信箱门闸、球探任务、关注过滤 | `worldpulse.js`, `main.js` |
| **C** | 战术板 pointer 拖拽、港湾/钢铁/磨坊队服 | `main.js`, `clubs.js`, `models.js`, `avatar.js` |
| **D** | 财政简报、青训周报、世界新闻、成就徽章 | `worldpulse.js`, 概览 UI |

### 比赛引擎 v2（P0–P5）

| 阶段 | 内容 | 文件 |
|------|------|------|
| P0–P4 | 空间模拟、决策、防守、裁判、平衡缩放 | `js/sim/engine.js`, `sim-viewer.html` |
| **P5** | 用户场接入主游戏；AI 后台仍概率引擎 | `js/sim/adapt.js`, `js/match.js` |
| **直播投影** | 录帧 + `applySimSnapshot`，关导演 AI | `matchview.js`, `main.js` driveMatchEvent |

- 开关：`USE_SIM_ENGINE`（`js/sim/adapt.js`）
- 用户场：`SimEngine` 跑半场 → `scaledResult` → 现有 event/报告/积分
- **直播**：半场录帧 → 每分钟抽 ~12 帧 `sim_frame` 真投影；进球只横幅不编舞
- AI 场：仍 `tryAttack` 概率，保证推进日不卡
- 预览手感：`sim-viewer.html`（raw，非 scaled）
- 缓存 **vcfm-v98**
- **netHit**：仅脉冲一帧 + 球门线附近才播网效
- **角球**：高光窗半场≤3；禁区约 5v5 不糊；**主罚人显示层钉在角旗球旁**；徽章开出后 ~2s 清掉（不粘整段）
- 战术涌现：前锋回撤、边锋内切、边卫套边、核心绝对权（`ensureCorePlayer` 主客都有）
- 表现层：`compactSimFrame.ball.z` → 空中球阴影/缩放；simDrive **软跟镜**；球轨迹丝带
- **持球光环**：只认 ball.owner 且贴球；飞行中绝不亮；sim 驱动不用 touchUntil 拖影
- **进球 3s 叙事** `_beginGoalBeat`：助攻传球 → 接球 → 射门弧 → 入网 → 再庆祝
- **禁区分离**：sim `_separateAgents` 双轮 + 显示层 `_visualUnstack`
- 导演：高光慢镜；**FMM 全场稳镜**；进球 hold 中不灌后续 sim 帧冲散庆祝
- FMM UI：横条棋盘草坪 + 两侧看台；底栏 **解说 ticker ↔ 控球条**；自动重播+跳过
- 门架：端线外侧；入网撞击加强
- 庆祝：5–7 人半瞬移围拢 + 更快追角旗；失球方后撤
- 门将：轨迹扑救；空门降扑救；抱稳/托出；圆点侧移残影；压迫必大脚
- 助攻：lastPasser → assistId；高光窗提前
- 球：落地弹跳 + 射门橙黄轨迹

## 关键 API

- `applyPlayerTalk` / `clubAtmosphere` / `relationLabel`
- `startScoutMission(region)` region: `div3`|`div2`|`intl`
- `financeSnapshot(world)`
- `checkManagerBadges` / `noteUserMatchResult`
- `world.scoutMissions[]` · `managerCareer.badges[]`
- `shouldUseSim` / `ensureSimEngine` / `SimEngine.scaledResult({tMin,tMax})`

## 注意

- 勿用 PowerShell `Set-Content` 写中文源码
- 主目录 `F:\VCFM`；说推 GitHub 再 push
- 用户场单场模拟约 1.5–3s（手机可接受）；勿对全联赛后台启用 v2
