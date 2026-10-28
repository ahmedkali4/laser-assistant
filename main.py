import os
import urllib.parse
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import database

load_dotenv()

app = FastAPI(title="المساعد الشخصي لمهندس الليزر", version="1.0.0")

# Ensure DB initialized on start
database.init_db()

# --- Pydantic Models ---

class ProjectCreate(BaseModel):
    title: str
    project_type: str = "company" # 'company' or 'personal'
    client_id: Optional[int] = None
    client_name: str = ""
    client_phone: str = ""
    manager_name: str = ""
    material_type: str = "حديد أسود"
    thickness_mm: float = 1.0
    cutting_length_meters: float = 0.0
    pierce_count: int = 0
    gas_type: str = "أكسجين O2"
    estimated_time_min: float = 0.0
    sheet_fraction: float = 0.0
    material_cost: float = 0.0
    cutting_cost: float = 0.0
    extra_cost: float = 0.0
    total_cost: float = 0.0
    client_price: float = 0.0
    net_profit: float = 0.0
    status: str = "design"
    deadline: str = ""
    cad_file_name: str = ""
    notes: str = ""

class StatusUpdate(BaseModel):
    status: str

class ClientCreate(BaseModel):
    name: str
    phone: str
    category: str = "client" # 'client', 'manager', 'supplier', 'workshop'
    company_name: str = ""
    notes: str = ""
    balance: float = 0.0

class TemplateCreate(BaseModel):
    title: str
    template_type: str = "status_update"
    content: str

class CalculatorRequest(BaseModel):
    material_type: str # 'حديد أسود', 'استانلس 304', 'ألومنيوم', 'مجلفن'
    thickness_mm: float # e.g. 1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 10.0
    cutting_length_meters: float
    pierce_count: int
    gas_type: str # 'أكسجين O2', 'نيتروجين N2', 'هواء مضغوط Air'
    sheet_fraction: float = 0.0 # fraction of sheet used (0.1 to 1.0)
    sheet_price_total: float = 0.0 # full sheet price if known
    extra_cost: float = 0.0 # bending, painting, etc.
    profit_margin_percent: float = 35.0 # target profit margin %

# --- API Endpoints ---

@app.get("/api/bootstrap")
def get_bootstrap_data():
    """Return all initial data in a single fast round-trip."""
    stats_query = """
    SELECT 
        COUNT(*) as total_projects,
        COALESCE(SUM(CASE WHEN status != 'delivered' THEN 1 ELSE 0 END), 0) as active_projects,
        COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) as delivered_projects,
        COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) as ready_projects,
        COALESCE(SUM(CASE WHEN project_type = 'company' THEN 1 ELSE 0 END), 0) as company_count,
        COALESCE(SUM(CASE WHEN project_type = 'personal' THEN 1 ELSE 0 END), 0) as personal_count,
        COALESCE(SUM(client_price), 0) as total_revenue,
        COALESCE(SUM(total_cost), 0) as total_cost,
        COALESCE(SUM(net_profit), 0) as total_profit,
        COALESCE(SUM(CASE WHEN project_type = 'personal' THEN net_profit ELSE 0 END), 0) as personal_profit,
        COALESCE(SUM(CASE WHEN project_type = 'company' THEN net_profit ELSE 0 END), 0) as company_profit,
        (SELECT COUNT(*) FROM clients) as total_clients
    FROM projects;
    """
    batch_results = database.execute_batch([
        stats_query,
        "SELECT * FROM projects ORDER BY id DESC;",
        "SELECT * FROM clients ORDER BY id DESC;",
        "SELECT * FROM whatsapp_templates ORDER BY id ASC;"
    ])

    stats_row = batch_results[0]["rows"][0] if batch_results and batch_results[0]["rows"] else {}
    projects_rows = batch_results[1]["rows"] if len(batch_results) > 1 else []
    clients_rows = batch_results[2]["rows"] if len(batch_results) > 2 else []
    templates_rows = batch_results[3]["rows"] if len(batch_results) > 3 else []

    return {
        "stats": stats_row,
        "projects": projects_rows,
        "clients": clients_rows,
        "templates": templates_rows
    }


@app.get("/api/stats")

