# NodeSeek Rulings Search Bot

这是一个用于抓取和查询 NodeSeek 论坛处理记录（Ruling）的 Telegram Bot。它能够自动采集论坛的处理结果并存储到本地数据库，方便用户随时通过 Telegram 搜索特定用户的处罚历史。

## ✨ 功能特性

- **自动抓取**：支持定时（每日）或手动触发抓取最新的处理记录。
- **配置灵活**：通过 `config.json` 轻松管理 Bot Token、管理员 ID 等设置。
- **Cookie 管理**：支持通过指令直接在 Telegram 中更新爬虫所需的 Cookie，无需重启。
- **智能解析**：自动解析原始的处理请求 JSON 数据，将其转化为易读的中文描述（如禁言天数、鸡腿奖惩、星辰币变动等）。
- **分页搜索**：内置分页查询功能，支持大批量搜索结果的翻页浏览。
- **状态追踪**：自动记录并展示最后一次成功爬取的时间。
- **安全提醒**：当 Cookie 失效（403 错误）时，会自动向管理员发送警告消息。

## 🚀 快速开始

### 1. 安装依赖

确保你已安装 Python 3.8+。运行以下命令安装必要的依赖库：

```bash
pip install python-telegram-bot curl_cffi
```

> 注意：`curl_cffi` 用于模拟浏览器环境，以绕过简单的反爬措施。

### 2. 初始化配置

首次运行程序：

```bash
python scan.py
```

程序会因为找不到 `config.json` 而退出，并自动生成一个默认模板。请编辑 `config.json`：

```json
{
    "BOT_TOKEN": "你的_TELEGRAM_BOT_TOKEN",
    "ADMIN_CHAT_ID": 123456789, 
    "DB_FILE": "nodeseek_ruling.db",
    "COOKIE_FILE": "cookie.txt",
    "API_URL_TEMPLATE": "https://www.nodeseek.com/api/admin/ruling/id-{}"
}
```

- `BOT_TOKEN`: 从 @BotFather 获取。
- `ADMIN_CHAT_ID`: 你的 Telegram UID（用于接收警告消息）。

### 3. 设置 Cookie

为了让爬虫能够访问 API，你需要提供有效的论坛 Cookie。

1. 在浏览器登录 NodeSeek，打开开发者工具（F12）。
2. 在“网络 (Network)”面板找到任意请求，复制 `Cookie` 请求头的值。
3. 启动 Bot 后，在私聊中发送指令更新：
   `/setcookie 你的Cookie内容`

### 4. 运行 Bot

```bash
python scan.py
```

## 🤖 Bot 指令说明

- `/start` - 查看功能介绍及最后抓取时间。
- `/search 用户名` - 搜索特定用户的处罚记录（支持分页）。
- `/setcookie <cookie>` - 手动更新爬虫 Cookie。
- `/run` - 立即触发一次全量抓取任务。

## 🛠️ 项目结构

- `scan.py`: 核心逻辑文件（爬虫 + Bot 逻辑）。
- `config.json`: 配置文件。
- `nodeseek_ruling.db`: SQLite3 数据库文件。
- `cookie.txt`: 存储最新的 Cookie 内容。
- `last_scan_time.txt`: 记录最后一次扫描成功的时间戳。

## 📝 开发与维护

爬虫采用 `curl_cffi` 进行指纹模拟，默认使用 `chrome120` 版本的 TLS 指纹。
定时任务默认在每日 00:00:00 执行。

---

*免责声明：本项目仅供学习和研究使用，请勿用于违反论坛规则或法律法规的行为。*
