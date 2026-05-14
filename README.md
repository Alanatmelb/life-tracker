# Life Tracker

一个极简打卡 PWA。零依赖、无后端、纯前端，部署在 GitHub Pages 上，可作为 iOS / Android 主屏幕 App 使用。

## 功能

- **今日**：日期选择器 + 当日应做的所有计划，一键 ✓ / ✗ 打卡
- **计划**：新建、编辑、归档任务；支持 三种频率：仅一次、每天、每周指定星期几
- **报告**：7 天 / 30 天 / 全部 完成率，每个任务的 30 天完成率，30 天打卡热力图
- **离线可用**：通过 Service Worker 缓存 app shell
- **本地数据**：所有数据保存在浏览器 localStorage，**不上传任何服务器**
- **导出 / 导入 JSON**：方便备份和迁移

## 技术栈

纯 HTML / CSS / JavaScript，无框架，无构建步骤。

```
.
├── index.html              单页 App 外壳
├── styles.css              iOS 风格样式（自动深色模式）
├── app.js                  全部逻辑
├── manifest.webmanifest    PWA 清单
├── sw.js                   Service Worker
├── icons/                  PWA 图标（占位）
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   └── generate-icons.ps1  重新生成图标的 PowerShell 脚本
└── README.md
```

## 部署到 GitHub Pages

1. 在 GitHub 创建一个新仓库，例如 `life-tracker`（public 或 private 都可，public 才能用免费 Pages）。
2. 把本目录所有文件 push 到 `main` 分支：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/life-tracker.git
   git push -u origin main
   ```
3. 在仓库页面：**Settings → Pages → Build and deployment**
   - Source 选 `Deploy from a branch`
   - Branch 选 `main` / `/ (root)`
   - 保存
4. 等 1–2 分钟，访问 `https://<your-username>.github.io/life-tracker/`

## 在 iPhone 上添加到主屏幕

1. 用 **Safari** 打开上面的链接（必须是 Safari，Chrome / Firefox 都不行）
2. 点底部分享按钮（中间那个方框 + 向上箭头）
3. 滚动找到 **"添加到主屏幕"**
4. 命名 `Tracker` → 添加
5. 主屏幕会出现图标，点击进入即是全屏 App 体验

> **重要**：每次打开请从主屏幕图标进入，而不是 Safari 浏览器。从主屏幕进入的实例有更稳定的本地存储。

## 数据安全与备份（请认真阅读）

**优点**：

- 所有数据只在你设备的浏览器里，不会上传到任何服务器
- 没有账号、没有密码、没有第三方追踪
- GitHub Pages 自动 HTTPS

**风险**：

- iOS Safari 的 **Intelligent Tracking Prevention (ITP)** 可能在你长期不使用网页版时清除 localStorage
- 主屏幕 PWA 实例相对稳定，但**不保证永久**，App 卸载或长期不打开有概率丢失
- 用户手动 "清除 Safari 网站数据" 一定会丢
- 浏览器更换、设备更换、出厂重置都会丢
- **手机和电脑的数据是独立的，不会自动同步**

**强烈建议的备份做法**：

1. 在 **计划** 页右上角点 **导出**，会下载一个 `life-tracker-YYYY-MM-DD.json` 文件
2. 把它存到 iCloud Drive / OneDrive / 邮件给自己 / 微信"文件传输助手"
3. 建议**每周备份一次**
4. 换手机或丢数据后，在新设备访问同一 URL，再用 **导入** 把 JSON 文件恢复

## 数据格式

`localStorage` 使用单 key `lifetracker:v1`，存一个 JSON 对象：

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "t_xxx",
      "title": "12:30 前睡觉",
      "note": "",
      "time": "00:30",
      "schedule": {
        "type": "daily",
        "startDate": "2026-05-04"
      },
      "createdAt": "2026-05-04T10:00:00.000Z",
      "archived": false
    }
  ],
  "checkins": {
    "2026-05-04": {
      "t_xxx": "done"
    }
  }
}
```

`schedule.type` 可为：

- `"once"` — 单次，需要 `date: "YYYY-MM-DD"`
- `"daily"` — 每天，从 `startDate` 起
- `"weekly"` — 每周，需要 `weekdays: [0,1,...,6]`（0 = 周日）

`checkins[date][taskId]` 取值 `"done"` 或 `"missed"`，不存在表示未打卡。

## 开发与本地预览

直接用浏览器打开 `index.html` 大部分功能可用，但 Service Worker 需要 HTTP/HTTPS 服务。最简单的做法：

```bash
# Python 3
python -m http.server 8000

# 或 Node
npx serve .
```

然后访问 `http://localhost:8000`。

## 自定义图标

默认图标是蓝底白字 "L" 占位图。要换成自己的图标：

- 替换 `icons/` 下三个 PNG 文件即可（保持文件名和尺寸：192×192、512×512、180×180）
- 或编辑 `icons/generate-icons.ps1` 修改 `Letter` / `Hex` 颜色后重新运行

## 隐私

无统计、无埋点、无外部资源。打开浏览器的 Network 面板可以验证：除了你自己的域名，没有任何外部请求。

## License

MIT

## 目标模块补充

新增的 **目标** 页用于创建自定义目标周期，并基于 **今日** 页已有打卡记录自动计算达成情况。目标页不会修改打卡记录；打卡仍然只在 **今日** 页完成。

新数据会保存在同一个 `lifetracker:v1` localStorage 对象的 `goalPeriods` 字段中。旧备份没有 `goalPeriods` 也能正常导入和使用。

```json
{
  "goalPeriods": [
    {
      "id": "gp_xxx",
      "startDate": "2026-05-14",
      "endDate": "2026-05-20",
      "createdAt": "2026-05-14T10:00:00.000Z",
      "updatedAt": "2026-05-14T10:00:00.000Z",
      "goals": [
        {
          "id": "g_xxx",
          "sourceTaskId": "t_xxx",
          "title": "12:30 前睡觉",
          "targetDays": 6
        }
      ]
    }
  ]
}
```

说明：

- `startDate` / `endDate` 是 inclusive 日期范围。
- `targetDays` 表示该周期内至少完成多少天。
- 目标完成数不单独存储，而是从 `checkins[date][sourceTaskId] === "done"` 动态计算。
- 删除目标周期只删除 `goalPeriods` 里的该周期，不删除每日计划，也不删除已有打卡记录。
