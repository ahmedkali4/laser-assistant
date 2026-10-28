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

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="المساعد الشخصي لمهندس الليزر", version="1.0.0")

# Ensure DB initialized on start without crashing serverless boots
try:
    database.init_db()
except Exception as e:
    print("Startup DB init note:", e)


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
    sheet_weight_kg: float = 0.0
    material_cost: float = 0.0
    cutting_cost: float = 0.0
    extra_cost: float = 0.0
    design_fee: float = 0.0
    is_rush: int = 0
    total_cost: float = 0.0
    client_price: float = 0.0
    paid_amount: float = 0.0
    remaining_amount: float = 0.0
    net_profit: float = 0.0
    status: str = "design"
    deadline: str = ""
    cad_file_name: str = ""
    notes: str = ""

class StatusUpdate(BaseModel):
    status: str

class PaymentUpdate(BaseModel):
    paid_amount: float

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
    extra_cost: float = 0.0 # bending, painting, etc.
    design_fee: float = 0.0 # أتعاب التصميم والـ CAD
    is_rush: bool = False # طلب مستعجل طارئ
    profit_margin_percent: float = 35.0 # target profit margin %
    # Weight Calc helpers
    sheet_length_mm: float = 0.0
    sheet_width_mm: float = 0.0

class SettingsUpdate(BaseModel):
    workshop_name: str = "ورشة الليزر"
    engineer_name: str = "مهندس التصميم الصناعي"
    engineer_phone: str = ""
    laser_hourly_rate: float = 550.0
    oxygen_cost_per_min: float = 2.5
    nitrogen_cost_per_min: float = 6.5
    air_cost_per_min: float = 0.8
    pierce_cost_unit: float = 0.45
    rush_fee_percent: float = 25.0

