# NodeSeek Rulings Search Bot

这是一个用于抓取和查询 NodeSeek 论坛管理处理记录（Ruling）的 Telegram Bot。它能够自动采集论坛的管理操作记录并存储到本地 SQLite 数据库，方便用户随时通过 Telegram 搜索特定用户的处罚历史。

项目提供两种运行模式：
- **完整模式 (`scan.py`)**：包含爬虫抓取功能和查询功能，适合管理员运行。
- **公开模式 (`scan_public.py`)**：仅包含查询功能并带有访问频率限制，适合部署给公众使用。

## ✨ 功能特性

- **双模式运行**：
  - `scan.py`：全功能版本，支持定时爬取、手动触发、Cookie 管理。
  - `scan_public.py`：轻量查询版，带频率限制（100次/分钟），保护数据库性能。
- **自动定时抓取**：每 6 小时自动执行一次增量抓取（Bot 启动时立即执行首次），也支持手动触发（仅限完整模式）。
- **外部配置文件**：通过 `config.json` 管理 Bot Token、管理员 Chat ID、数据库路径等。
- **Cookie 热更新**：完整模式支持通过 Telegram 指令直接更新爬虫 Cookie，需配合配置文件中的密码。
- **智能操作翻译**：自动将原始 JSON 格式的管理操作翻译为易读的中文描述，支持以下操作类型：
  - 帖子移动（板块名自动中文翻译）
  - 帖子阅读等级调整
  - 帖子锁定 / 解除锁定
  - 鸡腿（coin）奖惩
  - 星辰币（stardust）奖惩
  - 用户禁言
  - 评论置顶
  - 隐藏/恢复用户内容
- **统计信息**：可查询总管理记录数、记录最多用户、最活跃管理员、昨日记录数等。
- **AI 诚信分析 Prompt**：搜索结果的最后一页会自动生成一段可直接复制的 AI 分析 Prompt，从「诚信度」和「遵守论坛规则」两个维度（各 50 分，满分 100）对用户进行评分分析。
- **安全保障**：
  - 搜索结果自动 HTML 转义，防止 HTML 注入。
  - 公开模式内置滑动窗口限流。
- **Cookie 失效告警**：(仅限完整模式) 当抓取遇到 403 错误时自动推送告警给管理员。

## 🚀 快速开始

### 1. 安装依赖

确保已安装 Python 3.8+，然后安装所需依赖：

```bash
pip install python-telegram-bot[job-queue] curl_cffi
```

> `curl_cffi` 用于模拟浏览器指纹，绕过基础反爬。

### 2. 初始化配置

运行任意脚本（如 `python scan.py`），程序会生成默认 `config.json`。根据实际模式编辑配置文件：

#### 完整模式配置项 (`scan.py`)
```json
{
    "BOT_TOKEN": "你的_TELEGRAM_BOT_TOKEN",
    "ADMIN_CHAT_ID": 123456789,
    "DB_FILE": "nodeseek_ruling.db",
    "COOKIE_FILE": "cookie.txt",
    "API_URL_TEMPLATE": "https://www.nodeseek.com/api/admin/ruling/id-{}",
    "PASSWORD": "你的管理密码"
}
```

#### 公开模式配置项 (`scan_public.py`)
```json
{
    "BOT_TOKEN": "你的_TELEGRAM_BOT_TOKEN",
    "DB_FILE": "nodeseek_ruling.db"
}
```

