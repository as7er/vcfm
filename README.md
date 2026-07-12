# VC 足球经理

轻量网页足球经理，灵感来自 [Football Manager](https://www.footballmanager.com/)。纯前端、无后端，适合通勤摸鱼：手机浏览器打开就能玩。

> 本作为粉丝向简化娱乐作品，与 Sports Interactive / SEGA 无关联。

## 在线游玩

**https://as7er.github.io/vc-football-manager/**

| 说明 | 详情 |
|------|------|
| 设备 | 手机 / 平板 / 电脑浏览器均可 |
| 存档 | 当前浏览器 `localStorage`，**3 个槽位** |
| 换机 | 游戏内 **导出 / 导入** JSON（清缓存会丢进度） |
| 安装 | 支持 PWA：浏览器「添加到主屏幕」更像 App |
| 语言 | 中文 / English · 日间 / 夜间主题 |

仓库：https://github.com/as7er/vc-football-manager

## 怎么玩（30 秒）

1. 选乙级球队 → **开始新赛季**  
2. **推进一天** / **推进到比赛日**（有比赛时会停）  
3. **进入比赛** → 快速模拟 / 直播 / 一键完赛（可调倍速 ×1/×2/×4）  
4. 中场可改战术、换人；赛后看报告  
5. 转会窗内买卖；随时 **存档**，换设备请 **导出**

## 主要系统

- **联赛**：超联 / 甲级 / 乙级，升降级 + VC 联赛杯  
- **比赛**：情境（天气/德比）、细事件、中场干预、2D 俯视球场（镜头跟随、射门轨迹、点球员看卡）  
- **纪律**：累计黄牌停赛、红牌停赛；赛前简报；60'/75' 教练提示  
- **阵容**：体能、士气、伤病、潜力、球衣号码、自动阵容  
- **设施**：球场 / 训练 / 青训等级升级  
- **转会**：夏窗·冬窗、合同谈判（年限/周薪）、球探报告、AI 挖角报价  
- **经营**：董事会目标与解雇压力、职员、训练日程、周薪与设施维护  
- **生涯**：经理战绩、赛季结算页、俱乐部荣誉墙、球员分赛季历史与个人荣誉  
- **存档**：多槽、自动存、导出提醒（约 7 天未导出会提示）

## 本地运行

ES Module 需通过 HTTP 打开（不要直接双击 `index.html`）。

```bash
# Python
python -m http.server 8080
# 浏览器打开 http://localhost:8080

# 或 Node
npx serve .
```

改完代码推送到 `master` 后，GitHub Pages 会更新在线版（可能有 1～2 分钟缓存；手机可强刷或清站点数据）。

## 技术栈

- 静态站点：HTML + CSS + ES Modules（无构建步骤）  
- 数据与进度：浏览器 `localStorage`  
- 部署：[GitHub Pages](https://pages.github.com/)  
- 可选离线：`manifest.webmanifest` + Service Worker

## 许可证

本项目采用 **[MIT License](./LICENSE)**。

你可以自由使用、修改、分发本代码（含商业用途），只需保留版权与许可证声明。游戏内随机生成的球员/俱乐部名称等仅为玩法素材，不代表真实人物或俱乐部。

## 反馈

Issue / PR 欢迎：https://github.com/as7er/vc-football-manager/issues
