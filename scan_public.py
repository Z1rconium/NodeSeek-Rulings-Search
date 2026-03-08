import sqlite3
import json
import os
import html
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes, CallbackQueryHandler
import datetime

# ================= 配置区域 =================
CONFIG_FILE = "config.json"
if not os.path.exists(CONFIG_FILE):
    default_config = {
        "BOT_TOKEN": "YOUR_BOT_TOKEN",
        "DB_FILE": "nodeseek_ruling.db"
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(default_config, f, indent=4, ensure_ascii=False)
    print(f"检测不到配置文件 {CONFIG_FILE}，已自动生成默认配置，请修改后重新运行。")
    exit(1)

with open(CONFIG_FILE, "r", encoding="utf-8") as f:
    config = json.load(f)

BOT_TOKEN = config.get("BOT_TOKEN", "")
DB_FILE = config.get("DB_FILE", "nodeseek_ruling.db")
# ============================================

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
    day_counter = {}

    for row in rows:
        created_at = row[0]
        try:
            clean_str = str(created_at)[:19].replace('T', ' ')
            dt = datetime.datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
            dt_bj = dt + datetime.timedelta(hours=8)
            if dt_bj.date() == yesterday_bj_date:
                yesterday_records += 1
            date_str = dt_bj.strftime("%Y-%m-%d")
            day_counter[date_str] = day_counter.get(date_str, 0) + 1
        except Exception:
            pass

    if day_counter:
        busiest_day = max(day_counter, key=day_counter.get)
        busiest_day_str = f"{busiest_day} ({day_counter[busiest_day]}条)"
    else:
        busiest_day_str = "无"

    return total_records, top_user, top_admin, yesterday_records, busiest_day_str



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
            is_comment = "pinComment" in req_obj or "hideComment" in req_obj
            target_type = "评论" if is_comment else "帖子"
            
            if isinstance(target_val, dict) and "uid" in target_val:
                res.append(f"目标用户UID：{target_val['uid']}")
            elif isinstance(target_val, dict) and "id" in target_val:
                res.append(f"目标{target_type}ID：{target_val['id']}")
            else:
                res.append(f"目标{target_type}ID：{target_val}")
            
        if "postSummary" in req_obj:
            ps = req_obj["postSummary"]
            if "locked" in ps:
                if ps["locked"]:
                    res.append("锁定修改")
                else:
                    res.append("解除锁定")
            else:
                rank = ps.get("rank")
                category = ps.get("category")
                category_map = {
                    "inside": "内板", "trade": "交易", "meaningless": "无意义",
                    "promotion": "推广", "info": "情报", "dev": "技术",
                    "carpool": "拼车", "review": "测评", "daily": "日常",
                    "expose": "曝光", "life": "生活", "photo-share": "贴图",
                }
                if category is not None:
                    category = category_map.get(category, category)
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
            try:
                if int(diff) >= 0:
                    diff_str = f"+{diff}"
                else:
                    diff_str = str(diff)
            except:
                diff_str = str(diff)
                
            if reason:
                res.append(f'因为"{reason}"，所以鸡腿{diff_str}')
            else:
                res.append(f"鸡腿{diff_str}")
                
        if "hideComment" in req_obj:
            hc = req_obj["hideComment"]
            if isinstance(hc, dict) and hc.get("status"):
                res.append("隐藏该用户的全部内容")
            elif isinstance(hc, dict):
                res.append("恢复该用户的全部内容显示")

        if "pinComment" in req_obj:
            pc = req_obj["pinComment"]
            if isinstance(pc, dict) and pc.get("status"):
                res.append("置顶评论")
            elif pc is True or pc == "true":
                res.append("置顶评论")

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
    welcome_text = (
        "🤖 NodeSeek Ruling Bot 已启动！\n"
        "可用命令：\n"
        "🔍 `/search 用户名` - 查询特定用户的处罚记录\n"
        "📊 `/static` - 查看管理记录统计信息"
    )
    await update.message.reply_text(welcome_text, parse_mode='Markdown')

async def send_search_page(update: Update, target: str, page: int, is_callback: bool = False):
    """统一处理发送或更新分页消息的逻辑 (已修复格式转义问题)"""
    per_page = 5
    total_count, results = get_search_results(target, page, per_page)
    
    target_esc = html.escape(target)
    
    if total_count == 0:
        text = f"📭 数据库中未找到关于 <code>{target_esc}</code> 的记录。"
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
    if not context.args:
        await update.message.reply_text("⚠️ 请提供要搜索的用户名。用法：`/search 用户名`", parse_mode='Markdown')
        return

    target = " ".join(context.args)
    
    if len(target.encode('utf-8')) > 40:
        await update.message.reply_text("⚠️ 搜索的用户名过长，请缩短后重试。")
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

async def static_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """响应 /static 命令"""
    try:
        total_records, top_user, top_admin, yesterday_records, busiest_day = get_statistics()
        
        reply_text = (
            f"📊 **统计信息**\n\n"
            f"🗂 **总的管理记录数量**: `{total_records}`\n"
            f"👤 **管理记录最多的用户**: `{top_user}`\n"
            f"👮 **管理记录最多的管理员**: `{top_admin}`\n"
            f"📅 **前一天的管理记录数量**: `{yesterday_records}`\n"
            f"📆 **管理记录最多的日子**: `{busiest_day}`"
        )
    except Exception as e:
        reply_text = f"⚠️ 获取统计信息时出错：{e}"

    await update.message.reply_text(reply_text, parse_mode='Markdown')



def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("search", search_user))

    app.add_handler(CommandHandler("static", static_cmd))
    
    app.add_handler(CallbackQueryHandler(search_callback, pattern=r"^s\|"))

    print("Bot 启动中...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()