def get_stats():
    """Return dashboard summary stats in a single fast query."""
    stats_query = """
    SELECT 
        COUNT(*) as total_projects,
        COALESCE(SUM(CASE WHEN status != 'delivered' THEN 1 ELSE 0 END), 0) as active_projects,
        COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) as delivered_projects,
        COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) as ready_projects,
        COALESCE(SUM(CASE WHEN project_type = 'company' THEN 1 ELSE 0 END), 0) as company_count,
        COALESCE(SUM(CASE WHEN project_type = 'personal' THEN 1 ELSE 0 END), 0) as personal_count,
        COALESCE(SUM(client_price), 0) as total_revenue,
        COALESCE(SUM(total_cost), 0) as total_cost,
        COALESCE(SUM(net_profit), 0) as total_profit,
        COALESCE(SUM(CASE WHEN project_type = 'personal' THEN net_profit ELSE 0 END), 0) as personal_profit,
        COALESCE(SUM(CASE WHEN project_type = 'company' THEN net_profit ELSE 0 END), 0) as company_profit,
        (SELECT COUNT(*) FROM clients) as total_clients
    FROM projects;
    """
    res = database.execute(stats_query)
    data = res["rows"][0] if res["rows"] else {}
    return data



@app.get("/api/projects")
def get_projects(
    project_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None
):
    """List projects with optional filtering."""
    conditions = []
    params = []

    if project_type and project_type != "all":
        conditions.append("project_type = ?")
        params.append(project_type)

    if status and status != "all":
        conditions.append("status = ?")
        params.append(status)

    if search:
        search_pattern = f"%{search}%"
        conditions.append("(title LIKE ? OR client_name LIKE ? OR cad_file_name LIKE ? OR notes LIKE ?)")
        params.extend([search_pattern, search_pattern, search_pattern, search_pattern])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"SELECT * FROM projects {where_clause} ORDER BY id DESC;"
    res = database.execute(sql, params)
    return res["rows"]


@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    res = database.execute("SELECT * FROM projects WHERE id = ?;", [project_id])
    if not res["rows"]:
        raise HTTPException(status_code=404, detail="المشروع غير موجود")
    return res["rows"][0]


@app.post("/api/projects")
def create_project(item: ProjectCreate):
    # Calculate costs if not already computed
    if item.total_cost == 0.0:
        item.total_cost = item.material_cost + item.cutting_cost + item.extra_cost
    if item.net_profit == 0.0 and item.client_price > 0:
        item.net_profit = item.client_price - item.total_cost

    sql = """
    INSERT INTO projects (
        title, project_type, client_id, client_name, client_phone, manager_name,
        material_type, thickness_mm, cutting_length_meters, pierce_count, gas_type,
        estimated_time_min, sheet_fraction, material_cost, cutting_cost, extra_cost,
        total_cost, client_price, net_profit, status, deadline, cad_file_name, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """
    params = [
        item.title, item.project_type, item.client_id, item.client_name, item.client_phone,
        item.manager_name, item.material_type, item.thickness_mm, item.cutting_length_meters,
        item.pierce_count, item.gas_type, item.estimated_time_min, item.sheet_fraction,
        item.material_cost, item.cutting_cost, item.extra_cost, item.total_cost,
        item.client_price, item.net_profit, item.status, item.deadline, item.cad_file_name,
        item.notes
    ]
    res = database.execute(sql, params)
    return {"message": "تم إضافة المشروع بنجاح", "id": res["last_id"]}


@app.put("/api/projects/{project_id}")
def update_project(project_id: int, item: ProjectCreate):
    if item.total_cost == 0.0:
        item.total_cost = item.material_cost + item.cutting_cost + item.extra_cost
    item.net_profit = item.client_price - item.total_cost

    sql = """
    UPDATE projects SET
        title = ?, project_type = ?, client_id = ?, client_name = ?, client_phone = ?,
        manager_name = ?, material_type = ?, thickness_mm = ?, cutting_length_meters = ?,
        pierce_count = ?, gas_type = ?, estimated_time_min = ?, sheet_fraction = ?,
        material_cost = ?, cutting_cost = ?, extra_cost = ?, total_cost = ?,
        client_price = ?, net_profit = ?, status = ?, deadline = ?, cad_file_name = ?,
        notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
    """
    params = [
        item.title, item.project_type, item.client_id, item.client_name, item.client_phone,
        item.manager_name, item.material_type, item.thickness_mm, item.cutting_length_meters,
        item.pierce_count, item.gas_type, item.estimated_time_min, item.sheet_fraction,
        item.material_cost, item.cutting_cost, item.extra_cost, item.total_cost,
        item.client_price, item.net_profit, item.status, item.deadline, item.cad_file_name,
        item.notes, project_id
    ]
    database.execute(sql, params)
    return {"message": "تم تحديث المشروع بنجاح"}


