import os
import json
import sqlite3
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

TURSO_URL = os.getenv("TURSO_DATABASE_URL", "")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")

# Check if remote Turso is configured
USE_TURSO = bool(TURSO_URL and TURSO_TOKEN and "turso.io" in TURSO_URL)

if USE_TURSO:
    HTTP_URL = TURSO_URL.replace("libsql://", "https://").rstrip("/") + "/v2/pipeline"
    HEADERS = {
        "Authorization": f"Bearer {TURSO_TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "LaserAssistant/1.0"
    }
else:
    HTTP_URL = None
    HEADERS = None


def _format_value(val):
    if val is None:
        return {"type": "null"}
    elif isinstance(val, int):
        return {"type": "integer", "value": str(val)}
    elif isinstance(val, float):
        return {"type": "float", "value": val}
    elif isinstance(val, (dict, list)):
        return {"type": "text", "value": json.dumps(val, ensure_ascii=False)}
    else:
        return {"type": "text", "value": str(val)}


def _parse_row(cols, row_vals):
    record = {}
    for col_name, cell in zip(cols, row_vals):
        val_type = cell.get("type", "null")
        val = cell.get("value")
        if val_type == "null" or val is None:
            record[col_name] = None
        elif val_type == "integer":
            record[col_name] = int(val)
        elif val_type == "float":
            record[col_name] = float(val)
        else:
            record[col_name] = str(val)
    return record


def execute_batch(stmts_with_args: list):
    """Execute multiple SQL statements over Turso Pipeline."""
    if not stmts_with_args:
        return []

    if USE_TURSO:
        requests = []
        for item in stmts_with_args:
            if isinstance(item, str):
                sql = item
                params = []
            else:
                sql, params = item
            requests.append({
                "type": "execute",
                "stmt": {
                    "sql": sql,
                    "args": [_format_value(p) for p in params]
                }
            })
        
        payload_bytes = json.dumps({"requests": requests}).encode("utf-8")
        req = urllib.request.Request(HTTP_URL, data=payload_bytes, headers=HEADERS, method="POST")
        
        try:
            with urllib.request.urlopen(req, timeout=12.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise Exception(f"Turso HTTP Error {e.code}: {err_body}")
        except Exception as e:
            raise Exception(f"Turso Connection Error: {str(e)}")

        results = []
        for res in data.get("results", []):
            if res.get("type") == "error":
                raise Exception(f"SQL Error: {res.get('error', {}).get('message', 'Unknown error')}")
            exec_res = res.get("response", {}).get("result", {})
            cols = [c["name"] for c in exec_res.get("cols", [])]
            raw_rows = exec_res.get("rows", [])
            rows = [_parse_row(cols, r) for r in raw_rows]
            results.append({
                "rows": rows,
                "last_id": exec_res.get("last_insert_rowid"),
                "affected": exec_res.get("affected_row_count", 0)
            })
        return results
    else:
        conn = sqlite3.connect("laser_local.db")
        cur = conn.cursor()
        results = []
        for item in stmts_with_args:
            if isinstance(item, str):
                sql, params = item, []
            else:
                sql, params = item
            cur.execute(sql, params)
            if sql.strip().upper().startswith("SELECT"):
                rows = [dict(sqlite3.Row(cur, r)) for r in cur.fetchall()]
                results.append({"rows": rows, "last_id": None, "affected": 0})
            else:
                results.append({"rows": [], "last_id": cur.lastrowid, "affected": cur.rowcount})
        conn.commit()
        conn.close()
        return results


def execute(sql: str, params: list = None):
    """Execute single SQL query."""
    res = execute_batch([(sql, params or [])])
    return res[0] if res else {"rows": [], "last_id": None, "affected": 0}


def init_db():
    """Create all required tables in Turso database if they don't exist."""
    queries = [
        """CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            category TEXT DEFAULT 'client',
            company_name TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            balance REAL DEFAULT 0.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            project_type TEXT DEFAULT 'company',
            client_id INTEGER,
            client_name TEXT DEFAULT '',
            client_phone TEXT DEFAULT '',
            manager_name TEXT DEFAULT '',
            material_type TEXT DEFAULT 'حديد أسود',
            thickness_mm REAL DEFAULT 1.0,
            cutting_length_meters REAL DEFAULT 0.0,
            pierce_count INTEGER DEFAULT 0,
            gas_type TEXT DEFAULT 'أكسجين O2',
            estimated_time_min REAL DEFAULT 0.0,
            sheet_fraction REAL DEFAULT 0.0,
            material_cost REAL DEFAULT 0.0,
            cutting_cost REAL DEFAULT 0.0,
            extra_cost REAL DEFAULT 0.0,
            total_cost REAL DEFAULT 0.0,
            client_price REAL DEFAULT 0.0,
            net_profit REAL DEFAULT 0.0,
            status TEXT DEFAULT 'design',
            deadline TEXT DEFAULT '',
            cad_file_name TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS materials_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            density REAL DEFAULT 7.85,
            price_per_kg REAL DEFAULT 50.0,
            default_gas TEXT DEFAULT 'أكسجين O2'
        )""",
        """CREATE TABLE IF NOT EXISTS whatsapp_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            template_type TEXT DEFAULT 'status_update',
            content TEXT NOT NULL
        )"""
    ]

    execute_batch(queries)

    # Populate default templates if empty
    res = execute("SELECT COUNT(*) as cnt FROM whatsapp_templates;")
    if res["rows"] and res["rows"][0]["cnt"] == 0:
        default_templates = [
            ("إشعار جاهزية الشغلانة للاستلام", "ready", "أهلاً باشمهندس {client_name}، نحيطكم علماً بأن مشروعك ({project_title}) تم الانتهاء من تقطيعه وتشطيبه وهو الآن جاهز للاستلام 🚀. نسعد بزيارتك!"),
            ("تأكيد استلام وبدء التنفيذ", "start", "أهلاً باشمهندس {client_name}، تم مراجعة ملفات التصميم لمشروع ({project_title}) والبدء في أعمال التقطيع بالليزر. الموعد المتوقع للتسليم: {deadline} ⏱️."),
            ("عرض سعر وتقطيع ليزر", "quote", "السلام عليكم باشمهندس {client_name}، بخصوص مشروع ({project_title}):\n- الخامة: {material} سمك {thickness} مم\n- التكلفة الإجمالية: {price} ج.م\n- موعد التسليم: {deadline}\nفي انتظار تأكيد حضرتك للبدء فوراً."),
            ("تحديث أسعار الخامات والصاج (جماعية)", "broadcast", "تحياتنا لجميع عملائنا وشركاء النجاح ⚙️، نود إحاطتكم بتوفر ألواح صاج حديد واستانلس بجميع التخانات مع دقة تقطيع عالية وسرعة تسليم. يسعدنا استقبال رسوماتكم وتصميماتكم في أي وقت!")
        ]
        t_batch = [
            ("INSERT INTO whatsapp_templates (title, template_type, content) VALUES (?, ?, ?);", [t[0], t[1], t[2]])
            for t in default_templates
        ]
        execute_batch(t_batch)
