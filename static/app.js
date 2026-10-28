// State Management
let currentTab = 'dashboard';
let currentFilterType = 'all'; // 'all', 'company', 'personal'
let isPrivateUnlocked = false;
let hideProfits = false;

let projectsData = [];
let clientsData = [];
let templatesData = [];
let settingsData = {};
let materialsData = [];

let activeInvoiceProject = null;
let activePaymentProjectId = null;
let calcResultCache = null;

const DEFAULT_PIN = "1234";

// Lifecycle: Run on page load
document.addEventListener('DOMContentLoaded', () => {
  try { loadSavedTheme(); } catch (e) {}
  try { initLucide(); } catch (e) {}
  try { loadAllData(); } catch (e) {}
  try { runLiveCalculator(); } catch (e) {}
});

// Theme Management
function loadSavedTheme() {
  const saved = localStorage.getItem('laser_assistant_theme') || 'emerald';
  applyTheme(saved);
}

function openThemeModal() {
  const modal = document.getElementById('modal-theme');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeThemeModal() {
  const modal = document.getElementById('modal-theme');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function selectTheme(themeName) {
  applyTheme(themeName);
  localStorage.setItem('laser_assistant_theme', themeName);
  closeThemeModal();
  const themeLabels = {
    emerald: 'ليزر الزمرد (الأخضر الكلاسيكي)',
    cyan: 'بلازما زرقاء (Cyber Plasma)',
    amber: 'صهر المعادن والذهب (Molten Amber)',
    purple: 'غاز النيتروجين (Nitrogen Neon)',
    light: 'وضع الورشة النهاري (Daylight Mode ☀️)'
  };
  showToast(`تم تفعيل: ${themeLabels[themeName] || themeName}`);
}

function applyTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
}

function initLucide() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons();
    } catch (e) {
      console.warn(e);
    }
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  if (!toast || !toastText) return;
  toastText.innerText = message;
  toast.className = `fixed top-5 left-1/2 -translate-x-1/2 z-50 ${isError ? 'bg-red-600' : 'bg-emerald-600'} text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-bold transition-all duration-300 opacity-100 flex items-center gap-2 pointer-events-auto`;
  setTimeout(() => {
    toast.className = toast.className.replace('opacity-100', 'opacity-0').replace('pointer-events-auto', 'pointer-events-none');
  }, 3000);
}

// Data Fetching
async function loadAllData() {
  try {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) throw new Error('فشل تحميل البيانات من السيرفر');
    const data = await res.json();

    // Populate state
    projectsData = data.projects || [];
    clientsData = data.clients || [];
    templatesData = data.templates || [];
    settingsData = data.settings || {};
    materialsData = data.materials || [];

    // Render Stats
    const stats = data.stats || {};
    const elActive = document.getElementById('stat-active-projects');
    if (elActive) elActive.innerText = stats.active_projects || 0;
    
    const elReady = document.getElementById('stat-ready-projects');
    if (elReady) elReady.innerText = stats.ready_projects || 0;
    
    const elDelivered = document.getElementById('stat-delivered-projects');
    if (elDelivered) elDelivered.innerText = stats.delivered_projects || 0;
    
    const elPaid = document.getElementById('stat-total-paid');
    if (elPaid) elPaid.innerText = (stats.total_paid || 0).toLocaleString() + ' ج.م';
    
    const elDebt = document.getElementById('stat-total-debt');
    if (elDebt) elDebt.innerText = (stats.total_remaining_debt || 0).toLocaleString() + ' ج.م';
    
    const elClients = document.getElementById('stat-total-clients');
    if (elClients) elClients.innerText = stats.total_clients || 0;
    
    renderProfitsDisplay(stats.total_profit, stats.personal_profit);

    // Render Views
    renderDashboardUrgent();
    renderProjectsList();
    renderClientsList();
    renderSettingsView();
    populateContactDropdowns();
    populateTemplatesDropdown();
  } catch (err) {
    console.error('Error fetching data:', err);
    const urgentEl = document.getElementById('dashboard-urgent-list');
    if (urgentEl) {
      urgentEl.innerHTML = `
        <div class="text-center py-6 text-red-400 text-xs">
          تعذر الاتصال بالسيرفر السحابي، تأكد من تشغيل start_app.bat أو أعد تحميل الصفحة.
        </div>
      `;
    }
  }
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('Failed to load stats');
    const data = await res.json();
    
    const elActive = document.getElementById('stat-active-projects');
    if (elActive) elActive.innerText = data.active_projects || 0;
    
    const elReady = document.getElementById('stat-ready-projects');
    if (elReady) elReady.innerText = data.ready_projects || 0;
    
    const elDelivered = document.getElementById('stat-delivered-projects');
    if (elDelivered) elDelivered.innerText = data.delivered_projects || 0;
    
    const elPaid = document.getElementById('stat-total-paid');
    if (elPaid) elPaid.innerText = (data.total_paid || 0).toLocaleString() + ' ج.م';
    
    const elDebt = document.getElementById('stat-total-debt');
    if (elDebt) elDebt.innerText = (data.total_remaining_debt || 0).toLocaleString() + ' ج.م';
    
    const elClients = document.getElementById('stat-total-clients');
    if (elClients) elClients.innerText = data.total_clients || 0;

    renderProfitsDisplay(data.total_profit, data.personal_profit);
  } catch (e) {
    console.error(e);
  }
}

function renderProfitsDisplay(totalProfit, personalProfit) {
  const profitEl = document.getElementById('stat-total-profit');
  const personalProfitEl = document.getElementById('stat-personal-profit');
  if (!profitEl || !personalProfitEl) return;

  if (hideProfits) {
    profitEl.innerText = '••••••';
    personalProfitEl.innerText = '••••••';
  } else {
    profitEl.innerText = (totalProfit || 0).toLocaleString() + ' ج.م';
    personalProfitEl.innerText = (personalProfit || 0).toLocaleString() + ' ج.م';
  }
}

function toggleProfitPrivacy() {
  hideProfits = !hideProfits;
  fetchStats();
  renderProjectsList();
  showToast(hideProfits ? 'تم إخفاء أرقام الأرباح' : 'تم إظهار أرقام الأرباح');
}

