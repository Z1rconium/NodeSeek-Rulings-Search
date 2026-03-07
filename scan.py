import asyncio
import sqlite3
import time
import json
import random
import os
import html
from curl_cffi import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes, CallbackQueryHandler
import datetime

# ================= 配置区域 =================
CONFIG_FILE = "config.json"
if not os.path.exists(CONFIG_FILE):
    default_config = {
        "BOT_TOKEN": "YOUR_BOT_TOKEN",
        "ADMIN_CHAT_ID": 123456789, 
        "DB_FILE": "nodeseek_ruling.db",
        "COOKIE_FILE": "cookie.txt",
        "API_URL_TEMPLATE": "https://www.nodeseek.com/api/admin/ruling/id-{}"
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(default_config, f, indent=4, ensure_ascii=False)
    print(f"检测不到配置文件 {CONFIG_FILE}，已自动生成默认配置，请修改后重新运行。")
    exit(1)

with open(CONFIG_FILE, "r", encoding="utf-8") as f:
    config = json.load(f)

BOT_TOKEN = config.get("BOT_TOKEN", "")
ADMIN_CHAT_ID = config.get("ADMIN_CHAT_ID", 0)
DB_FILE = config.get("DB_FILE", "nodeseek_ruling.db")
COOKIE_FILE = config.get("COOKIE_FILE", "cookie.txt")
API_URL_TEMPLATE = config.get("API_URL_TEMPLATE", "https://www.nodeseek.com/api/admin/ruling/id-{}")
# ============================================

# --- Cookie 管理 ---
def get_cookie():
    if os.path.exists(COOKIE_FILE):
        with open(COOKIE_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""

def save_cookie(cookie_str):
    with open(COOKIE_FILE, "w", encoding="utf-8") as f:
        f.write(cookie_str)

def get_last_scan_time():
    if os.path.exists("last_scan_time.txt"):
        with open("last_scan_time.txt", "r", encoding="utf-8") as f:
            return f.read().strip()
    return "尚未记录"

def set_last_scan_time():
    import datetime
    dt_bj = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    with open("last_scan_time.txt", "w", encoding="utf-8") as f:
        f.write(dt_bj.strftime("%Y-%m-%d %H:%M:%S"))

# --- 数据库操作 ---
def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rulings (
            id INTEGER PRIMARY KEY,
            admin_name TEXT,
            target_name TEXT,
            post_id INTEGER,
            action_request TEXT,
            created_at TEXT,
            raw_data TEXT,
            fetch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    return conn

def get_last_scraped_id(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(id) FROM rulings")
    result = cursor.fetchone()
    return result[0] if result[0] is not None else 0

def get_search_results(target, page, per_page=5):
    """获取分页搜索结果"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM rulings WHERE target_name LIKE ?", (f"%{target}%",))
    total_count = cursor.fetchone()[0]
    
    offset = (page - 1) * per_page
    cursor.execute(
        "SELECT id, admin_name, action_request, created_at FROM rulings WHERE target_name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?", 
        (f"%{target}%", per_page, offset)
    )
    results = cursor.fetchall()
    conn.close()
    
    return total_count, results

def get_statistics():
    """获取统计信息"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM rulings")
    total_records = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT target_name, COUNT(*) as c FROM rulings WHERE target_name IS NOT NULL AND target_name != '' GROUP BY target_name ORDER BY c DESC LIMIT 1")
    top_user_row = cursor.fetchone()
    top_user = f"{top_user_row[0]} ({top_user_row[1]}次)" if top_user_row else "无"
    
    cursor.execute("SELECT admin_name, COUNT(*) as c FROM rulings WHERE admin_name IS NOT NULL AND admin_name != '' GROUP BY admin_name ORDER BY c DESC LIMIT 1")
    top_admin_row = cursor.fetchone()
    top_admin = f"{top_admin_row[0]} ({top_admin_row[1]}次)" if top_admin_row else "无"
    
    import datetime
    cursor.execute("SELECT created_at FROM rulings WHERE created_at IS NOT NULL AND created_at != ''")
    rows = cursor.fetchall()
    conn.close()
    
    yesterday_records = 0
    now_bj = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    yesterday_bj_date = (now_bj - datetime.timedelta(days=1)).date()
    
    for row in rows:
        created_at = row[0]
        try:
            clean_str = str(created_at)[:19].replace('T', ' ')
            dt = datetime.datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
            dt_bj = dt + datetime.timedelta(hours=8)
            if dt_bj.date() == yesterday_bj_date:
                yesterday_records += 1
        except Exception:
            pass

    return total_records, top_user, top_admin, yesterday_records

# --- 核心爬虫逻辑 (同步函数) ---
def fetch_and_save_sync():
    cookie = get_cookie()
    if not cookie:
        return "NO_COOKIE"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": cookie,
        "Accept": "application/json"
    }

    conn = init_db()
    last_id = get_last_scraped_id(conn)
    current_id = last_id + 1
    error_count = 0
    scraped_count = 0
    
    session = requests.Session(impersonate="chrome120", headers=headers)
    
    while True:
        if error_count > 5:
            print(f"连续错误超过5次，停止在 ID: {current_id}")
            break

        url = API_URL_TEMPLATE.format(current_id)
        try:
            response = session.get(url, timeout=10)
            
            if response.status_code == 200:
                resp_json = response.json()
                if resp_json.get("success") and resp_json.get("data") and len(resp_json["data"]) > 0:
                    data = resp_json["data"][0]
                    record_id = data.get("id", current_id)
                    admin_name = data.get("admin_member_name", "")
                    target_name = data.get("target_member_name", "")
                    post_id = data.get("post_id", 0)
                    action_request = data.get("request", "")
                    created_at = data.get("created_at", "")
                    
                    cursor = conn.cursor()
                    cursor.execute(
                        """INSERT OR IGNORE INTO rulings 
                           (id, admin_name, target_name, post_id, action_request, created_at, raw_data) 
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (record_id, admin_name, target_name, post_id, action_request, created_at, json.dumps(data, ensure_ascii=False))
                    )
                    conn.commit()
                    print(f"成功获取并保存 ID: {record_id}")
                    error_count = 0
                    scraped_count += 1
                    current_id = record_id + 1
                else:
                    error_count += 1
                    current_id += 1
                    
            elif response.status_code == 403:
                print(f"遇到 403 错误，Cookie 过期。当前 ID: {current_id}")
                conn.close()
                set_last_scan_time()
                return "403_FORBIDDEN"
                
            else:
                print(f"请求失败，状态码: {response.status_code}，当前 ID: {current_id}")
                error_count += 1
                current_id += 1
                
        except Exception as e:
            print(f"发生异常: {e}，当前 ID: {current_id}")
            error_count += 1
            current_id += 1
            
        time.sleep(random.uniform(0.1, 0.5))

    conn.close()
    set_last_scan_time()
    return f"DONE_{scraped_count}"

# ================= Telegram Bot 交互逻辑 =================

def translate_action_request(req):
    if not req:
        return ""
    try:
        import ast
        if isinstance(req, str):
            try:
                req_obj = json.loads(req)
            except Exception:
                req_obj = ast.literal_eval(req)
        else:
            req_obj = req
            
        if not isinstance(req_obj, dict):
            return str(req)
            
        res = []
        is_stardust = "stardust" in req_obj
        
        if "target" in req_obj and not is_stardust:
            target_val = req_obj['target']
            if isinstance(target_val, dict) and "uid" in target_val:
                res.append(f"目标用户UID：{target_val['uid']}")
            elif isinstance(target_val, dict) and "id" in target_val:
                res.append(f"目标帖子ID：{target_val['id']}")
            else:
                res.append(f"目标帖子ID：{target_val}")
            
        if "postSummary" in req_obj:
            ps = req_obj["postSummary"]
            rank = ps.get("rank")
            category = ps.get("category")
            if rank is not None and category is not None:
                res.append(f"帖子的阅读等级设置为{rank}，并且移动到{category}板块")
            elif category is not None:
                res.append(f"将帖子移动到{category}板块")
            elif rank is not None:
                res.append(f"帖子的阅读等级设置为{rank}")
                
        if "coin" in req_obj:
            coin = req_obj["coin"]
            reason = coin.get("reason", "")
            diff = coin.get("coin_diff", "")
            if reason:
                res.append(f'因为"{reason}"，所以鸡腿{diff}')
            else:
                res.append(f"鸡腿{diff}")
                
        if "hideComment" in req_obj:
            hc = req_obj["hideComment"]
            if hc.get("status"):
                res.append("隐藏该用户的全部内容")
            else:
                res.append("恢复该用户的全部内容显示")

        if "suspend" in req_obj:
            sus = req_obj["suspend"]
            if sus.get("status"):
                val = sus.get("value", "")
                res.append(f"用户被禁言{val}天")
                
        if is_stardust:
            sd = req_obj["stardust"]
            diff = sd.get("stardust_diff", "")
            target_id = ""
            if "target" in req_obj:
                t = req_obj["target"]
                if isinstance(t, dict):
                    target_id = t.get("uid", t.get("id", ""))
                else:
                    target_id = t
            
            try:
                if int(diff) < 0:
                    action = "处罚"
                else:
                    action = "奖励"
            except ValueError:
                action = "调整"
                
            res.append(f"对{target_id}用户采取{diff}星辰币的{action}")
                
        if res:
            return "，".join(res)
        return str(req)
    except Exception:
        return str(req)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    last_time = get_last_scan_time()
    welcome_text = (
        "🤖 NodeSeek Ruling Bot 已启动！\n"
        "可用命令：\n"
        "🔍 `/search 用户名` - 查询特定用户的处罚记录\n"
        "📊 `/static` - 查看管理记录统计信息\n"
        "🍪 `/setcookie 你的cookie` - 更新爬虫使用的 Cookie\n"
        "▶️ `/run` - 立即手动执行一次抓取\n\n"
        f"🕒 最后爬取时间：{last_time}"
    )
    await update.message.reply_text(welcome_text, parse_mode='Markdown')

async def send_search_page(update: Update, target: str, page: int, is_callback: bool = False):
    """统一处理发送或更新分页消息的逻辑 (已修复格式转义问题)"""
    per_page = 5
    total_count, results = get_search_results(target, page, per_page)
    
    target_esc = html.escape(target)
    
    if total_count == 0:
        last_time = get_last_scan_time()
        text = f"📭 数据库中未找到关于 <code>{target_esc}</code> 的记录。\n\n🕒 最后爬取时间：{last_time}"
        if is_callback:
            await update.callback_query.edit_message_text(text, parse_mode='HTML')
        else:
            await update.message.reply_text(text, parse_mode='HTML')
        return

    total_pages = (total_count + per_page - 1) // per_page
    
    msg_lines = [f"🔍 <b>关于 <code>{target_esc}</code> 的检索结果 (共 {total_count} 条，第 {page}/{total_pages} 页)：</b>\n"]
    for row in results:
        record_id, admin_name, action_request, created_at = row
        
        admin_name_esc = html.escape(str(admin_name))
        action_request_translated = translate_action_request(action_request)
        action_request_esc = html.escape(action_request_translated)
        
        try:
            clean_str = str(created_at)[:19].replace('T', ' ')
            dt = datetime.datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
            dt_bj = dt + datetime.timedelta(hours=8)
            created_at_bj = dt_bj.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            created_at_bj = str(created_at)
        
        line = (f"🆔 <b>ID</b>: <code>{record_id}</code>\n"
                f"👮 <b>操作人</b>: {admin_name_esc}\n"
                f"📝 <b>原因/操作</b>: {action_request_esc}\n"
                f"🕒 <b>时间</b>: {created_at_bj}\n"
                f"{'-'*20}")
        msg_lines.append(line)
    
    last_time = get_last_scan_time()
    msg_lines.append(f"\n🕒 最后爬取时间：{last_time}")
    reply_text = "\n".join(msg_lines)
    
    keyboard = []
    row = []
    if page > 1:
        row.append(InlineKeyboardButton("⬅️ 上一页", callback_data=f"s|{page-1}|{target}"))
    if page < total_pages:
        row.append(InlineKeyboardButton("下一页 ➡️", callback_data=f"s|{page+1}|{target}"))
        
    if row:
        keyboard.append(row)
        
    reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None
    
    if is_callback:
        await update.callback_query.edit_message_text(reply_text, parse_mode='HTML', reply_markup=reply_markup)
    else:
        await update.message.reply_text(reply_text, parse_mode='HTML', reply_markup=reply_markup)

async def search_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """响应 /search 命令"""
    last_time = get_last_scan_time()
    if not context.args:
        await update.message.reply_text(f"⚠️ 请提供要搜索的用户名。用法：`/search 用户名`\n\n🕒 最后爬取时间：{last_time}", parse_mode='Markdown')
        return

    target = " ".join(context.args)
    
    if len(target.encode('utf-8')) > 40:
        await update.message.reply_text(f"⚠️ 搜索的用户名过长，请缩短后重试。\n\n🕒 最后爬取时间：{last_time}")
        return

    await send_search_page(update, target, page=1, is_callback=False)

async def search_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理用户点击上一页/下一页按钮的事件"""
    query = update.callback_query
    await query.answer()
    
    data = query.data
    # 解析 callback_data
    if data.startswith("s|"):
        parts = data.split("|", 2)
        if len(parts) == 3:
            page = int(parts[1])
            target = parts[2]
            await send_search_page(update, target, page, is_callback=True)

async def set_cookie_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    last_time = get_last_scan_time()
    if not context.args:
        await update.message.reply_text(f"⚠️ 请提供 Cookie 内容。用法：\n`/setcookie session=xxx; cf_clearance=yyy...`\n\n🕒 最后爬取时间：{last_time}", parse_mode='Markdown')
        return

    new_cookie = " ".join(context.args)
    save_cookie(new_cookie)
    await update.message.reply_text(f"✅ Cookie 已成功更新并保存！\n\n🕒 最后爬取时间：{last_time}")

async def static_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """响应 /static 命令"""
    last_time = get_last_scan_time()
    
    try:
        total_records, top_user, top_admin, yesterday_records = get_statistics()
        
        reply_text = (
            f"📊 **统计信息**\n\n"
            f"🗂 **总的管理记录数量**: `{total_records}`\n"
            f"👤 **管理记录最多的用户**: `{top_user}`\n"
            f"👮 **管理记录最多的管理员**: `{top_admin}`\n"
            f"📅 **前一天的管理记录数量**: `{yesterday_records}`\n\n"
            f"🕒 最后爬取时间：{last_time}"
        )
    except Exception as e:
        reply_text = f"⚠️ 获取统计信息时出错：{e}\n\n🕒 最后爬取时间：{last_time}"

    await update.message.reply_text(reply_text, parse_mode='Markdown')

async def run_scraper_task(context: ContextTypes.DEFAULT_TYPE):
    status = await asyncio.to_thread(fetch_and_save_sync)
    last_time = get_last_scan_time()
    
    if status == "403_FORBIDDEN":
        warning_msg = (
            "⚠️ **爬虫警告：Cookie 已失效！**\n\n"
            "抓取 API 返回了 403 错误（可能被 Cloudflare 拦截或 Cookie 过期）。\n"
            "请在浏览器重新抓包获取，并通过以下命令更新：\n"
            "`/setcookie 你的新Cookie内容`\n\n"
            f"🕒 最后爬取时间：{last_time}"
        )
        await context.bot.send_message(chat_id=ADMIN_CHAT_ID, text=warning_msg, parse_mode='Markdown')
    elif status == "NO_COOKIE":
        await context.bot.send_message(chat_id=ADMIN_CHAT_ID, text=f"⚠️ 爬虫未能启动：未找到 Cookie，请使用 `/setcookie` 设置。\n\n🕒 最后爬取时间：{last_time}")
    elif status.startswith("DONE"):
        count = status.split("_")[1]
        if int(count) > 0:
            await context.bot.send_message(chat_id=ADMIN_CHAT_ID, text=f"✅ 定时抓取完成，新增 `{count}` 条数据。\n\n🕒 最后爬取时间：{last_time}", parse_mode='Markdown')

async def manual_run(update: Update, context: ContextTypes.DEFAULT_TYPE):
    last_time = get_last_scan_time()
    await update.message.reply_text(f"⏳ 开始执行后台抓取，这可能需要一点时间...\n\n🕒 最后爬取时间：{last_time}")
    await run_scraper_task(context)
    last_time = get_last_scan_time()
    await update.message.reply_text(f"🏁 手动抓取任务执行完毕（如有403会自动发送警告）。\n\n🕒 最后爬取时间：{last_time}")


def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("search", search_user))
    app.add_handler(CommandHandler("setcookie", set_cookie_cmd))
    app.add_handler(CommandHandler("run", manual_run))
    app.add_handler(CommandHandler("static", static_cmd))
    
    app.add_handler(CallbackQueryHandler(search_callback, pattern="^s\|"))

    import datetime
    t = datetime.time(hour=0, minute=0, second=0) 
    app.job_queue.run_daily(run_scraper_task, time=t, name="daily_scraper")

    print("Bot 启动中...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()