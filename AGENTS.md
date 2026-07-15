# VCFM — 会话记忆点

> 仓库：https://github.com/as7er/vcfm.git · `master`  
> 预览：`python -m http.server 8765 --bind 127.0.0.1`  
> 缓存：**vcfm-v86**（主客对称战术行为 + 核心自动指定；边锋内切；高光直播）

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
- 缓存 **vcfm-v86**
- 战术涌现：前锋回撤、边锋内切、边卫套边、核心绝对权（`ensureCorePlayer` 主客都有）

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