@app.patch("/api/projects/{project_id}/status")
def update_project_status(project_id: int, body: StatusUpdate):
    database.execute(
        "UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;",
        [body.status, project_id]
    )
    return {"message": "تم تحديث حالة المشروع بنجاح"}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    database.execute("DELETE FROM projects WHERE id = ?;", [project_id])
    return {"message": "تم حذف المشروع بنجاح"}


# --- Clients & Contacts API ---

@app.get("/api/clients")
def get_clients(category: Optional[str] = None):
    if category and category != "all":
        res = database.execute("SELECT * FROM clients WHERE category = ? ORDER BY id DESC;", [category])
    else:
        res = database.execute("SELECT * FROM clients ORDER BY id DESC;")
    return res["rows"]


@app.post("/api/clients")
def create_client(c: ClientCreate):
    sql = "INSERT INTO clients (name, phone, category, company_name, notes, balance) VALUES (?, ?, ?, ?, ?, ?);"
    res = database.execute(sql, [c.name, c.phone, c.category, c.company_name, c.notes, c.balance])
    return {"message": "تمت إضافة جهة الاتصال بنجاح", "id": res["last_id"]}


@app.put("/api/clients/{client_id}")
def update_client(client_id: int, c: ClientCreate):
    sql = "UPDATE clients SET name = ?, phone = ?, category = ?, company_name = ?, notes = ?, balance = ? WHERE id = ?;"
    database.execute(sql, [c.name, c.phone, c.category, c.company_name, c.notes, c.balance, client_id])
    return {"message": "تم تحديث جهة الاتصال بنجاح"}


@app.delete("/api/clients/{client_id}")
def delete_client(client_id: int):
    database.execute("DELETE FROM clients WHERE id = ?;", [client_id])
    return {"message": "تم حذف جهة الاتصال بنجاح"}


# --- WhatsApp Templates & Link Generator ---

@app.get("/api/templates")
def get_templates():
    res = database.execute("SELECT * FROM whatsapp_templates ORDER BY id ASC;")
    return res["rows"]


@app.post("/api/templates")
def create_template(t: TemplateCreate):
    sql = "INSERT INTO whatsapp_templates (title, template_type, content) VALUES (?, ?, ?);"
    res = database.execute(sql, [t.title, t.template_type, t.content])
    return {"message": "تم حفظ القالب بنجاح", "id": res["last_id"]}


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: int):
    database.execute("DELETE FROM whatsapp_templates WHERE id = ?;", [template_id])
    return {"message": "تم حذف القالب بنجاح"}


class WhatsAppLinkRequest(BaseModel):
    phone: str
    message: str

@app.post("/api/whatsapp/link")
def create_whatsapp_link(req: WhatsAppLinkRequest):
    # Normalize phone number (Egypt default +20 if starts with 01)
    clean_phone = req.phone.replace(" ", "").replace("-", "").replace("+", "")
    if clean_phone.startswith("01"):
        clean_phone = "2" + clean_phone
    elif not clean_phone.startswith("20") and len(clean_phone) == 11 and clean_phone.startswith("0"):
        clean_phone = "2" + clean_phone
    
    encoded_text = urllib.parse.quote(req.message)
    wa_url = f"https://wa.me/{clean_phone}?text={encoded_text}"
    return {"url": wa_url, "phone": clean_phone, "encoded_message": encoded_text}


# --- Industrial Laser Cutting Calculator Engine ---