// Navigation & Tab Switching
function switchTab(tabId) {
  currentTab = tabId;
  const tabs = ['dashboard', 'projects', 'calculator', 'settings', 'clients', 'whatsapp'];
  
  tabs.forEach(t => {
    const section = document.getElementById(`tab-${t}`);
    const navBtn = document.getElementById(`nav-${t}`);
    const mNavBtn = document.getElementById(`m-nav-${t}`);

    if (t === tabId) {
      if (section) section.classList.remove('hidden');
      if (navBtn) {
        navBtn.className = 'tab-btn flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 transition-all';
      }
      if (mNavBtn) {
        mNavBtn.className = 'flex flex-col items-center justify-center py-1 text-emerald-400';
      }
    } else {
      if (section) section.classList.add('hidden');
      if (navBtn) {
        navBtn.className = 'tab-btn flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-slate-400 hover:text-slate-200 hover:bg-metal-800/60 transition-all';
      }
      if (mNavBtn) {
        mNavBtn.className = 'flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-200';
      }
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
  initLucide();
}

// Filter Modes: All / Factory / Personal
function setFilterType(type) {
  currentFilterType = type;
  updateFilterButtonsUI();
  renderProjectsList();
  renderDashboardUrgent();
}

function updateFilterButtonsUI() {
  const modes = ['all', 'company', 'personal'];
  modes.forEach(m => {
    const btn = document.getElementById(`btn-mode-${m}`);
    const mBtn = document.getElementById(`m-btn-mode-${m}`);
    const isActive = (currentFilterType === m);

    if (btn) {
      if (isActive) {
        btn.classList.add('bg-metal-700', 'text-white');
        btn.classList.remove('text-slate-300');
      } else {
        btn.classList.remove('bg-metal-700', 'text-white');
        btn.classList.add('text-slate-300');
      }
    }

    if (mBtn) {
      if (isActive) {
        mBtn.className = 'px-2.5 py-1 rounded-lg bg-metal-700 text-white font-bold';
      } else {
        mBtn.className = 'px-2.5 py-1 rounded-lg text-slate-400';
      }
    }
  });
}

function togglePrivateMode() {
  if (isPrivateUnlocked) {
    setFilterType('personal');
  } else {
    document.getElementById('modal-pin').classList.remove('hidden');
    document.getElementById('modal-pin').classList.add('flex');
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input').focus();
  }
}

function verifyPin() {
  const pin = document.getElementById('pin-input').value;
  if (pin === DEFAULT_PIN) {
    isPrivateUnlocked = true;
    closePinModal();
    showToast('تم فتح قفل المشروعات الخاصة 🔓');
    setFilterType('personal');
    
    const lockIcon = document.getElementById('private-lock-icon');
    if (lockIcon) {
      lockIcon.setAttribute('data-lucide', 'unlock');
      initLucide();
    }
  } else {
    showToast('رمز PIN غير صحيح', true);
  }
}

function closePinModal() {
  document.getElementById('modal-pin').classList.add('hidden');
  document.getElementById('modal-pin').classList.remove('flex');
}

// Render Dashboard Urgent Projects
function renderDashboardUrgent() {
  const container = document.getElementById('dashboard-urgent-list');
  if (!container) return;

  let list = projectsData.filter(p => p.status !== 'delivered');

  if (currentFilterType === 'personal' && isPrivateUnlocked) {
    list = list.filter(p => p.project_type === 'personal');
  } else if (currentFilterType === 'company') {
    list = list.filter(p => p.project_type === 'company');
  } else if (!isPrivateUnlocked) {
    list = list.filter(p => p.project_type !== 'personal');
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs">
        لا توجد مشروعات نشطة قيد التنفيذ حالياً.
      </div>
    `;
    return;
  }

  container.innerHTML = list.slice(0, 5).map(p => {
    const statusInfo = getStatusInfo(p.status);
    const isPersonal = p.project_type === 'personal';
    const profitDisplay = hideProfits ? '••••' : (p.net_profit || 0).toLocaleString() + ' ج.م';
    const remainingVal = (p.remaining_amount !== undefined && p.remaining_amount !== null) ? p.remaining_amount : Math.max(0, (p.client_price || 0) - (p.paid_amount || 0));

    return `
      <div class="p-3 bg-metal-850/80 hover:bg-metal-800 rounded-xl border border-metal-800 transition-all flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-2.5 h-10 rounded-full ${statusInfo.barColor}"></div>
          <div>
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-bold text-white">${escapeHtml(p.title)}</h4>
              <span class="text-[10px] px-1.5 py-0.5 rounded ${isPersonal ? 'bg-amber-500/10 text-amber-400' : 'bg-cyan-500/10 text-cyan-400'}">${isPersonal ? 'خاص' : 'مصنع'}</span>
              ${p.is_rush ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">⚡ طارئ</span>' : ''}
            </div>
            <div class="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <span>${escapeHtml(p.client_name || 'عميل غير محدد')}</span>
              <span>•</span>
              <span class="text-slate-300 font-medium">${escapeHtml(p.material_type)} ${p.thickness_mm} مم</span>
              ${p.deadline ? `<span>•</span><span class="text-amber-400">تسليم: ${escapeHtml(p.deadline)}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-metal-800">
          <div class="text-left">
            <span class="text-[10px] text-slate-400 block">${remainingVal > 0 ? 'متبقي بالسوق:' : 'السعر:'}</span>
            <span class="text-xs font-bold ${remainingVal > 0 ? 'text-amber-400' : 'text-emerald-400'}">${remainingVal > 0 ? remainingVal.toLocaleString() + ' ج.م' : (p.client_price || 0).toLocaleString() + ' ج.م'}</span>
          </div>
          <span class="text-xs px-2.5 py-1 rounded-lg font-semibold ${statusInfo.badgeClass}">
            ${statusInfo.label}
          </span>
          <button onclick="advanceProjectStatus(${p.id})" title="تقديم للمرحلة التالية" class="p-1.5 bg-metal-800 hover:bg-metal-700 text-emerald-400 rounded-lg">
            <i data-lucide="arrow-left" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

// Render Projects List
function renderProjectsList() {
  const container = document.getElementById('projects-grid');
  if (!container) return;

  const statusFilter = document.getElementById('project-status-filter') ? document.getElementById('project-status-filter').value : 'all';
  const search = document.getElementById('project-search') ? document.getElementById('project-search').value.toLowerCase().trim() : '';

  let filtered = projectsData;

  // Filter by Type
  if (currentFilterType === 'company') {
    filtered = filtered.filter(p => p.project_type === 'company');
  } else if (currentFilterType === 'personal') {
    if (!isPrivateUnlocked) {
      filtered = [];
    } else {
      filtered = filtered.filter(p => p.project_type === 'personal');
    }
  } else {
    if (!isPrivateUnlocked) {
      filtered = filtered.filter(p => p.project_type !== 'personal');
    }
  }

  // Filter by Status
  if (statusFilter !== 'all') {
    filtered = filtered.filter(p => p.status === statusFilter);
  }

  // Filter by Search
  if (search) {
    filtered = filtered.filter(p => 
      (p.title && p.title.toLowerCase().includes(search)) ||
      (p.client_name && p.client_name.toLowerCase().includes(search)) ||
      (p.cad_file_name && p.cad_file_name.toLowerCase().includes(search)) ||
      (p.notes && p.notes.toLowerCase().includes(search))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-12 text-slate-500 bg-metal-900 border border-metal-800 rounded-2xl">
        <i data-lucide="folder-search" class="w-10 h-10 mx-auto text-slate-600 mb-2"></i>
        لا توجد مشروعات مطابقة لمعايير البحث
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = filtered.map(p => {
    const statusInfo = getStatusInfo(p.status);
    const isPersonal = p.project_type === 'personal';
    const profitDisplay = hideProfits ? '••••••' : (p.net_profit || 0).toLocaleString() + ' ج.م';
    const priceDisplay = (p.client_price || 0).toLocaleString() + ' ج.م';
    const paidVal = p.paid_amount || 0;
    const remainingVal = (p.remaining_amount !== undefined && p.remaining_amount !== null) ? p.remaining_amount : Math.max(0, (p.client_price || 0) - paidVal);

    return `
      <div class="bg-metal-900 border border-metal-800 hover:border-metal-700/90 rounded-2xl p-4 md:p-5 shadow-lg flex flex-col justify-between space-y-4 transition-all group">
        
        <!-- Header -->
        <div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white group-hover:text-emerald-400 transition-colors">${escapeHtml(p.title)}</h3>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isPersonal ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'}">
                  ${isPersonal ? '🔒 خاص' : '🏢 عمل المصنع'}
                </span>
                ${p.is_rush ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">⚡ طارئ</span>' : ''}
              </div>
              <p class="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                <i data-lucide="user" class="w-3.5 h-3.5"></i>
                <span class="font-medium text-slate-300">${escapeHtml(p.client_name || 'عميل غير مسجل')}</span>
                ${p.client_phone ? `<span class="text-slate-500 font-mono">(${escapeHtml(p.client_phone)})</span>` : ''}
                ${p.manager_name ? `<span class="text-slate-400">• بإشراف: ${escapeHtml(p.manager_name)}</span>` : ''}
              </p>
            </div>

            <!-- Status Badge -->
            <span class="text-xs px-2.5 py-1 rounded-xl font-bold whitespace-nowrap ${statusInfo.badgeClass}">
              ${statusInfo.label}
            </span>
          </div>

          <!-- Specs pills -->
          <div class="flex flex-wrap items-center gap-1.5 mt-3 text-[11px]">
            <span class="bg-metal-800 text-slate-300 px-2 py-1 rounded-lg border border-metal-700 flex items-center gap-1">
              <i data-lucide="box" class="w-3 h-3 text-emerald-400"></i>
              ${escapeHtml(p.material_type)} ${p.thickness_mm} مم
            </span>
            ${p.sheet_weight_kg ? `
              <span class="bg-metal-800 text-amber-300 px-2 py-1 rounded-lg border border-metal-700">
                ⚖️ ${p.sheet_weight_kg} كجم
              </span>
            ` : ''}
            ${p.cutting_length_meters ? `
              <span class="bg-metal-800 text-slate-300 px-2 py-1 rounded-lg border border-metal-700">
                ${p.cutting_length_meters} م قطع
              </span>
            ` : ''}
            ${p.pierce_count ? `
              <span class="bg-metal-800 text-slate-300 px-2 py-1 rounded-lg border border-metal-700">
                ${p.pierce_count} ثقب
              </span>
            ` : ''}
            ${p.design_fee ? `
              <span class="bg-cyan-500/10 text-cyan-400 px-2 py-1 rounded-lg border border-cyan-500/20">
                ✏️ أتعاب CAD: ${p.design_fee} ج.م
              </span>
            ` : ''}
            ${p.cad_file_name ? `
              <span class="bg-metal-800 text-cyan-400 px-2 py-1 rounded-lg border border-metal-700 flex items-center gap-1" title="ملف التصميم">
                <i data-lucide="file-code" class="w-3 h-3"></i>
                ${escapeHtml(p.cad_file_name)}
              </span>
            ` : ''}
          </div>

          <!-- Workflow Visual Timeline -->
          <div class="mt-3.5 pt-3 border-t border-metal-800">
            <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
              <span>تصميم</span>
              <span>تعشيق</span>
              <span>تقطيع</span>
              <span>تشطيب</span>
              <span>جاهز</span>
              <span>تسليم</span>
            </div>
            <div class="w-full bg-metal-800 h-2 rounded-full overflow-hidden flex">
              <div class="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all duration-500" style="width: ${statusInfo.percentage}%"></div>
            </div>
          </div>

          <!-- Financial Row -->
          <div class="mt-3 bg-metal-950/70 p-2.5 rounded-xl border border-metal-800 space-y-2 text-xs">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-slate-500 text-[10px] block">السعر المطلوب:</span>
                <span class="font-bold text-white">${priceDisplay}</span>
              </div>
              <div>
                <span class="text-slate-500 text-[10px] block">التكلفة:</span>
                <span class="text-slate-300">${(p.total_cost || 0).toLocaleString()} ج.م</span>
              </div>
              <div class="text-left">
                <span class="text-slate-500 text-[10px] block">صافي ربحك:</span>
                <span class="font-black text-emerald-400">${profitDisplay}</span>
              </div>
            </div>

            <!-- Payment & Remaining Status -->
            <div class="pt-2 border-t border-metal-800 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-slate-400 text-[11px]">المدفوع: <strong class="text-teal-300 font-mono">${paidVal.toLocaleString()} ج.م</strong></span>
                <span class="text-slate-500">•</span>
                <span class="text-slate-400 text-[11px]">المتبقي: <strong class="text-amber-400 font-mono">${remainingVal.toLocaleString()} ج.م</strong></span>
              </div>
              <div>
                ${remainingVal <= 0 
                  ? '<span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">خالص تماماً ✔️</span>' 
                  : `<button onclick="openPaymentModal(${p.id})" class="text-[10px] font-bold text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1"><i data-lucide="wallet" class="w-3 h-3"></i> تسجيل دفعة</button>`
                }
              </div>
            </div>
          </div>

          <!-- Deadline & Notes -->
          ${p.deadline || p.notes ? `
            <div class="mt-2.5 text-xs text-slate-400 flex items-center justify-between">
              ${p.deadline ? `<span class="flex items-center gap-1 text-amber-400 font-medium"><i data-lucide="calendar" class="w-3.5 h-3.5"></i> موعد التسليم: ${p.deadline}</span>` : '<span></span>'}
              ${p.notes ? `<span class="truncate max-w-[200px] text-slate-500" title="${escapeHtml(p.notes)}"><i data-lucide="info" class="w-3 h-3 inline"></i> ${escapeHtml(p.notes)}</span>` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Footer Actions -->
        <div class="pt-3 border-t border-metal-800 flex items-center justify-between gap-2 flex-wrap">
          
          <div class="flex items-center gap-1.5">
            <!-- Next Status Button -->
            <button onclick="advanceProjectStatus(${p.id})" class="text-xs bg-metal-800 hover:bg-metal-700 text-slate-200 font-semibold px-2.5 py-1.5 rounded-xl border border-metal-700 flex items-center gap-1 transition-all">
              <i data-lucide="arrow-left" class="w-3.5 h-3.5 text-emerald-400"></i>
              <span>المرحلة التالية</span>
            </button>

            <!-- Printable Invoice Button -->
            <button onclick="openInvoiceModal(${p.id})" title="عرض السعر / الفاتورة الرسمية" class="text-xs bg-metal-800 hover:bg-metal-700 text-cyan-300 font-semibold px-2.5 py-1.5 rounded-xl border border-metal-700 flex items-center gap-1 transition-all">
              <i data-lucide="printer" class="w-3.5 h-3.5 text-cyan-400"></i>
              <span>فاتورة</span>
            </button>
          </div>

          <div class="flex items-center gap-1.5">
            <!-- WhatsApp Button -->
            <button onclick="quickWhatsAppForProject(${p.id})" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 shadow transition-all active:scale-95">
              <i data-lucide="send" class="w-3.5 h-3.5"></i>
              <span>واتساب</span>
            </button>

            <!-- Edit & Delete -->
            <button onclick="editProject(${p.id})" title="تعديل المشروع" class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-metal-800">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="deleteProject(${p.id})" title="حذف المشروع" class="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-metal-800">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>

        </div>

      </div>
    `;
  }).join('');

  initLucide();
}

function getStatusInfo(status) {
  switch (status) {
    case 'design':
      return { label: 'تصميم CAD', badgeClass: 'bg-purple-500/10 text-purple-400 border border-purple-500/30', barColor: 'bg-purple-500', percentage: 16 };
    case 'nesting':
      return { label: 'تعشيق Nesting', badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/30', barColor: 'bg-blue-500', percentage: 33 };
    case 'cutting':
      return { label: 'على الماكينة', badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/30', barColor: 'bg-amber-500', percentage: 50 };
    case 'finishing':
      return { label: 'تشطيب وثني', badgeClass: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30', barColor: 'bg-cyan-500', percentage: 68 };
    case 'ready':
      return { label: 'جاهز للاستلام 🚀', badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse', barColor: 'bg-emerald-400', percentage: 85 };
    case 'delivered':
      return { label: 'تم التسليم بنجاح ✔️', badgeClass: 'bg-slate-700 text-slate-300', barColor: 'bg-slate-500', percentage: 100 };
    default:
      return { label: status, badgeClass: 'bg-metal-800 text-slate-300', barColor: 'bg-slate-600', percentage: 20 };
  }
}

// Status Advancer
async function advanceProjectStatus(projectId) {
  const p = projectsData.find(x => x.id === projectId);
  if (!p) return;

  const sequence = ['design', 'nesting', 'cutting', 'finishing', 'ready', 'delivered'];
  const currentIndex = sequence.indexOf(p.status);
  const nextStatus = currentIndex < sequence.length - 1 ? sequence[currentIndex + 1] : sequence[0];

  try {
    const res = await fetch(`/api/projects/${projectId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    if (!res.ok) throw new Error('فشل تحديث الحالة');
    showToast(`تم تحديث حالة المشروع إلى: ${getStatusInfo(nextStatus).label}`);
    await loadAllData();
  } catch (e) {
    showToast(e.message, true);
  }
}

// Project Modal: Add / Edit
function openProjectModal() {
  document.getElementById('form-project-id').value = '';
  document.getElementById('project-form').reset();
  document.getElementById('form-design-fee').value = '0';
  document.getElementById('form-paid-amount').value = '0';
  document.getElementById('form-remaining-amount').value = '0';
  document.getElementById('form-sheet-weight').value = '0';
  document.getElementById('form-is-rush').checked = false;

  document.getElementById('project-modal-title').innerHTML = '<i data-lucide="folder-plus" class="w-5 h-5 text-emerald-400"></i> إضافة مشروع ليزر جديد';
  
  const d = new Date();
  d.setDate(d.getDate() + 2);
  document.getElementById('form-deadline').value = d.toISOString().split('T')[0];

  document.getElementById('modal-project').classList.remove('hidden');
  document.getElementById('modal-project').classList.add('flex');
  initLucide();
}

function editProject(id) {
  const p = projectsData.find(x => x.id === id);
  if (!p) return;

  document.getElementById('form-project-id').value = p.id;
  document.getElementById('form-title').value = p.title || '';
  document.getElementById('form-project-type').value = p.project_type || 'company';
  document.getElementById('form-client-name').value = p.client_name || '';
  document.getElementById('form-client-phone').value = p.client_phone || '';
  document.getElementById('form-manager-name').value = p.manager_name || '';
  document.getElementById('form-material-type').value = p.material_type || 'صاج حديد أسود';
  document.getElementById('form-thickness').value = p.thickness_mm || 2.0;
  document.getElementById('form-cad-file').value = p.cad_file_name || '';
  document.getElementById('form-meters').value = p.cutting_length_meters || 0;
  document.getElementById('form-pierces').value = p.pierce_count || 0;
  document.getElementById('form-gas').value = p.gas_type || 'أكسجين O2';
  document.getElementById('form-sheet-weight').value = p.sheet_weight_kg || 0;
  document.getElementById('form-design-fee').value = p.design_fee || 0;
  document.getElementById('form-is-rush').checked = Boolean(p.is_rush);
  document.getElementById('form-time').value = p.estimated_time_min || 0;
  document.getElementById('form-total-cost').value = p.total_cost || 0;
  document.getElementById('form-client-price').value = p.client_price || 0;
  document.getElementById('form-paid-amount').value = p.paid_amount || 0;
  document.getElementById('form-remaining-amount').value = p.remaining_amount !== undefined ? p.remaining_amount : Math.max(0, (p.client_price || 0) - (p.paid_amount || 0));
  document.getElementById('form-net-profit').value = p.net_profit || 0;
  document.getElementById('form-status').value = p.status || 'design';
  document.getElementById('form-deadline').value = p.deadline || '';
  document.getElementById('form-notes').value = p.notes || '';

  document.getElementById('project-modal-title').innerHTML = '<i data-lucide="edit-3" class="w-5 h-5 text-cyan-400"></i> تعديل بيانات المشروع';
  document.getElementById('modal-project').classList.remove('hidden');
  document.getElementById('modal-project').classList.add('flex');
  initLucide();
}

function closeProjectModal() {
  document.getElementById('modal-project').classList.add('hidden');
  document.getElementById('modal-project').classList.remove('flex');
}

function calcFormProfit() {
  const cost = parseFloat(document.getElementById('form-total-cost').value) || 0;
  const price = parseFloat(document.getElementById('form-client-price').value) || 0;
  const design = parseFloat(document.getElementById('form-design-fee').value) || 0;
  const paid = parseFloat(document.getElementById('form-paid-amount').value) || 0;

  const profit = Math.max(0, (price - cost) + design);
  const remaining = Math.max(0, price - paid);

  document.getElementById('form-net-profit').value = profit;
  document.getElementById('form-remaining-amount').value = remaining;
}

async function saveProject(e) {
  e.preventDefault();
  const id = document.getElementById('form-project-id').value;
  
  const cost = parseFloat(document.getElementById('form-total-cost').value) || 0;
  const price = parseFloat(document.getElementById('form-client-price').value) || 0;
  const design = parseFloat(document.getElementById('form-design-fee').value) || 0;
  const paid = parseFloat(document.getElementById('form-paid-amount').value) || 0;
  const remaining = Math.max(0, price - paid);
  const profit = Math.max(0, (price - cost) + design);

  const payload = {
    title: document.getElementById('form-title').value,
    project_type: document.getElementById('form-project-type').value,
    client_name: document.getElementById('form-client-name').value,
    client_phone: document.getElementById('form-client-phone').value,
    manager_name: document.getElementById('form-manager-name').value,
    material_type: document.getElementById('form-material-type').value,
    thickness_mm: parseFloat(document.getElementById('form-thickness').value) || 1.0,
    cad_file_name: document.getElementById('form-cad-file').value,
    cutting_length_meters: parseFloat(document.getElementById('form-meters').value) || 0,
    pierce_count: parseInt(document.getElementById('form-pierces').value) || 0,
    gas_type: document.getElementById('form-gas').value,
    estimated_time_min: parseFloat(document.getElementById('form-time').value) || 0,
    sheet_weight_kg: parseFloat(document.getElementById('form-sheet-weight').value) || 0,
    design_fee: design,
    is_rush: document.getElementById('form-is-rush').checked ? 1 : 0,
    total_cost: cost,
    client_price: price,
    paid_amount: paid,
    remaining_amount: remaining,
    net_profit: profit,
    status: document.getElementById('form-status').value,
    deadline: document.getElementById('form-deadline').value,
    notes: document.getElementById('form-notes').value
  };

  try {
    const url = id ? `/api/projects/${id}` : '/api/projects';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('فشل حفظ المشروع في تورسو');
    
    closeProjectModal();
    showToast(id ? 'تم تحديث المشروع في Turso' : 'تم إضافة المشروع إلى Turso بنجاح');
    await loadAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteProject(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المشروع نهائياً من قاعدة البيانات السحابية؟')) return;
  try {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('تم حذف المشروع بنجاح');
    await loadAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Payment Modal Functions
function openPaymentModal(projectId) {
  const p = projectsData.find(x => x.id === projectId);
  if (!p) return;

  activePaymentProjectId = projectId;
  document.getElementById('pay-project-id').value = p.id;
  document.getElementById('pay-project-title').innerText = p.title;
  document.getElementById('pay-client-name').innerText = p.client_name || 'عميل';
  document.getElementById('pay-total-price').innerText = (p.client_price || 0).toLocaleString() + ' ج.م';
  
  const currentPaid = p.paid_amount || 0;
  document.getElementById('pay-amount-input').value = currentPaid;
  calculatePaymentModalRemaining();

  document.getElementById('modal-payment').classList.remove('hidden');
  document.getElementById('modal-payment').classList.add('flex');
}

function closePaymentModal() {
  document.getElementById('modal-payment').classList.add('hidden');
  document.getElementById('modal-payment').classList.remove('flex');
}

function calculatePaymentModalRemaining() {
  const p = projectsData.find(x => x.id === activePaymentProjectId);
  const clientPrice = p ? (p.client_price || 0) : 0;
  const paid = parseFloat(document.getElementById('pay-amount-input').value) || 0;
  const rem = Math.max(0, clientPrice - paid);
  document.getElementById('pay-remaining-calc').innerText = rem.toLocaleString() + ' ج.م';
}

async function submitPaymentUpdate() {
  if (!activePaymentProjectId) return;
  const paid = parseFloat(document.getElementById('pay-amount-input').value) || 0;

  try {
    const res = await fetch(`/api/projects/${activePaymentProjectId}/payment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid_amount: paid })
    });
    if (!res.ok) throw new Error('فشل تسجيل الدفعة');
    closePaymentModal();
    showToast('تم تسجيل الدفعة وتحديث المستحقات بنجاح 💰');
    await loadAllData();
  } catch (e) {
    showToast(e.message, true);
  }
}

// Laser Calculator Live Runner
async function runLiveCalculator() {
  const isRush = document.getElementById('calc-is-rush') ? document.getElementById('calc-is-rush').checked : false;
  const designFee = parseFloat(document.getElementById('calc-design-fee') ? document.getElementById('calc-design-fee').value : 0) || 0;
  const sheetL = parseFloat(document.getElementById('calc-sheet-length') ? document.getElementById('calc-sheet-length').value : 0) || 0;
  const sheetW = parseFloat(document.getElementById('calc-sheet-width') ? document.getElementById('calc-sheet-width').value : 0) || 0;

  const req = {
    material_type: document.getElementById('calc-material').value,
    thickness_mm: parseFloat(document.getElementById('calc-thickness').value) || 2.0,
    cutting_length_meters: parseFloat(document.getElementById('calc-meters').value) || 1.0,
    pierce_count: parseInt(document.getElementById('calc-pierce').value) || 0,
    gas_type: document.getElementById('calc-gas').value,
    sheet_fraction: parseFloat(document.getElementById('calc-sheet-fraction').value) || 1.0,
    extra_cost: parseFloat(document.getElementById('calc-extra-cost').value) || 0,
    profit_margin_percent: parseFloat(document.getElementById('calc-margin').value) || 35.0,
    design_fee: designFee,
    is_rush: isRush,
    sheet_length_mm: sheetL,
    sheet_width_mm: sheetW
  };

  try {
    const res = await fetch('/api/calculator/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error('Calculator error');
    const data = await res.json();
    calcResultCache = { ...req, ...data };

    document.getElementById('res-time').innerText = data.estimated_time_min + ' دقيقة';
    document.getElementById('res-speed').innerText = data.cutting_speed_m_min + ' م/د';
    document.getElementById('res-material-cost').innerText = data.material_cost.toLocaleString() + ' ج.م';
    document.getElementById('res-sheet-weight').innerText = (data.sheet_weight_kg || 0) + ' كجم';
    document.getElementById('res-machine-cost').innerText = data.laser_cutting_cost.toLocaleString() + ' ج.م';
    document.getElementById('res-gas-pierce-cost').innerText = (data.gas_cost + data.pierce_cost).toLocaleString() + ' ج.م';
    document.getElementById('res-extra-cost').innerText = data.extra_cost.toLocaleString() + ' ج.م';
    document.getElementById('res-total-cost').innerText = data.total_cost.toLocaleString() + ' ج.م';
    document.getElementById('res-selling-price').innerText = data.recommended_price.toLocaleString() + ' ج.م';
    document.getElementById('res-net-profit').innerText = data.net_profit.toLocaleString() + ' ج.م';
    
    const designEl = document.getElementById('res-design-fee');
    if (designEl) designEl.innerText = (data.design_fee || 0).toLocaleString() + ' ج.م';

    const rushRow = document.getElementById('res-rush-row');
    const rushFeeEl = document.getElementById('res-rush-fee');
    if (rushRow && rushFeeEl) {
      if (data.is_rush && data.rush_surcharge > 0) {
        rushRow.classList.remove('hidden');
        rushRow.classList.add('flex');
        rushFeeEl.innerText = '+' + data.rush_surcharge.toLocaleString() + ' ج.م';
      } else {
        rushRow.classList.add('hidden');
        rushRow.classList.remove('flex');
      }
    }

    const liveWeightBadge = document.getElementById('calc-live-weight-badge');
    if (liveWeightBadge) {
      liveWeightBadge.innerText = (data.sheet_weight_kg || 0) + ' كجم (' + (data.price_per_kg || 0) + ' ج/كجم)';
    }

  } catch (e) {
    console.error(e);
  }
}

function convertEstimateToProject() {
  if (!calcResultCache) return;
  openProjectModal();
  document.getElementById('form-title').value = `مشروع تقطيع ${calcResultCache.material_type} ${calcResultCache.thickness_mm} مم`;
  document.getElementById('form-material-type').value = calcResultCache.material_type;
  document.getElementById('form-thickness').value = calcResultCache.thickness_mm;
  document.getElementById('form-meters').value = calcResultCache.cutting_length_meters;
  document.getElementById('form-pierces').value = calcResultCache.pierce_count;
  document.getElementById('form-gas').value = calcResultCache.gas_type;
  document.getElementById('form-sheet-weight').value = calcResultCache.sheet_weight_kg || 0;
  document.getElementById('form-design-fee').value = calcResultCache.design_fee || 0;
  document.getElementById('form-is-rush').checked = Boolean(calcResultCache.is_rush);
  document.getElementById('form-time').value = calcResultCache.estimated_time_min;
  document.getElementById('form-total-cost').value = calcResultCache.total_cost;
  document.getElementById('form-client-price').value = calcResultCache.recommended_price;
  document.getElementById('form-paid-amount').value = 0;
  document.getElementById('form-remaining-amount').value = calcResultCache.recommended_price;
  document.getElementById('form-net-profit').value = calcResultCache.net_profit;
}

function shareEstimateOnWhatsApp() {
  if (!calcResultCache) return;
  switchTab('whatsapp');
  
  const text = `السلام عليكم ورحمة الله،
بخصوص مقايسة تقطيع الليزر:
- نوع الخامة: ${calcResultCache.material_type} سمك ${calcResultCache.thickness_mm} مم
- أطوال القطع الإجمالية: ${calcResultCache.cutting_length_meters} متر
${calcResultCache.design_fee > 0 ? `- أتعاب التصميم والهندسة CAD: ${calcResultCache.design_fee} ج.م\n` : ''}${calcResultCache.is_rush ? '- طلب مستعجل وفوري ⚡\n' : ''}- السعر الإجمالي المقترح: ${calcResultCache.recommended_price.toLocaleString()} ج.م
- زمن التنفيذ المتوقع: يومين عمل من تأكيد الطلب.
يسعدنا خدمتكم بأعلى دقة تقطيع ليزر ⚙️.`;

  document.getElementById('wa-message-text').value = text;
}

// Settings View & Management
function renderSettingsView() {
  const s = settingsData || {};
  
  const elLaser = document.getElementById('setting-laser-rate');
  if (elLaser) elLaser.value = s.laser_hourly_rate || 550.0;

  const elN2 = document.getElementById('setting-gas-nitrogen');
  if (elN2) elN2.value = s.nitrogen_cost_per_min || 6.5;

  const elO2 = document.getElementById('setting-gas-oxygen');
  if (elO2) elO2.value = s.oxygen_cost_per_min || 2.5;

  const elAir = document.getElementById('setting-gas-air');
  if (elAir) elAir.value = s.air_cost_per_min || 0.8;

  const elPierce = document.getElementById('setting-pierce-cost');
  if (elPierce) elPierce.value = s.pierce_cost_unit || 0.45;

  const elRush = document.getElementById('setting-rush-percent');
  if (elRush) elRush.value = s.rush_fee_percent || 25.0;

  const elWName = document.getElementById('setting-workshop-name');
  if (elWName) elWName.value = s.workshop_name || 'المساعد الشخصي لقص المعادن بالليزر';

  const elEngName = document.getElementById('setting-engineer-name');
  if (elEngName) elEngName.value = s.engineer_name || 'مهندس التصميم الصناعي';

  const elEngPhone = document.getElementById('setting-engineer-phone');
  if (elEngPhone) elEngPhone.value = s.engineer_phone || '';

  // Render materials cards
  const matContainer = document.getElementById('settings-materials-container');
  if (!matContainer) return;

  if (materialsData.length === 0) {
    matContainer.innerHTML = '<div class="text-xs text-slate-500 py-4 text-center">لا توجد خامات مسجلة</div>';
    return;
  }

  matContainer.innerHTML = materialsData.map(m => `
    <div class="p-3.5 bg-metal-850 rounded-xl border border-metal-700/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 transition-all hover:border-metal-600">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-sm">
          <i data-lucide="layers" class="w-4 h-4"></i>
        </div>
        <div>
          <h4 class="text-sm font-bold text-white">${escapeHtml(m.name)}</h4>
          <span class="text-[11px] text-slate-400">الكثافة: ${m.density} كجم/م²•مم • الغاز: ${escapeHtml(m.default_gas || 'أكسجين')}</span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div class="relative w-36">
          <input type="number" id="mat-price-${m.id}" step="1" value="${m.price_per_kg}" class="w-full bg-metal-900 border border-metal-700 rounded-lg px-2.5 py-1.5 text-sm font-bold text-emerald-400 focus:outline-none focus:border-emerald-500">
          <span class="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">ج/كجم</span>
        </div>
        <button onclick="saveMaterialPrice(${m.id}, ${m.density}, '${escapeHtml(m.default_gas || 'أكسجين O2')}')" title="حفظ سعر هذه الخامة في Turso" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow flex items-center gap-1 transition-all">
          <i data-lucide="save" class="w-3.5 h-3.5"></i>
          حفظ
        </button>
      </div>
    </div>
  `).join('');

  initLucide();
}

async function saveMaterialPrice(matId, density, defaultGas) {
  const input = document.getElementById(`mat-price-${matId}`);
  if (!input) return;
  const newPrice = parseFloat(input.value) || 0;

  try {
    const res = await fetch(`/api/settings/materials/${matId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_per_kg: newPrice,
        density: density,
        default_gas: defaultGas
      })
    });
    if (!res.ok) throw new Error('فشل تحديث سعر الخامة');
    showToast('تم تحديث سعر الخامة بنجاح في السحابة Turso');
    // Update local state
    const m = materialsData.find(x => x.id === matId);
    if (m) m.price_per_kg = newPrice;
    runLiveCalculator();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function saveAppSettingsOnly() {
  const payload = {
    workshop_name: document.getElementById('setting-workshop-name').value,
    engineer_name: document.getElementById('setting-engineer-name').value,
    engineer_phone: document.getElementById('setting-engineer-phone').value,
    laser_hourly_rate: parseFloat(document.getElementById('setting-laser-rate').value) || 550.0,
    nitrogen_cost_per_min: parseFloat(document.getElementById('setting-gas-nitrogen').value) || 6.5,
    oxygen_cost_per_min: parseFloat(document.getElementById('setting-gas-oxygen').value) || 2.5,
    air_cost_per_min: parseFloat(document.getElementById('setting-gas-air').value) || 0.8,
    pierce_cost_unit: parseFloat(document.getElementById('setting-pierce-cost').value) || 0.45,
    rush_fee_percent: parseFloat(document.getElementById('setting-rush-percent').value) || 25.0
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('فشل تحديث الإعدادات');
    showToast('تم حفظ إعدادات الورشة والماكينة في Turso');
    settingsData = payload;
    runLiveCalculator();
  } catch (e) {
    showToast(e.message, true);
  }
}

async function saveAllSettings() {
  await saveAppSettingsOnly();
  for (const m of materialsData) {
    const input = document.getElementById(`mat-price-${m.id}`);
    if (input) {
      await saveMaterialPrice(m.id, m.density, m.default_gas || 'أكسجين O2');
    }
  }
  showToast('تم حفظ جميع أسعار الخامات ومعدلات التشغيل بنجاح! 🚀');
}

// Printable Invoice / Official Quote Generator
function openInvoiceModal(projectId) {
  const p = projectsData.find(x => x.id === projectId);
  if (!p) return;
  activeInvoiceProject = p;
  renderInvoiceDocument(p);
  const modal = document.getElementById('modal-print-invoice');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  initLucide();
}

function printEstimateInvoice() {
  if (!calcResultCache) return;
  const tempProject = {
    id: 'EST-' + Math.floor(1000 + Math.random() * 9000),
    title: `مقايسة تقطيع ${calcResultCache.material_type} ${calcResultCache.thickness_mm} مم`,
    client_name: 'العميل الكريم',
    client_phone: '',
    material_type: calcResultCache.material_type,
    thickness_mm: calcResultCache.thickness_mm,
    cutting_length_meters: calcResultCache.cutting_length_meters,
    pierce_count: calcResultCache.pierce_count,
    gas_type: calcResultCache.gas_type,
    sheet_weight_kg: calcResultCache.sheet_weight_kg || 0,
    design_fee: calcResultCache.design_fee || 0,
    is_rush: calcResultCache.is_rush,
    client_price: calcResultCache.recommended_price,
    paid_amount: 0,
    remaining_amount: calcResultCache.recommended_price,
    notes: 'عرض سعر فوري مبني على أسعار الخامات والتشغيل الحالية.'
  };
  renderInvoiceDocument(tempProject);
  const modal = document.getElementById('modal-print-invoice');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  initLucide();
}

function closeInvoiceModal() {
  const modal = document.getElementById('modal-print-invoice');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function renderInvoiceDocument(data) {
  const container = document.getElementById('printable-invoice-content');
  if (!container) return;

  const s = settingsData || {};
  const workshopName = s.workshop_name || 'المساعد الشخصي لقص المعادن بالليزر والتصميم الصناعي';
  const engName = s.engineer_name || 'م. التصميم الصناعي';
  const engPhone = s.engineer_phone || '';
  const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  const invoiceNo = typeof data.id === 'number' ? `INV-${String(data.id).padStart(4, '0')}` : data.id;

  const clientPrice = data.client_price || 0;
  const paid = data.paid_amount || 0;
  const remaining = (data.remaining_amount !== undefined && data.remaining_amount !== null) ? data.remaining_amount : Math.max(0, clientPrice - paid);

  container.innerHTML = `
    <!-- Header -->
    <div class="flex items-start justify-between border-b-2 border-slate-800 pb-5">
      <div>
        <h1 class="text-xl md:text-2xl font-black text-slate-900">${escapeHtml(workshopName)}</h1>
        <p class="text-xs text-slate-600 mt-1">تقطيع معادن فايبر ليزر (Fiber Laser Cutting) • تصميم CAD وNesting هندسي</p>
        <p class="text-xs text-slate-600 mt-0.5">مسؤول الورشة: ${escapeHtml(engName)} ${engPhone ? `• هاتف: ${escapeHtml(engPhone)}` : ''}</p>
      </div>
      <div class="text-left font-mono">
        <div class="text-xs text-slate-500">رقم الفاتورة / العرض:</div>
        <div class="text-lg font-black text-slate-900">${escapeHtml(invoiceNo)}</div>
        <div class="text-xs text-slate-600 mt-1">${dateStr}</div>
      </div>
    </div>

    <!-- Client Info -->
    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <span class="text-slate-500 block">السادة / العميل:</span>
        <strong class="text-sm font-bold text-slate-900">${escapeHtml(data.client_name || 'عميل نقدي')}</strong>
      </div>
      ${data.client_phone ? `
        <div>
          <span class="text-slate-500 block">رقم الهاتف / الواتساب:</span>
          <strong class="font-mono text-slate-900">${escapeHtml(data.client_phone)}</strong>
        </div>
      ` : ''}
      <div>
        <span class="text-slate-500 block">وصف الطلب / المشروع:</span>
        <strong class="text-slate-900">${escapeHtml(data.title)}</strong>
      </div>
      ${data.is_rush ? '<span class="px-2.5 py-1 rounded bg-red-100 text-red-700 font-bold border border-red-300">⚡ طلب مستعجل وطارئ</span>' : ''}
    </div>

    <!-- Specs Table -->
    <table class="w-full text-xs text-right border-collapse">
      <thead>
        <tr class="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
          <th class="py-2.5 px-3">م</th>
          <th class="py-2.5 px-3">البيان والمواصفات الفنية</th>
          <th class="py-2.5 px-3">الخامة والتخانة</th>
          <th class="py-2.5 px-3">الكمية / الأبعاد</th>
          <th class="py-2.5 px-3 text-left">الإجمالي</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-200 text-slate-800">
        <tr>
          <td class="py-3 px-3 font-bold">1</td>
          <td class="py-3 px-3">
            <strong class="font-bold block">${escapeHtml(data.title)}</strong>
            <span class="text-[11px] text-slate-500">
              تقطيع فايبر ليزر • أطوال القطع: ${data.cutting_length_meters || 0} م • عدد الثقوب: ${data.pierce_count || 0} • غاز: ${escapeHtml(data.gas_type || 'أكسجين')}
            </span>
          </td>
          <td class="py-3 px-3 font-medium">${escapeHtml(data.material_type)} (سمك ${data.thickness_mm} مم)</td>
          <td class="py-3 px-3">${data.sheet_weight_kg ? `${data.sheet_weight_kg} كجم` : 'لوط تشغيل'}</td>
          <td class="py-3 px-3 font-bold text-left">${(clientPrice - (data.design_fee || 0)).toLocaleString()} ج.م</td>
        </tr>
        ${data.design_fee ? `
          <tr class="bg-cyan-50/50">
            <td class="py-2.5 px-3 font-bold">2</td>
            <td class="py-2.5 px-3" colspan="3">
              <strong>أتعاب التصميم الصناعي وإعداد ملفات الـ CAD والتعشيق (Nesting)</strong>
            </td>
            <td class="py-2.5 px-3 font-bold text-left text-cyan-800">${(data.design_fee).toLocaleString()} ج.م</td>
          </tr>
        ` : ''}
      </tbody>
    </table>

    <!-- Totals Summary Box -->
    <div class="flex justify-end pt-2">
      <div class="w-full sm:w-72 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
        <div class="flex justify-between items-center text-slate-600">
          <span>إجمالي المبلغ المطلوب:</span>
          <span class="font-bold text-slate-900 text-sm">${clientPrice.toLocaleString()} ج.م</span>
        </div>
        <div class="flex justify-between items-center text-emerald-700">
          <span>المبلغ المدفوع (العربون):</span>
          <span class="font-bold text-sm">${paid.toLocaleString()} ج.م</span>
        </div>
        <div class="border-t border-slate-300 pt-2 flex justify-between items-center font-black text-amber-700 text-sm">
          <span>المتبقي عند الاستلام:</span>
          <span class="font-bold">${remaining.toLocaleString()} ج.م</span>
        </div>
      </div>
    </div>

    <!-- Notes & Terms -->
    <div class="border-t border-slate-200 pt-4 text-[11px] text-slate-500 space-y-1">
      <p>• <strong>شروط التسليم:</strong> يتم فحص واستلام المشغولات والقطع بمقر الورشة أو عند مندوب التسليم.</p>
      <p>• <strong>صلاحية عرض السعر:</strong> 48 ساعة فقط نظراً لتقلبات أسعار الصاج والخامات في السوق.</p>
      ${data.notes ? `<p>• <strong>ملاحظات إضافية:</strong> ${escapeHtml(data.notes)}</p>` : ''}
    </div>

    <!-- Signature Footer -->
    <div class="pt-6 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600">
      <div>
        <span class="block text-slate-400">توقيع واستلام العميل:</span>
        <div class="mt-4 border-b border-dashed border-slate-400 w-40"></div>
      </div>
      <div class="text-left">
        <span class="block text-slate-400">ختم وتوقيع الورشة / المهندس:</span>
        <strong class="mt-4 block font-bold text-slate-800">${escapeHtml(engName)}</strong>
      </div>
    </div>
  `;
}

// Clients & CRM
function renderClientsList() {
  const container = document.getElementById('clients-grid');
  if (!container) return;

  const catFilter = document.getElementById('client-category-filter') ? document.getElementById('client-category-filter').value : 'all';

  let list = clientsData;
  if (catFilter !== 'all') {
    list = list.filter(c => c.category === catFilter);
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-10 text-slate-500 bg-metal-900 border border-metal-800 rounded-2xl">
        لا توجد جهات اتصال مسجلة في هذا التصنيف
      </div>
    `;
    initLucide();
    return;
  }

  container.innerHTML = list.map(c => {
    const catLabel = {
      client: 'عميل خارجي',
      manager: 'مدير / مشرف',
      supplier: 'مورد خامات',
      workshop: 'ورشة تشطيب'
    }[c.category] || c.category;

    return `
      <div class="bg-metal-900 border border-metal-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3 hover:border-metal-700 transition-all">
        <div>
          <div class="flex items-start justify-between">
            <div>
              <h3 class="text-sm font-bold text-white">${escapeHtml(c.name)}</h3>
              <span class="text-[11px] text-purple-400 font-semibold block">${catLabel}</span>
            </div>
            <span class="text-xs text-slate-400 bg-metal-850 px-2 py-0.5 rounded-lg border border-metal-800 font-mono" dir="ltr">${escapeHtml(c.phone)}</span>
          </div>
          ${c.company_name ? `<p class="text-xs text-slate-400 mt-1 flex items-center gap-1"><i data-lucide="building" class="w-3 h-3 text-slate-500"></i> ${escapeHtml(c.company_name)}</p>` : ''}
          ${c.notes ? `<p class="text-xs text-slate-500 mt-2 bg-metal-950/60 p-2 rounded-lg border border-metal-850">${escapeHtml(c.notes)}</p>` : ''}
        </div>

        <div class="pt-2 border-t border-metal-800 flex items-center justify-between gap-2">
          <a href="tel:${escapeHtml(c.phone)}" class="text-xs bg-metal-800 hover:bg-metal-700 text-slate-300 px-3 py-1.5 rounded-xl border border-metal-700 flex items-center gap-1">
            <i data-lucide="phone" class="w-3.5 h-3.5 text-cyan-400"></i>
            اتصال
          </a>
          <button onclick="openWhatsAppWithClient('${escapeHtml(c.name)}', '${escapeHtml(c.phone)}')" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 shadow">
            <i data-lucide="send" class="w-3.5 h-3.5"></i>
            واتساب
          </button>
          <div class="flex items-center">
            <button onclick="editClient(${c.id})" class="p-1 text-slate-400 hover:text-white"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
            <button onclick="deleteClient(${c.id})" class="p-1 text-slate-400 hover:text-red-400"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  initLucide();
}

function openClientModal() {
  document.getElementById('form-client-id').value = '';
  document.getElementById('client-form').reset();
  document.getElementById('modal-client').classList.remove('hidden');
  document.getElementById('modal-client').classList.add('flex');
}

function editClient(id) {
  const c = clientsData.find(x => x.id === id);
  if (!c) return;

  document.getElementById('form-client-id').value = c.id;
  document.getElementById('form-c-name').value = c.name;
  document.getElementById('form-c-phone').value = c.phone;
  document.getElementById('form-c-category').value = c.category;
  document.getElementById('form-c-company').value = c.company_name || '';
  document.getElementById('form-c-notes').value = c.notes || '';

  document.getElementById('modal-client').classList.remove('hidden');
  document.getElementById('modal-client').classList.add('flex');
}

function closeClientModal() {
  document.getElementById('modal-client').classList.add('hidden');
  document.getElementById('modal-client').classList.remove('flex');
}

async function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('form-client-id').value;
  const payload = {
    name: document.getElementById('form-c-name').value,
    phone: document.getElementById('form-c-phone').value,
    category: document.getElementById('form-c-category').value,
    company_name: document.getElementById('form-c-company').value,
    notes: document.getElementById('form-c-notes').value,
    balance: 0.0
  };

  try {
    const url = id ? `/api/clients/${id}` : '/api/clients';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('فشل حفظ جهة الاتصال');
    closeClientModal();
    showToast('تم حفظ جهة الاتصال بنجاح في Turso');
    await loadAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteClient(id) {
  if (!confirm('هل تريد حذف هذه الجهة من الدليل؟')) return;
  try {
    const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('تم الحذف بنجاح');
    await loadAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

// WhatsApp Integration
function populateContactDropdowns() {
  const select = document.getElementById('wa-select-contact');
  if (!select) return;
  select.innerHTML = '<option value="">-- اختر من دليل العملاء أو اكتب الرقم يدوياً بالأسفل --</option>' + 
    clientsData.map(c => `<option value="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${escapeHtml(c.phone)}) - ${escapeHtml(c.company_name || c.category)}</option>`).join('');
}

function populateTemplatesDropdown() {
  const select = document.getElementById('wa-select-template');
  if (!select) return;
  select.innerHTML = '<option value="">-- اختر قالباً جاهزاً (اختياري) --</option>' +
    templatesData.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
}

function applySelectedContactToWA() {
  const select = document.getElementById('wa-select-contact');
  const phone = select.value;
  if (phone) {
    document.getElementById('wa-phone').value = phone;
  }
}

function applyTemplateToWA() {
  const select = document.getElementById('wa-select-template');
  const tId = parseInt(select.value);
  const t = templatesData.find(x => x.id === tId);
  if (!t) return;

  const contactSelect = document.getElementById('wa-select-contact');
  const selectedOption = contactSelect.options[contactSelect.selectedIndex];
  const clientName = selectedOption ? selectedOption.getAttribute('data-name') || 'العميل' : 'العميل';

  let text = t.content
    .replace('{client_name}', clientName)
    .replace('{project_title}', 'المشروع')
    .replace('{deadline}', 'خلال 48 ساعة');

  document.getElementById('wa-message-text').value = text;
}

function openWhatsAppWithClient(name, phone) {
  switchTab('whatsapp');
  document.getElementById('wa-phone').value = phone;
  document.getElementById('wa-message-text').value = `أهلاً باشمهندس ${name}، تحياتنا لحضرتك بخصوص أعمال التقطيع بالليزر ⚙️.`;
}

function quickWhatsAppForProject(projectId) {
  const p = projectsData.find(x => x.id === projectId);
  if (!p) return;

  switchTab('whatsapp');
  document.getElementById('wa-phone').value = p.client_phone || '';
  
  let msg = '';
  if (p.status === 'ready') {
    msg = `أهلاً باشمهندس ${p.client_name || ''}، نحيطكم علماً بأن مشروعك (${p.title}) تم الانتهاء من تقطيعه وتشطيبه وهو الآن جاهز للاستلام 🚀.`;
  } else if (p.status === 'cutting') {
    msg = `أهلاً باشمهندس ${p.client_name || ''}، جاري الآن تقطيع مشروعك (${p.title}) على ماكينة الليزر بأعلى جودة. موعد التسليم المتوقع: ${p.deadline || 'قريباً'}.`;
  } else {
    msg = `أهلاً باشمهندس ${p.client_name || ''}، بخصوص مشروع (${p.title}): الحالة الحالية (${getStatusInfo(p.status).label}). نسعد بخدمتك دائماً.`;
  }

  document.getElementById('wa-message-text').value = msg;
}

async function launchWhatsAppDirect() {
  const phone = document.getElementById('wa-phone').value.trim();
  const message = document.getElementById('wa-message-text').value.trim();

  if (!phone) {
    showToast('يرجى إدخال رقم الهاتف أولاً', true);
    return;
  }
  if (!message) {
    showToast('يرجى كتابة نص الرسالة أولاً', true);
    return;
  }

  try {
    const res = await fetch('/api/whatsapp/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message })
    });
    const data = await res.json();
    window.open(data.url, '_blank');
    showToast('تم فتح واتساب للإرسال 🚀');
  } catch (e) {
    showToast('حدث خطأ أثناء فتح واتساب', true);
  }
}

// Broadcast Modal
function openBroadcastModal() {
  const list = clientsData.filter(c => c.category === 'client');
  const container = document.getElementById('broadcast-clients-list');

  if (list.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">لا يوجد عملاء مسجلين حالياً</div>';
  } else {
    container.innerHTML = list.map(c => `
      <div class="flex items-center justify-between p-2 rounded-xl bg-metal-850 border border-metal-800 text-xs">
        <div>
          <span class="font-bold text-white">${escapeHtml(c.name)}</span>
          <span class="text-slate-500 text-[11px] block">${escapeHtml(c.phone)}</span>
        </div>
        <button onclick="sendBroadcastSingle('${escapeHtml(c.phone)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1">
          <i data-lucide="send" class="w-3 h-3"></i>
          إرسال
        </button>
      </div>
    `).join('');
  }

  document.getElementById('modal-broadcast').classList.remove('hidden');
  document.getElementById('modal-broadcast').classList.add('flex');
  initLucide();
}

function closeBroadcastModal() {
  document.getElementById('modal-broadcast').classList.add('hidden');
  document.getElementById('modal-broadcast').classList.remove('flex');
}

async function sendBroadcastSingle(phone) {
  const message = document.getElementById('broadcast-message-text').value;
  try {
    const res = await fetch('/api/whatsapp/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message })
    });
    const data = await res.json();
    window.open(data.url, '_blank');
  } catch (e) {
    console.error(e);
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
