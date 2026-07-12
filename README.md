# VC 足球经理

简化版足球经理游戏（网页版），灵感来自 Football Manager。

## 如何运行

**推荐：本地静态服务器**（ES Module 需要通过 http 打开）

### 方式一：VS Code / Cursor
安装 “Live Server” 插件，右键 `index.html` → Open with Live Server。

### 方式二：Python
在项目目录执行：

```bash
python -m http.server 8080
```

浏览器打开：http://localhost:8080

### 方式三：Node
```bash
npx serve .
```

## 功能（MVP）

- 10 支球队联赛，双循环赛程
- 球员属性、体能、士气、伤病
- 阵型 / 战术倾向
- 比赛快速模拟 / 直播回放
- 转会买入 / 卖出
- 积分榜、赛程、新闻
- 浏览器本地存档（localStorage）

## 操作提示

1. 选队 → 开始新赛季  
2. **推进一天** 直到比赛日  
3. **进入比赛** → 快速或直播模拟  
4. 在「战术」页调整阵型，「转会」页买卖球员  
5. 随时点 **存档**
