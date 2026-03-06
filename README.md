# NodeSeek Ruling Bot

一个用于抓取并查询 [NodeSeek](https://www.nodeseek.com) 管理员处罚记录的 Telegram Bot。

## 功能特性

- **自动定时抓取**：每天北京时间早上 8:00 自动调用 NodeSeek 管理 API，将处罚记录增量保存到本地 SQLite 数据库。
- **用户名查询**：通过 Telegram 命令搜索指定用户名的处罚历史，支持模糊匹配与分页翻页。
- **中文友好输出**：自动将原始 API 的 JSON 操作字段翻译为中文（禁言天数、鸡腿变动、帖子移动等），时间自动转换为北京时间（UTC+8）。
- **403/Cookie 告警**：Cookie 失效时主动向管理员推送 Telegram 告警消息。
- **手动触发抓取**：无需等待定时任务，可通过命令立即执行一次抓取。

## 环境要求

- Python 3.9+
- 依赖库：

```bash
pip install curl_cffi python-telegram-bot[job-queue]
```

## 配置

编辑 `scan.py` 顶部的配置区域：

```python
BOT_TOKEN    = "YOUR_BOT_TOKEN"   # BotFather 给你的 Bot Token
ADMIN_CHAT_ID = 123456789         # 你的 Telegram User ID（纯数字）
```

> **注意**：`BOT_TOKEN` 和 `ADMIN_CHAT_ID` 绝对不要上传到公开仓库。

## 运行

```bash
python scan.py
```

首次运行前必须先通过 `/setcookie` 设置有效的 NodeSeek Cookie，否则爬虫无法启动。

## Bot 命令

| 命令 | 说明 |
|---|---|
| `/start` | 查看帮助与可用命令列表 |
| `/search <用户名>` | 查询该用户的全部处罚记录（支持分页） |
| `/setcookie <cookie内容>` | 更新爬虫使用的 Cookie（Cookie 过期后使用） |
| `/run` | 立即手动触发一次抓取任务 |

## 文件说明

| 文件 | 说明 |
|---|---|
| `scan.py` | 主程序（爬虫 + Bot 逻辑） |
| `cookie.txt` | 存储 NodeSeek Cookie（首次运行后自动创建） |
| `nodeseek_ruling.db` | SQLite 数据库，存放所有抓取到的处罚记录 |

## Cookie 获取方式

1. 登录 NodeSeek，打开浏览器开发者工具（F12）
2. 切换到 **Network** 标签，刷新页面
3. 找到任意请求，在 **Request Headers** 中复制 `Cookie` 字段的完整内容
4. 在 Telegram 中发送：`/setcookie <粘贴的内容>`

Cookie 失效后（收到 403 告警）重复上述操作即可。

## 注意事项

- 本工具仅供学习研究，请勿用于任何违规用途。
- NodeSeek 管理 API 需要有管理员权限的账号 Cookie 才能访问。
- 每次请求之间有 0.1~0.5 秒随机延迟，连续出错超过 5 次自动停止，避免对目标站造成压力。