class MaterialPriceUpdate(BaseModel):
    price_per_kg: float
    density: float
    default_gas: str


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
        COALESCE(SUM(paid_amount), 0) as total_paid,
        COALESCE(SUM(remaining_amount), 0) as total_remaining_debt,
        (SELECT COUNT(*) FROM clients) as total_clients
    FROM projects;
    """
    batch_results = database.execute_batch([
        stats_query,
        "SELECT * FROM projects ORDER BY id DESC;",
        "SELECT * FROM clients ORDER BY id DESC;",
        "SELECT * FROM whatsapp_templates ORDER BY id ASC;",
        "SELECT * FROM app_settings WHERE id = 1;",
        "SELECT * FROM materials_config ORDER BY id ASC;"
    ])

    stats_row = batch_results[0]["rows"][0] if batch_results and batch_results[0]["rows"] else {}
    projects_rows = batch_results[1]["rows"] if len(batch_results) > 1 else []
    clients_rows = batch_results[2]["rows"] if len(batch_results) > 2 else []
    templates_rows = batch_results[3]["rows"] if len(batch_results) > 3 else []
    settings_row = batch_results[4]["rows"][0] if len(batch_results) > 4 and batch_results[4]["rows"] else {
        "workshop_name": "المساعد الشخصي لقص المعادن بالليزر",
        "engineer_name": "مهندس التصميم الصناعي",
        "laser_hourly_rate": 550.0,
        "oxygen_cost_per_min": 2.5,
        "nitrogen_cost_per_min": 6.5,
        "air_cost_per_min": 0.8,
        "pierce_cost_unit": 0.45,
        "rush_fee_percent": 25.0
    }
    materials_rows = batch_results[5]["rows"] if len(batch_results) > 5 else []

    return {
        "stats": stats_row,
        "projects": projects_rows,
        "clients": clients_rows,
        "templates": templates_rows,
        "settings": settings_row,
        "materials": materials_rows
    }


@app.get("/api/settings")
def get_settings():
    set_res = database.execute("SELECT * FROM app_settings WHERE id = 1;")
    mat_res = database.execute("SELECT * FROM materials_config ORDER BY id ASC;")
    settings = set_res["rows"][0] if set_res["rows"] else {}
    return {"settings": settings, "materials": mat_res["rows"]}


@app.put("/api/settings")
def update_settings(s: SettingsUpdate):
    sql = """
    UPDATE app_settings SET
        workshop_name = ?, engineer_name = ?, engineer_phone = ?,
        laser_hourly_rate = ?, oxygen_cost_per_min = ?, nitrogen_cost_per_min = ?,
        air_cost_per_min = ?, pierce_cost_unit = ?, rush_fee_percent = ?
    WHERE id = 1;
    """
    params = [
        s.workshop_name, s.engineer_name, s.engineer_phone,
        s.laser_hourly_rate, s.oxygen_cost_per_min, s.nitrogen_cost_per_min,
        s.air_cost_per_min, s.pierce_cost_unit, s.rush_fee_percent
    ]
    database.execute(sql, params)
    return {"message": "تم تحديث إعدادات التسعير بنجاح في Turso"}


@app.put("/api/settings/materials/{mat_id}")
def update_material(mat_id: int, m: MaterialPriceUpdate):
    database.execute(
        "UPDATE materials_config SET price_per_kg = ?, density = ?, default_gas = ? WHERE id = ?;",
        [m.price_per_kg, m.density, m.default_gas, mat_id]
    )
    return {"message": "تم تحديث سعر الخامة بنجاح"}


@app.patch("/api/projects/{project_id}/payment")
def record_project_payment(project_id: int, p: PaymentUpdate):
    # Fetch current price
    res = database.execute("SELECT client_price FROM projects WHERE id = ?;", [project_id])
    if not res["rows"]:
        raise HTTPException(status_code=404, detail="المشروع غير موجود")
    client_price = res["rows"][0]["client_price"] or 0.0
    paid = max(0.0, p.paid_amount)
    remaining = max(0.0, client_price - paid)
    database.execute(
        "UPDATE projects SET paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;",
        [paid, remaining, project_id]
    )
    return {"message": "تم تسجيل الدفعة بنجاح", "paid_amount": paid, "remaining_amount": remaining}


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
        COALESCE(SUM(paid_amount), 0) as total_paid,
        COALESCE(SUM(remaining_amount), 0) as total_remaining_debt,
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
        item.net_profit = (item.client_price - item.total_cost) + item.design_fee
    if item.remaining_amount == 0.0 and item.client_price > 0:
        item.remaining_amount = max(0.0, item.client_price - item.paid_amount)

    sql = """
    INSERT INTO projects (
        title, project_type, client_id, client_name, client_phone, manager_name,
        material_type, thickness_mm, cutting_length_meters, pierce_count, gas_type,
        estimated_time_min, sheet_fraction, sheet_weight_kg, material_cost, cutting_cost,
        extra_cost, design_fee, is_rush, total_cost, client_price, paid_amount,
        remaining_amount, net_profit, status, deadline, cad_file_name, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """
    params = [
        item.title, item.project_type, item.client_id, item.client_name, item.client_phone,
        item.manager_name, item.material_type, item.thickness_mm, item.cutting_length_meters,
        item.pierce_count, item.gas_type, item.estimated_time_min, item.sheet_fraction,
        item.sheet_weight_kg, item.material_cost, item.cutting_cost, item.extra_cost,
        item.design_fee, item.is_rush, item.total_cost, item.client_price, item.paid_amount,
        item.remaining_amount, item.net_profit, item.status, item.deadline, item.cad_file_name,
        item.notes
    ]
    res = database.execute(sql, params)
    return {"message": "تم إضافة المشروع بنجاح", "id": res["last_id"]}


@app.put("/api/projects/{project_id}")
def update_project(project_id: int, item: ProjectCreate):
    if item.total_cost == 0.0:
        item.total_cost = item.material_cost + item.cutting_cost + item.extra_cost
    item.net_profit = (item.client_price - item.total_cost) + item.design_fee
    item.remaining_amount = max(0.0, item.client_price - item.paid_amount)

    sql = """
    UPDATE projects SET
        title = ?, project_type = ?, client_id = ?, client_name = ?, client_phone = ?,
        manager_name = ?, material_type = ?, thickness_mm = ?, cutting_length_meters = ?,
        pierce_count = ?, gas_type = ?, estimated_time_min = ?, sheet_fraction = ?,
        sheet_weight_kg = ?, material_cost = ?, cutting_cost = ?, extra_cost = ?,
        design_fee = ?, is_rush = ?, total_cost = ?, client_price = ?, paid_amount = ?,
        remaining_amount = ?, net_profit = ?, status = ?, deadline = ?, cad_file_name = ?,
        notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
    """
    params = [
        item.title, item.project_type, item.client_id, item.client_name, item.client_phone,
        item.manager_name, item.material_type, item.thickness_mm, item.cutting_length_meters,
        item.pierce_count, item.gas_type, item.estimated_time_min, item.sheet_fraction,
        item.sheet_weight_kg, item.material_cost, item.cutting_cost, item.extra_cost,
        item.design_fee, item.is_rush, item.total_cost, item.client_price, item.paid_amount,
        item.remaining_amount, item.net_profit, item.status, item.deadline, item.cad_file_name,
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
    - Reads dynamic machine hourly rates, gas costs, and piercing costs from app_settings.
    - Reads material density and price per kg from materials_config.
    - Calculates cutting time based on material, thickness, and cutting length.
    - Calculates sheet weight and material cost.
    - Adds engineering CAD design fee.
    - Applies rush order surcharge if requested.
    - Calculates total cost, suggested selling price, and engineer's net profit.
    """
    # 1. Fetch current settings from database
    try:
        set_res = database.execute("SELECT * FROM app_settings WHERE id = 1;")
        settings = set_res["rows"][0] if set_res["rows"] else {}
    except Exception:
        settings = {}

    laser_hourly_rate = float(settings.get("laser_hourly_rate") or 550.0)
    oxygen_cost_per_min = float(settings.get("oxygen_cost_per_min") or 2.5)
    nitrogen_cost_per_min = float(settings.get("nitrogen_cost_per_min") or 6.5)
    air_cost_per_min = float(settings.get("air_cost_per_min") or 0.8)
    pierce_cost_unit = float(settings.get("pierce_cost_unit") or 0.45)
    rush_fee_percent = float(settings.get("rush_fee_percent") or 25.0)

    # 2. Fetch material config matching req.material_type
    density_factor = 7.85
    price_per_kg = 65.0
    try:
        mat_res = database.execute("SELECT * FROM materials_config WHERE name LIKE ? LIMIT 1;", [f"%{req.material_type}%"])
        if mat_res["rows"]:
            m_row = mat_res["rows"][0]
            density_factor = float(m_row.get("density") or 7.85)
            price_per_kg = float(m_row.get("price_per_kg") or 65.0)
        else:
            # Fallback heuristics
            if "استانلس" in req.material_type:
                density_factor = 8.0
                price_per_kg = 195.0
            elif "ألومنيوم" in req.material_type:
                density_factor = 2.7
                price_per_kg = 190.0
            elif "مجلفن" in req.material_type:
                density_factor = 7.85
                price_per_kg = 75.0
            elif "نحاس" in req.material_type:
                density_factor = 8.9
                price_per_kg = 380.0
            else:
                density_factor = 7.85
                price_per_kg = 65.0
    except Exception:
        pass

    # 3. Base cutting speed (meters per minute) heuristic
    t = max(0.5, req.thickness_mm)
    base_speed_m_per_min = 25.0 / (t ** 1.15)
    if "استانلس" in req.material_type or "نحاس" in req.material_type:
        base_speed_m_per_min *= 0.85
    elif "ألومنيوم" in req.material_type:
        base_speed_m_per_min *= 0.90

    # Piercing time (seconds per pierce) increases with thickness
    pierce_time_sec = 0.2 + (t * 0.18)
    total_pierce_time_sec = req.pierce_count * pierce_time_sec
    cutting_time_min = (req.cutting_length_meters / max(0.5, base_speed_m_per_min)) + (total_pierce_time_sec / 60.0)

    # 4. Machine operation cost
    laser_cutting_cost = (cutting_time_min / 60.0) * laser_hourly_rate

    # 5. Gas Consumption Cost per minute:
    if "نيتروجين" in req.gas_type or "N2" in req.gas_type:
        gas_cost_per_min = nitrogen_cost_per_min
    elif "أكسجين" in req.gas_type or "O2" in req.gas_type:
        gas_cost_per_min = oxygen_cost_per_min
    else: # Compressed Air
        gas_cost_per_min = air_cost_per_min

    gas_cost = cutting_time_min * gas_cost_per_min
    total_laser_op_cost = laser_cutting_cost + gas_cost

    # 6. Piercing consumable wear cost
    pierce_cost = req.pierce_count * pierce_cost_unit

    # 7. Material Weight and Cost Calculation:
    # Standard sheet metal formula: Weight (kg) = Area (m2) * Thickness (mm) * Density (kg/m2/mm)
    calculated_weight_kg = 0.0
    if req.sheet_length_mm > 0 and req.sheet_width_mm > 0:
        area_m2 = (req.sheet_length_mm / 1000.0) * (req.sheet_width_mm / 1000.0)
        calculated_weight_kg = round(area_m2 * t * density_factor, 2)
        material_cost = round(calculated_weight_kg * price_per_kg, 2)
    elif req.sheet_fraction > 0:
        # Standard sheet 1.25m x 2.50m (3.125 m2)
        total_sheet_weight = 3.125 * t * density_factor
        calculated_weight_kg = round(req.sheet_fraction * total_sheet_weight, 2)
        material_cost = round(calculated_weight_kg * price_per_kg, 2)
    else:
        # Default rough footprint estimate from cut length
        approx_weight_kg = (req.cutting_length_meters * 0.05) * t * density_factor
        calculated_weight_kg = round(approx_weight_kg, 2)
        material_cost = round(max(50.0, calculated_weight_kg * price_per_kg), 2)

    # Total Base Production Manufacturing Cost
    base_production_cost = round(material_cost + total_laser_op_cost + pierce_cost + req.extra_cost, 2)

    # 8. Target selling price based on profit margin %
    margin = max(5.0, min(80.0, req.profit_margin_percent)) / 100.0
    base_product_price = base_production_cost / (1.0 - margin)

    # Add Engineering / CAD Design Fee
    design_fee = max(0.0, req.design_fee)
    price_before_rush = base_product_price + design_fee

    # 9. Rush order surcharge
    rush_surcharge = 0.0
    if req.is_rush:
        rush_surcharge = round(price_before_rush * (rush_fee_percent / 100.0), 2)

    final_selling_price = round(price_before_rush + rush_surcharge, 2)
    net_profit = round(final_selling_price - base_production_cost, 2)

    return {
        "estimated_time_min": round(cutting_time_min, 1),
        "cutting_speed_m_min": round(base_speed_m_per_min, 1),
        "laser_cutting_cost": round(laser_cutting_cost, 2),
        "gas_cost": round(gas_cost, 2),
        "pierce_cost": round(pierce_cost, 2),
        "material_cost": round(material_cost, 2),
        "sheet_weight_kg": round(calculated_weight_kg, 2),
        "price_per_kg": round(price_per_kg, 2),
        "density": round(density_factor, 2),
        "extra_cost": round(req.extra_cost, 2),
        "design_fee": round(design_fee, 2),
        "is_rush": bool(req.is_rush),
        "rush_surcharge": round(rush_surcharge, 2),
        "total_cost": base_production_cost,
        "recommended_price": final_selling_price,
        "net_profit": net_profit,
        "profit_margin_percent": round((net_profit / final_selling_price) * 100, 1) if final_selling_price else 0
    }


# Serve static web frontend
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Laser Assistant API is running"}

@app.get("/guide")
@app.get("/guide.html")
def serve_guide():
    guide_path = os.path.join(STATIC_DIR, "guide.html")
    if os.path.exists(guide_path):
        return FileResponse(guide_path)
    return {"message": "Guide is available in the main app"}

@app.get("/manifest.json")
def serve_manifest():
    p = os.path.join(STATIC_DIR, "manifest.json")
    return FileResponse(p) if os.path.exists(p) else {}

@app.get("/sw.js")
def serve_sw():
    p = os.path.join(STATIC_DIR, "sw.js")
    return FileResponse(p, media_type="application/javascript") if os.path.exists(p) else {}



if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
