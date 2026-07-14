# VCFM — 会话记忆点（给后续 Agent / 自己）

> 用户要求「记住本次记忆点」。更新功能时请同步本文件关键条目。  
> 仓库：https://github.com/as7er/vcfm.git · 分支 `master`  
> 本地预览：`python -m http.server 8765 --bind 127.0.0.1` → `http://127.0.0.1:8765/`（勿用 `file://`）

## 项目形态

- 静态 SPA 足球经理；真源在 `js/match.js`（模拟），`matchview.js` 偏表现。
- 存档 localStorage；改 JS/CSS 后靠 **Service Worker 版本号** + 用户 **Ctrl+F5**。
- `sw.js`：**网络优先 + no-store**；当前 **`vcfm-v57`**。
- Ctrl+F5 **清不掉** SW Cache；应 Unregister 或靠版本号删旧 cache。

## 近期已交付

| 主题 | 要点 | 文件 |
|------|------|------|
| 角色指令 v1 | `roles[]` 槽位 + 比赛权重 | `data.js`, `models.js`, `match.js`, `main.js` |
| 队内讲话 v1 | 赛前/中场 5 选项 | `data.js`, `match.js`, `main.js` |
| Inbox v1 | 董事会/挖角/球探/球员待办 | `inbox.js`, `board.js`, `engine.js` |
| **球探/对手报告 v1** | 属性可见度 fog；赛前对手报告（阵型/风格噪声）；关注列表 | `scoutreport.js`, `main.js` |
| 体能整数显示 | 展示 + 写入取整 | `main.js`, `training.js`, `match.js` |

## 球探 fog 档位（staff.scout.rating）

| 档 | 评分约 | 外队属性 | 对手报告 |
|----|--------|----------|----------|
| 0 | <9 | 高/中/偏低 档位 | 阵型/风格易错，1 名威胁 |
| 1 | 9–11 | 区间 ±2 | 偶发估计错误 |
| 2 | 12–15 | 区间 ±1 | 基本准确 |
| 3 | ≥16 | 精确数值 | 精确 |

- `buildOpponentReport` / `formatOpponentReportHtml` / `opponentReportLogLines`
- 挂在赛前简报（概览 compact + 比赛页 full）与评论流
- `world.scoutWatch[]`：信箱加入 → 转会页「球探关注」

## FM 路线图

① 角色 ✅ ② 讲话 ✅ ③ Inbox ✅ ④ 球探/对手报告 ✅ → **⑤ 中场换阵型 + 角色复盘**

## 用户偏好

- 中文为主；说「推到 GitHub」再 commit+push。
- 主目录：`F:\VCFM`。

## 自测

- 比赛日进入比赛：赛前有 **对手报告** 卡片（可信度%、阵型/风格、危险球员、定位球）。
- 点对方球员：能力/属性随球探等级模糊；本队仍精确。
- 升球探职员后可见度应变清晰。
- 信箱球探「加入关注」→ 转会页列表。