| 字段            | 说明                                                     |
| --------------- | -------------------------------------------------------- |
| `BOT_TOKEN`     | 从 [@BotFather](https://t.me/BotFather) 获取的 Bot Token |
| `ADMIN_CHAT_ID` | (完整模式) 管理员 ID，用于接收抓取报告和告警             |
| `PASSWORD`      | (完整模式) 设置 Cookie 时的验证密码                      |
| `DB_FILE`       | SQLite 数据库文件路径                                    |

### 3. 运行项目

根据需求运行对应的脚本：

- **后台抓取与查询**：`python scan.py`
- **仅供他人查询**：`python scan_public.py`

## 🤖 Bot 指令说明

| 指令                         | 说明                                                         | 适用模式 |
| ---------------------------- | ------------------------------------------------------------ | -------- |
| `/start`                     | 查看 Bot 功能介绍及运行状态                                  | 全部     |
| `/search <用户名>`           | **精确**搜索特定用户的处罚记录（用户名须完全一致）           | 全部     |
| `/partial_match <关键词>`    | **模糊**搜索用户的处罚记录（支持中文），多用户时提供选择按钮 | 全部     |
| `/static`                    | 查看全局统计信息                                             | 全部     |
| `/setcookie <密码> <Cookie>` | 手动验证密码并更新 Cookie                                    | 完整模式 |
| `/run`                       | 立即手动触发一次抓取任务                                     | 完整模式 |

## 🛠️ 项目结构

| 文件                 | 说明                    |
| -------------------- | ----------------------- |
| `scan.py`            | 完整版（抓取 + 查询）   |
| `scan_public.py`     | 公开版（仅查询 + 限流） |
| `config.json`        | 集中式配置文件          |
| `nodeseek_ruling.db` | 核心数据库文件          |
| `last_scan_time.txt` | 记录扫瞄进度的标记文件  |

## ⚙️ 技术细节

- **精确搜索**：`/search` 指令采用精确匹配（`=`），用户名须与数据库中完全一致才会返回结果。
- **模糊搜索**：`/partial_match` 指令使用 `LIKE` 模糊匹配（支持中文）。匹配到多个用户时以按钮列表展示供选择，仅一个用户时直接展示记录详情，并提供返回按钮。
- **搜索结果格式**：每条记录依次展示 `👤 用户名`、`👮 操作人`、`📝 原因/操作`、`🕒 时间` 和 `📋 管理记录链接`。最后一页末尾附带 AI 诚信分析 Prompt（`<pre>` 块，Telegram 内点击即可复制）。
- **频率限制**：`scan_public.py` 限制每分钟 100 次全局查询，防止机器人恶意拖库或由于并发过高导致服务器卡顿。
- **爬取逻辑**：`scan.py` 采用增量抓取策略，每次从数据库中最大的 ID 开始继续向下探测。
- **时区安全**：程序内部强制使用北京时间（UTC+8）进行日期计算。

## 🔐 Query Backend 安全配置（用于油猴公开查询）

`query_backend.py` 启动时会读取 `query_backend_config.json`。若文件不存在，会自动生成默认模板。

推荐配置示例：

```json
{
  "DB_FILE": "nodeseek_ruling.db",
  "HOST": "0.0.0.0",
  "PORT": 8765,
  "MAX_QUERIES_PER_MINUTE": 100,
  "MAX_QUERIES_PER_IP_PER_MINUTE": 30,
  "BURST_WINDOW_SECONDS": 10,
  "BURST_THRESHOLD": 8,
  "BAN_BASE_SECONDS": 300,
  "BAN_MAX_SECONDS": 86400,
  "BAN_RESET_SECONDS": 86400,
  "STATE_TTL_SECONDS": 86400,
  "DEFAULT_PER_PAGE": 5,
  "MAX_PER_PAGE": 20,
  "TURNSTILE_SITE_KEY": "你的 Turnstile Site Key",
  "TURNSTILE_SECRET": "你的 Turnstile Secret",
  "CAPTCHA_BYPASS_SECONDS": 1800,
  "TRUST_X_FORWARDED_FOR": false
}
```

说明：

- 不再使用固定 `API_KEY` 客户端鉴权（避免公开脚本泄露密钥风险）。
- 同时启用全局限流和单 IP 限流。
- 在短时间突发请求触发阈值时，会临时封禁该 IP，并采用指数退避延长封禁时间。
- 启用 Turnstile 后，用户需先完成验证码校验，后端才允许查询。
- 查询接口保持只读，不会修改数据库内容。

后端接口：

- `GET /api/search?target=<username>&page=1&per_page=5`
- `GET /api/captcha/config`
- `GET /api/captcha/verify?token=<turnstile_token>`

---

*免责声明：本项目仅供学习和研究使用，请勿用于违反论坛规则或法律法规的行为。*
