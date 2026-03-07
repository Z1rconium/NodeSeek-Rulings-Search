# NodeSeek Rulings Search Bot

这是一个用于抓取和查询 NodeSeek 论坛管理处理记录（Ruling）的 Telegram Bot。它能够自动采集论坛的管理操作记录并存储到本地 SQLite 数据库，方便用户随时通过 Telegram 搜索特定用户的处罚历史。

## ✨ 功能特性

- **自动定时抓取**：每日 00:00:00 自动执行一次全量抓取，也支持手动触发。
- **外部配置文件**：通过 `config.json` 管理 Bot Token、管理员 Chat ID、数据库路径等，首次运行自动生成默认模板。
- **Cookie 热更新**：支持通过 Telegram 指令直接更新爬虫 Cookie，无需重启 Bot。
- **智能操作翻译**：自动将原始 JSON 格式的管理操作翻译为易读的中文描述，支持以下操作类型：
  - 帖子移动（板块名自动中文翻译）
  - 帖子阅读等级调整
  - 帖子锁定 / 解除锁定
  - 鸡腿（coin）奖惩
  - 星辰币（stardust）奖惩
  - 用户禁言
  - 评论置顶
  - 隐藏/恢复用户内容
- **板块名中文映射**：自动翻译英文板块名为中文（如 `trade` → 交易、`dev` → 技术 等）。
- **分页搜索**：内置 Inline Button 分页，支持大批量搜索结果的翻页浏览。
- **统计信息**：可查询总管理记录数、被管理最多的用户、最活跃管理员、前一天管理记录数。
- **状态追踪**：自动记录并在每条回复中展示最后一次成功爬取的时间。
- **Cookie 失效告警**：当 API 返回 403 时自动向管理员推送告警消息。

## 🚀 快速开始

### 1. 安装依赖

确保已安装 Python 3.8+，然后安装依赖：

```bash
pip install python-telegram-bot[job-queue] curl_cffi
```

> `curl_cffi` 用于模拟 Chrome 120 的 TLS 指纹，绕过基础反爬。
> `python-telegram-bot[job-queue]` 包含定时任务所需的 `APScheduler` 依赖。

### 2. 初始化配置

首次运行：

```bash
python scan.py
```

程序会因为找不到 `config.json` 而退出，并自动生成默认配置模板。编辑 `config.json`：

```json
{
    "BOT_TOKEN": "你的_TELEGRAM_BOT_TOKEN",
    "ADMIN_CHAT_ID": 123456789,
    "DB_FILE": "nodeseek_ruling.db",
    "COOKIE_FILE": "cookie.txt",
    "API_URL_TEMPLATE": "https://www.nodeseek.com/api/admin/ruling/id-{}"
}
```

| 字段 | 说明 |
|------|------|
| `BOT_TOKEN` | 从 [@BotFather](https://t.me/BotFather) 获取的 Bot Token |
| `ADMIN_CHAT_ID` | 管理员的 Telegram 用户 ID，用于接收告警和抓取通知 |
| `DB_FILE` | SQLite 数据库文件路径 |
| `COOKIE_FILE` | Cookie 存储文件路径 |
| `API_URL_TEMPLATE` | 论坛 Ruling API 的 URL 模板，`{}` 为 ID 占位符 |

### 3. 设置 Cookie

1. 在浏览器登录 NodeSeek，打开开发者工具（F12）。
2. 在"网络 (Network)"面板找到任意请求，复制 `Cookie` 请求头的值。
3. 启动 Bot 后，在私聊中发送指令更新：
   ```
   /setcookie 你的Cookie内容
   ```

### 4. 运行 Bot

```bash
python scan.py
```

## 🤖 Bot 指令说明

| 指令 | 说明 |
|------|------|
| `/start` | 查看 Bot 功能介绍及最后一次抓取时间 |
| `/search <用户名>` | 搜索特定用户的管理记录（支持模糊匹配、分页浏览） |
| `/static` | 查看统计信息：总记录数、最多被管理用户、最活跃管理员、前一天记录数 |
| `/setcookie <cookie>` | 手动更新爬虫使用的 Cookie |
| `/run` | 立即手动触发一次全量抓取任务 |

## 📝 操作翻译规则

Bot 会自动将 API 返回的 JSON 格式 `request` 字段翻译为可读的中文。以下是支持的翻译规则：

| 原始字段 | 翻译逻辑 |
|----------|----------|
| `postSummary.locked: true` | 锁定修改 |
| `postSummary.locked: false` | 解除锁定 |
| `postSummary.category` | 将帖子移动到对应板块（自动翻译板块名） |
| `postSummary.rank` | 帖子的阅读等级设置 |
| `coin.coin_diff` | 鸡腿增减（附带原因） |
| `stardust.stardust_diff` | 星辰币奖惩（自动判断正负） |
| `suspend.status: true` | 用户被禁言 N 天 |
| `pinComment.status: true` | 置顶评论 |
| `hideComment.status: true` | 隐藏该用户的全部内容 |
| `hideComment.status: false` | 恢复该用户的全部内容显示 |

### 板块名映射表

| 英文标识 | 中文名称 |
|----------|----------|
| `inside` | 内板 |
| `trade` | 交易 |
| `meaningless` | 无意义 |
| `promotion` | 推广 |
| `info` | 情报 |
| `dev` | 技术 |
| `carpool` | 拼车 |
| `review` | 测评 |
| `daily` | 日常 |
| `expose` | 曝光 |
| `life` | 生活 |
| `photo-share` | 贴图 |

## 🛠️ 项目结构

| 文件 | 说明 |
|------|------|
| `scan.py` | 核心逻辑文件（爬虫 + Bot + 翻译引擎） |
| `config.json` | 外部配置文件（首次运行自动生成） |
| `nodeseek_ruling.db` | SQLite3 数据库，存储所有管理记录 |
| `cookie.txt` | 存储最新的论坛 Cookie |
| `last_scan_time.txt` | 记录最后一次成功爬取的时间戳 |

## ⚙️ 技术细节

- **TLS 指纹模拟**：使用 `curl_cffi` 的 `chrome120` 配置进行请求，模拟真实浏览器指纹。
- **错误容忍**：连续 5 次请求失败后自动停止本次抓取，避免无效请求。
- **请求间隔**：每次请求间随机等待 0.1~0.5 秒，降低被检测风险。
- **时区处理**：所有展示时间自动转换为北京时间（UTC+8）。
- **HTML 转义**：搜索结果使用 HTML 格式渲染，自动转义用户输入防止注入。

---

*免责声明：本项目仅供学习和研究使用，请勿用于违反论坛规则或法律法规的行为。*
