# VCFM — 会话记忆点（给后续 Agent / 自己）

> 仓库：https://github.com/as7er/vcfm.git · `master`  
> 本地：`python -m http.server 8765 --bind 127.0.0.1` → http://127.0.0.1:8765/  
> 当前缓存：**vcfm-v58**

## FM 路线图（全部完成）

| # | 内容 | 状态 |
|---|------|------|
| ① | 角色指令 | ✅ |
| ② | 队内讲话 | ✅ |
| ③ | Inbox 信箱 | ✅ |
| ④ | 球探 / 对手报告 | ✅ |
| ⑤ | 中场换阵型 + 角色复盘 | ✅ v58 |

## ⑤ 要点

- 中场面板：换阵型 → `ensureMatchLineup` + `ensureLineupRoles({reset:true})`
- 中场：上半场角色复盘（进球/助攻挂角色）+ 下半场角色下拉
- 场边条：可换阵型（`applyLiveTactics` formation）
- 赛后战报：角色复盘块
- `buildRoleReview(state, { untilMinute })`

## 其它模块速查

- 讲话：`TEAM_TALKS` / `applyTeamTalk`
- 信箱：`js/inbox.js` · `processInboxDay`
- 球探：`scoutFogLevel` · `buildOpponentReport`
- 体能：展示与写入整数

## 用户偏好

- 中文；说「推到 GitHub」再 push
- 主目录 `F:\VCFM`
- SW 缓存：Unregister 或升版本号

## 最近提交

- `38d313a` — talks + inbox + scout fog (v57)
- （本地）HT formation + role review → v58 待推