@app.post("/api/calculator/estimate")
def calculate_laser(req: CalculatorRequest):
    """
    Industrial Laser Cutting Calculation Model:
    - Calculates cutting time based on material, thickness, cutting length.
    - Laser piercing cost and time.
    - Assist gas cost based on gas type and cutting time.
    - Material sheet fraction cost.
    - Total cost, suggested selling price, and profit margin.
    """
    # 1. Base cutting speed (meters per minute) heuristic based on laser wattage (e.g. 3kW/6kW standard fiber laser)
    # Thicker material cuts slower:
    t = max(0.5, req.thickness_mm)
    base_speed_m_per_min = 25.0 / (t ** 1.15)
    
    # Gas & Material adjustments
    if "استانلس" in req.material_type or "نحاس" in req.material_type:
        base_speed_m_per_min *= 0.85
    elif "ألومنيوم" in req.material_type:
        base_speed_m_per_min *= 0.90

    # Piercing time (seconds per pierce) increases with thickness
    pierce_time_sec = 0.2 + (t * 0.18)
    total_pierce_time_sec = req.pierce_count * pierce_time_sec
    
    cutting_time_min = (req.cutting_length_meters / max(0.5, base_speed_m_per_min)) + (total_pierce_time_sec / 60.0)
    
    # 2. Hourly Machine & Operation Rate (Egyptian Market Standard ~ 400 to 750 EGP/hour)
    machine_hourly_rate = 550.0 # EGP per hour
    laser_cutting_cost = (cutting_time_min / 60.0) * machine_hourly_rate

    # 3. Gas Consumption Cost per minute:
    if "نيتروجين" in req.gas_type or "N2" in req.gas_type:
        gas_cost_per_min = 6.5 # High pressure N2 is costly
    elif "أكسجين" in req.gas_type or "O2" in req.gas_type:
        gas_cost_per_min = 2.5
    else: # Compressed Air
        gas_cost_per_min = 0.8

    gas_cost = cutting_time_min * gas_cost_per_min
    total_laser_op_cost = laser_cutting_cost + gas_cost

    # 4. Material Cost:
    # If sheet_price_total and fraction provided, use that.
    # Otherwise estimate by weight (Standard sheet 1.22m x 2.44m = 2.9768 m2)
    # Density: Steel = 7.85 kg/m2/mm, Stainless = 8.0, Alu = 2.7
    density_factor = 7.85
    if "استانلس" in req.material_type:
        density_factor = 8.0
        price_per_kg = 185.0
    elif "ألومنيوم" in req.material_type:
        density_factor = 2.7
        price_per_kg = 195.0
    elif "مجلفن" in req.material_type:
        density_factor = 7.85
        price_per_kg = 75.0
    else: # Steel
        density_factor = 7.85
        price_per_kg = 65.0

    if req.sheet_fraction > 0 and req.sheet_price_total > 0:
        material_cost = req.sheet_fraction * req.sheet_price_total
    elif req.sheet_fraction > 0:
        # Standard sheet 1.25x2.50m (3.125 m2)
        sheet_weight_kg = 3.125 * t * density_factor
        sheet_price = sheet_weight_kg * price_per_kg
        material_cost = req.sheet_fraction * sheet_price
    else:
        # Default rough material cost from cut length (rough footprint estimate)
        approx_weight_kg = (req.cutting_length_meters * 0.05) * t * density_factor
        material_cost = max(50.0, approx_weight_kg * price_per_kg)

    # 5. Piercing consumable wear cost (~ 0.40 EGP per pierce)
    pierce_cost = req.pierce_count * 0.45

    # Total Manufacturing Cost
    total_cost = round(material_cost + total_laser_op_cost + pierce_cost + req.extra_cost, 2)
    
    # Target selling price based on margin %
    margin = max(5.0, min(80.0, req.profit_margin_percent)) / 100.0
    # Price = Cost / (1 - Margin)
    selling_price = round(total_cost / (1.0 - margin), 2)
    net_profit = round(selling_price - total_cost, 2)

    return {
        "estimated_time_min": round(cutting_time_min, 1),
        "cutting_speed_m_min": round(base_speed_m_per_min, 1),
        "laser_cutting_cost": round(laser_cutting_cost, 2),
        "gas_cost": round(gas_cost, 2),
        "pierce_cost": round(pierce_cost, 2),
        "material_cost": round(material_cost, 2),
        "extra_cost": round(req.extra_cost, 2),
        "total_cost": total_cost,
        "recommended_price": selling_price,
        "net_profit": net_profit,
        "profit_margin_percent": round((net_profit / selling_price) * 100, 1) if selling_price else 0
    }


# Serve static web frontend
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_index():
    return FileResponse("static/index.html")

@app.get("/guide")
@app.get("/guide.html")
def serve_guide():
    return FileResponse("static/guide.html")

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse("static/manifest.json")

@app.get("/sw.js")
def serve_sw():
    return FileResponse("static/sw.js", media_type="application/javascript")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
