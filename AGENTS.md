# VCFM — 会话记忆点（给后续 Agent / 自己）

> 用户要求「记住本次记忆点」。更新功能时请同步本文件关键条目。  
> 仓库：https://github.com/as7er/vcfm.git · 分支 `master`  
> 本地预览：`python -m http.server 8765 --bind 127.0.0.1` → `http://127.0.0.1:8765/`（勿用 `file://`）

## 项目形态

- 静态 SPA 足球经理；真源在 `js/match.js`（模拟），`matchview.js` 偏表现。
- 存档 localStorage；改 JS/CSS 后靠 **Service Worker 版本号** + 用户 **Ctrl+F5**。
- `sw.js`：**JS/CSS/HTML 网络优先**（v46 起），避免改队服/战术后仍吃旧缓存；当前 **`vcfm-v51`**。
- `index.html` 入口带 `?v=N` 与 SW `register("./sw.js?v=N")`，升版本时两边一起改。

## 近期已交付（勿重复造轮子）

| 主题 | 要点 | 关键文件 |
|------|------|----------|
| 合同/租借 | 续约、解约、外租/租入/召回 + UI | `contracts.js`, `loans.js`, `main.js` |
| 头像 v2 | 中性灰背景、球衣强制对比、双描边；**零队色进背景** | `avatar.js`, `css/style.css` |
| 头像 v3 compact | `size<=32` 或 `opts.compact`：点状眼、抬亮肤色、收脸宽、简化伤/汗细节；clip id 含 size 防同页冲突 | `avatar.js` |
| 头像 v3.1 | compact **强制浅肤**、深发抬亮、**短顶发**（禁蓬松/披肩）、无胡须、背景略亮 | `avatar.js` |
| 头像 v4 token | `size<=44` 球员走 `renderTokenAvatarSvg`：大肉色脸+短发帽+简化球衣，**非完整小人缩放** | `avatar.js` |
| 战术板头像尺寸 | 槽位/替补 `playerAvatarHtml(..., 40)`；`.player-dot .circle` 46px；SW **v51** | `main.js`, `css/style.css` |
| 落日城 `sunset` | 固定橙 `#f97316` + 紫 `#5b21b6` + sash；`ensureKit` 覆盖旧存档；avatar 内也有 `AVATAR_KIT_THEME` | `clubs.js`, `models.js`, `avatar.js` |
| 战术深度 | 8 阵型 + `FORM_MOD`；风格克制 `STYLE_MATCHUP`；宽度/防线；预设；控球/犯规/体能挂钩 | `data.js`, `match.js` |
| 首发 | 用户开球 **`ensureMatchLineup`（不 forceAuto）** 尽量保留 XI；AI `forceAuto` | `models.js`, `match.js` |
| 拖拽首发 | 战术板槽位互换、替补拖上场、点选二次点击；替补席 `#tac-bench` | `main.js`, `models.js`（`swapLineupSlots` / `setLineupSlot`）, `index.html` |

## 战术对象（club.tactics）

```
formation, style, pressing, tempo, width, defensiveLine, lineup[]
```

- 读档用 `ensureTactics(club)` 补字段。
- 风格：`balanced|attack|defend|possession|counter`。
- 阵型键含：`4-3-3`, `4-4-2`, `3-5-2`, `4-2-3-1`, `5-3-2`, `3-4-3`, `4-1-4-1`, `4-5-1`。
- 预设：`TACTIC_PRESETS`（铁桶/高压/传控/防反/全攻/均衡）。

## 用户偏好与沟通

- 界面与对话以**中文**为主；i18n 有 en 键时一并补。
- 改完视觉/缓存类问题：优先怀疑 SW；给清缓存/Unregister 步骤。
- 用户说「推到 GitHub」再 commit+push；说明用完整句 commit message。
- 继续迭代时用户常说「继续」——可从 README/本文件 + 未做项里挑下一块。
- 工作区主目录：`F:\VCFM`。

## 已知缺口 / 可后续做

- 战术板仍无「角色指令」（DM/AM/边后卫职责等）细粒度。
- 中场可改阵型+滑条，但直播条无换阵型。
- 触屏拖拽依赖 HTML5 DnD；复杂设备可再补 pointer 手势。
- 其他俱乐部也可像 `sunset` 一样进 `CLUB_KIT_THEMES` / `KIT_THEME_BY_ID`（两处需同步，avatar 主题表第三处）。

## 最近推送

- `981fb05` — 头像对比 + 落日城主题  
- `4cb6d0f` — 战术系统 + 拖拽换人上首发  
- `23a3183` — 头像 v3 compact + 战术板 30px + SW v49  
- （本提交）头像 v4 token 令牌 + 战术板 46px + SW v51  

## 自测提醒

- 落日城头像应为**亮橙+紫**，灰背景对比明显。
- 战术页圆点：**大肉色脸 + 短发帽 + 下半橙紫球衣**（token，不是缩成黑球的小人）；详情卡 64px 仍完整五官/发型。
- 战术页：拖替补上场、两槽互换、点选流程；存档刷新后 XI 仍在。
- 赛前简报 / 中场 / 场边战术与 `applyUserHalfTime` / `applyLiveTactics` 字段对齐（含 width、defensiveLine）。
- 改完后若仍见旧图：Application → Unregister SW → Ctrl+F5。
