/* =============================================
   VendaPro – app.js
   Sistema de Gestão de Vendas com PDF
   ============================================= */

'use strict';

// ── Storage helpers ──────────────────────────
const DB = {
  get: (k, fallback = null) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── State ────────────────────────────────────
let catalog = DB.get('vp_catalog', []);
let sales   = DB.get('vp_sales',   []);
let editingCatId = null;
let vendaItens   = [];
let chartDiario  = null;
let chartTop5    = null;
let selectedDashMonth = '';

// ── Utils ─────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function fmt(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(+n || 0);
}

function fmtDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function monthKey(iso) { return iso ? iso.slice(0, 7) : ''; }

function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${names[+m - 1]} ${y}`;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function getAllMonths() {
  const keys = [...new Set(sales.map(s => monthKey(s.date)))].filter(Boolean).sort((a,b)=>b.localeCompare(a));
  if (!keys.length) keys.push(todayISO().slice(0,7));
  return keys;
}

function getSalesForMonth(key) {
  return sales.filter(s => monthKey(s.date) === key);
}

// ── Save helpers ──────────────────────────────
function saveCatalog() { DB.set('vp_catalog', catalog); }
function saveSales()   { DB.set('vp_sales',   sales);   }

// ── Navigation ────────────────────────────────
const pages = ['dashboard','nova-venda','catalogo','historico','relatorio'];

function goToPage(name) {
  pages.forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle('active', p === name);
    document.getElementById(`nav-${p}`)?.classList.toggle('active', p === name);
  });
  const titles = {
    'dashboard':   'Dashboard',
    'nova-venda':  'Nova Venda',
    'catalogo':    'Catálogo',
    'historico':   'Histórico de Vendas',
    'relatorio':   'Relatório PDF',
  };
  document.getElementById('topbar-title').textContent = titles[name] || name;
  // Refresh page content
  if (name === 'dashboard')  refreshDashboard();
  if (name === 'nova-venda') refreshNovaVenda();
  if (name === 'catalogo')   renderCatalogo();
  if (name === 'historico')  refreshHistorico();
  if (name === 'relatorio')  refreshRelatorio();
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

// ── DASHBOARD ─────────────────────────────────
function refreshDashboard() {
  const months = getAllMonths();
  const sel = document.getElementById('dash-month-select');
  const current = sel.value || months[0] || todayISO().slice(0,7);
  sel.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  sel.value = current;
  selectedDashMonth = current;
  renderDashKPIs(current);
  renderChartDiario(current);
  renderChartTop5(current);
  renderRecentSales();
}

function renderDashKPIs(month) {
  const list = getSalesForMonth(month);
  const fat = list.reduce((s, v) => s + v.total, 0);
  const itens = list.reduce((s, v) => s + v.items.reduce((a, i) => a + i.qty, 0), 0);
  const ticket = list.length ? fat / list.length : 0;
  document.getElementById('kpi-faturamento-val').textContent = fmt(fat);
  document.getElementById('kpi-vendas-val').textContent      = list.length;
  document.getElementById('kpi-ticket-val').textContent      = fmt(ticket);
  document.getElementById('kpi-itens-val').textContent       = itens;
}

function renderChartDiario(month) {
  const list = getSalesForMonth(month);
  // Group by day
  const map = {};
  list.forEach(v => {
    const d = v.date;
    map[d] = (map[d] || 0) + v.total;
  });
  const days = Object.keys(map).sort();
  const labels = days.map(d => d.slice(8)); // day number
  const data   = days.map(d => map[d]);

  const ctx = document.getElementById('chart-diario').getContext('2d');
  if (chartDiario) chartDiario.destroy();
  chartDiario = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento (R$)',
        data,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.12)',
        pointBackgroundColor: '#6366f1',
        pointRadius: 4,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => 'R$' + v.toFixed(0) } }
      }
    }
  });
}

function renderChartTop5(month) {
  const list = getSalesForMonth(month);
  const map = {};
  list.forEach(v => {
    v.items.forEach(item => {
      map[item.name] = (map[item.name] || 0) + item.qty;
    });
  });
  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 5);
  const labels = sorted.map(([n]) => n.length > 18 ? n.slice(0,16)+'…' : n);
  const data   = sorted.map(([,q]) => q);

  const ctx = document.getElementById('chart-top5').getContext('2d');
  if (chartTop5) chartTop5.destroy();
  chartTop5 = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#6366f1','#a855f7','#3b82f6','#10b981','#f59e0b'],
        borderWidth: 2,
        borderColor: '#111627',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { size: 11 }, padding: 12, boxWidth: 12 }
        }
      },
      cutout: '65%',
    }
  });
}

function renderRecentSales() {
  const box = document.getElementById('recent-sales-list');
  const recent = [...sales].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (!recent.length) {
    box.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <p>Nenhuma venda registrada ainda.</p>
      <button class="btn-accent" onclick="goToPage('nova-venda')">Registrar Primeira Venda</button>
    </div>`;
    return;
  }
  box.innerHTML = recent.map(v => {
    const itensStr = v.items.map(i => `${i.name} (${i.qty}x)`).join(', ');
    return `<div class="sale-item">
      <div class="sale-item-left">
        <span class="sale-item-date">${fmtDate(v.date)}</span>
        <span class="sale-item-desc">${itensStr.length > 55 ? itensStr.slice(0,53)+'…' : itensStr}</span>
        ${v.cliente ? `<span class="sale-item-cliente">🧑 ${v.cliente}</span>` : ''}
      </div>
      <span class="sale-item-value">${fmt(v.total)}</span>
    </div>`;
  }).join('');
}

// ── NOVA VENDA ────────────────────────────────
function refreshNovaVenda() {
  document.getElementById('venda-data').value = todayISO();
  document.getElementById('venda-cliente').value = '';
  document.getElementById('venda-obs').value = '';
  document.getElementById('item-search').value = '';
  vendaItens = [];
  renderItensVenda();
  refreshResumoDia();
  renderAtalhos();
}

function refreshResumoDia() {
  const today = todayISO();
  const todaySales = sales.filter(s => s.date === today);
  const fat = todaySales.reduce((s,v) => s + v.total, 0);
  document.getElementById('resumo-dia-vendas').textContent = todaySales.length;
  document.getElementById('resumo-dia-fat').textContent    = fmt(fat);
}

function renderAtalhos() {
  const box = document.getElementById('atalho-cats');
  if (!catalog.length) { box.innerHTML = '<span style="font-size:0.78rem;color:var(--text-muted)">Adicione itens no Catálogo</span>'; return; }
  box.innerHTML = catalog.slice(0, 10).map(c =>
    `<button class="atalho-btn" onclick="addItemToVenda('${c.id}')">${c.name}</button>`
  ).join('');
}

function addItemToVenda(catId, override = {}) {
  const cat = catalog.find(c => c.id === catId);
  if (!cat) return;
  const existing = vendaItens.find(i => i.catId === catId);
  if (existing) {
    existing.qty++;
  } else {
    vendaItens.push({
      catId, name: cat.name, unit: cat.unit || 'unid',
      price: override.price ?? cat.price, qty: 1
    });
  }
  renderItensVenda();
  hideSearch();
}

function renderItensVenda() {
  const box = document.getElementById('itens-venda-list');
  if (!vendaItens.length) {
    box.innerHTML = '<div class="itens-empty">Nenhum item adicionado</div>';
    document.getElementById('venda-total-display').textContent = 'R$ 0,00';
    return;
  }
  box.innerHTML = vendaItens.map((item, idx) => `
    <div class="item-venda-row" id="ivr-${idx}">
      <div class="ivr-name">${item.name}<span>${fmt(item.price)} / ${item.unit}</span></div>
      <div class="ivr-qty">
        <input type="number" min="1" value="${item.qty}" data-idx="${idx}" class="qty-input" />
      </div>
      <div class="ivr-price">${fmt(item.price * item.qty)}</div>
      <button class="btn-icon danger" onclick="removeItemVenda(${idx})" title="Remover">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
  `).join('');

  // Qty listeners
  box.querySelectorAll('.qty-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      const v = Math.max(1, +e.target.value || 1);
      vendaItens[i].qty = v;
      renderItensVenda();
    });
  });

  const total = vendaItens.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('venda-total-display').textContent = fmt(total);
}

function removeItemVenda(idx) {
  vendaItens.splice(idx, 1);
  renderItensVenda();
}

// Item search
let searchTimeout;
document.getElementById('item-search').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderSuggestions(e.target.value.trim()), 160);
});

document.getElementById('item-search').addEventListener('focus', e => {
  renderSuggestions(e.target.value.trim());
});

document.addEventListener('click', e => {
  if (!e.target.closest('.item-search-wrapper')) hideSearch();
});

function renderSuggestions(q) {
  const box = document.getElementById('item-suggestions');
  const results = q
    ? catalog.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    : catalog.slice(0, 8);
  if (!results.length) { box.classList.remove('open'); return; }
  box.innerHTML = results.map(c => `
    <div class="suggestion-item" data-id="${c.id}">
      <div class="sug-left">
        <span class="sug-name">${c.name}</span>
        <span class="sug-type">${c.type === 'produto' ? '📦 Produto' : '🔧 Serviço'} · ${c.unit}</span>
      </div>
      <span class="sug-price">${fmt(c.price)}</span>
    </div>
  `).join('');
  box.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      addItemToVenda(el.dataset.id);
      document.getElementById('item-search').value = '';
    });
  });
  box.classList.add('open');
}

function hideSearch() {
  document.getElementById('item-suggestions').classList.remove('open');
}

// Form submit
document.getElementById('form-venda').addEventListener('submit', e => {
  e.preventDefault();
  if (!vendaItens.length) { toast('Adicione pelo menos um item!', 'error'); return; }
  const sale = {
    id: uid(),
    date: document.getElementById('venda-data').value,
    cliente: document.getElementById('venda-cliente').value.trim(),
    items: vendaItens.map(i => ({ ...i })),
    total: vendaItens.reduce((s, i) => s + i.price * i.qty, 0),
    pagamento: document.getElementById('venda-pagamento').value,
    obs: document.getElementById('venda-obs').value.trim(),
    createdAt: Date.now(),
  };
  sales.push(sale);
  saveSales();
  toast(`✅ Venda de ${fmt(sale.total)} registrada com sucesso!`);
  vendaItens = [];
  refreshNovaVenda();
});

// ── CATÁLOGO ──────────────────────────────────
let catalogFilter = 'todos';
let catalogSearch = '';

function renderCatalogo() {
  const grid = document.getElementById('catalogo-grid');
  let items = catalog;
  if (catalogFilter !== 'todos') items = items.filter(c => c.type === catalogFilter);
  if (catalogSearch) items = items.filter(c => c.name.toLowerCase().includes(catalogSearch.toLowerCase()));

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state full-width">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <p>${catalog.length ? 'Nenhum resultado para este filtro.' : 'Catálogo vazio. Adicione produtos e serviços.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = items.map(c => `
    <div class="cat-card">
      <div class="cat-card-head">
        <span class="cat-badge badge-${c.type}">${c.type === 'produto' ? 'Produto' : 'Serviço'}</span>
        <div class="cat-card-actions">
          <button class="btn-icon" onclick="editCat('${c.id}')" title="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" onclick="deleteCat('${c.id}')" title="Excluir">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      <div class="cat-card-name">${c.name}</div>
      ${c.description ? `<div class="cat-card-desc">${c.description}</div>` : ''}
      <div class="cat-card-footer">
        <div>
          <span class="cat-card-price">${fmt(c.price)}</span>
          <span class="cat-card-unit"> / ${c.unit || 'unid'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('btn-novo-item').addEventListener('click', () => openModalCat());

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    catalogFilter = e.target.dataset.filter;
    renderCatalogo();
  });
});

document.getElementById('catalogo-search').addEventListener('input', e => {
  catalogSearch = e.target.value;
  renderCatalogo();
});

function openModalCat(id = null) {
  editingCatId = id;
  const modal = document.getElementById('modal-catalogo');
  const form  = document.getElementById('form-catalogo');
  form.reset();
  if (id) {
    const cat = catalog.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('modal-catalogo-title').textContent = 'Editar Item';
    document.getElementById('cat-id').value          = cat.id;
    document.getElementById('cat-tipo').value         = cat.type;
    document.getElementById('cat-nome').value         = cat.name;
    document.getElementById('cat-descricao').value    = cat.description || '';
    document.getElementById('cat-preco').value        = cat.price;
    document.getElementById('cat-unidade').value      = cat.unit || 'unid';
  } else {
    document.getElementById('modal-catalogo-title').textContent = 'Novo Item';
    document.getElementById('cat-unidade').value = 'unid';
  }
  modal.style.display = 'grid';
}

function editCat(id) { openModalCat(id); }

function deleteCat(id) {
  if (!confirm('Excluir este item do catálogo?')) return;
  catalog = catalog.filter(c => c.id !== id);
  saveCatalog();
  renderCatalogo();
  toast('Item excluído.', 'error');
}

document.getElementById('btn-close-modal-catalogo').addEventListener('click', closeModalCat);
document.getElementById('btn-cancel-catalogo').addEventListener('click', closeModalCat);
document.getElementById('modal-catalogo').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModalCat();
});

function closeModalCat() {
  document.getElementById('modal-catalogo').style.display = 'none';
  editingCatId = null;
}

document.getElementById('form-catalogo').addEventListener('submit', e => {
  e.preventDefault();
  const item = {
    id:          editingCatId || uid(),
    type:        document.getElementById('cat-tipo').value,
    name:        document.getElementById('cat-nome').value.trim(),
    description: document.getElementById('cat-descricao').value.trim(),
    price:       +document.getElementById('cat-preco').value,
    unit:        document.getElementById('cat-unidade').value.trim() || 'unid',
  };
  if (!item.name || !item.price) return;
  if (editingCatId) {
    const idx = catalog.findIndex(c => c.id === editingCatId);
    if (idx !== -1) catalog[idx] = item;
    toast('Item atualizado!');
  } else {
    catalog.push(item);
    toast('Item adicionado ao catálogo!');
  }
  saveCatalog();
  closeModalCat();
  renderCatalogo();
  renderAtalhos();
});

// ── HISTÓRICO ─────────────────────────────────
function refreshHistorico() {
  const months = getAllMonths();
  const sel = document.getElementById('hist-month-select');
  sel.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  renderHistoricoTable(sel.value || months[0]);
  sel.addEventListener('change', e => renderHistoricoTable(e.target.value));
}

const pagLabels = { dinheiro:'Dinheiro', pix:'PIX', debito:'Débito', credito:'Crédito', outro:'Outro' };

function renderHistoricoTable(month) {
  const tbody = document.getElementById('historico-tbody');
  const list = getSalesForMonth(month).sort((a,b) => b.date.localeCompare(a.date));
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Nenhuma venda em ${monthLabel(month)}.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(v => `
    <tr>
      <td>${fmtDate(v.date)}</td>
      <td>${v.cliente || '<span style="color:var(--text-muted)">–</span>'}</td>
      <td>${v.items.map(i => `<span class="tag-item">${i.name} ×${i.qty}</span>`).join(' ')}</td>
      <td><span class="pill-pagamento">${pagLabels[v.pagamento] || v.pagamento}</span></td>
      <td style="font-weight:700;color:var(--green)">${fmt(v.total)}</td>
      <td>
        <button class="btn-icon danger" onclick="deleteSale('${v.id}')" title="Excluir venda">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function deleteSale(id) {
  if (!confirm('Excluir esta venda do histórico?')) return;
  sales = sales.filter(s => s.id !== id);
  saveSales();
  refreshHistorico();
  toast('Venda excluída.', 'error');
}

// ── RELATÓRIO ─────────────────────────────────
function refreshRelatorio() {
  const months = getAllMonths();
  const sel = document.getElementById('rel-month-select');
  sel.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
}

document.getElementById('btn-preview-rel').addEventListener('click', () => {
  const month = document.getElementById('rel-month-select').value;
  const empresa = document.getElementById('rel-empresa').value.trim() || 'VendaPro';
  const html = buildReportHTML(month, empresa);
  const box = document.getElementById('preview-body');
  box.innerHTML = html;
  document.getElementById('relatorio-preview').style.display = 'block';
  document.getElementById('relatorio-preview').scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('btn-close-preview').addEventListener('click', () => {
  document.getElementById('relatorio-preview').style.display = 'none';
});

document.getElementById('btn-gerar-pdf').addEventListener('click', async () => {
  const month  = document.getElementById('rel-month-select').value;
  const empresa = document.getElementById('rel-empresa').value.trim() || 'VendaPro';
  await generatePDF(month, empresa);
});

function buildReportData(month) {
  const list = getSalesForMonth(month);
  const fat  = list.reduce((s, v) => s + v.total, 0);
  const itensCount = list.reduce((s, v) => s + v.items.reduce((a,i)=>a+i.qty,0), 0);
  const ticket = list.length ? fat / list.length : 0;

  // Group by item
  const itemMap = {};
  list.forEach(v => {
    v.items.forEach(i => {
      if (!itemMap[i.name]) itemMap[i.name] = { name: i.name, qty: 0, revenue: 0 };
      itemMap[i.name].qty     += i.qty;
      itemMap[i.name].revenue += i.price * i.qty;
    });
  });
  const topItems = Object.values(itemMap).sort((a,b) => b.qty - a.qty);

  // Group by pagamento
  const pagMap = {};
  list.forEach(v => {
    pagMap[v.pagamento] = (pagMap[v.pagamento] || 0) + v.total;
  });

  // Daily
  const dayMap = {};
  list.forEach(v => { dayMap[v.date] = (dayMap[v.date] || 0) + v.total; });
  const bestDay = Object.entries(dayMap).sort((a,b) => b[1]-a[1])[0];

  return { list, fat, itensCount, ticket, topItems, pagMap, bestDay };
}

function buildReportHTML(month, empresa) {
  const d = buildReportData(month);
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`;
  const maxQty = d.topItems[0]?.qty || 1;

  const barsHTML = d.topItems.slice(0, 10).map(item => {
    const pct = Math.round((item.qty / maxQty) * 100);
    return `<div class="prev-bar-row">
      <span class="prev-bar-label" title="${item.name}">${item.name}</span>
      <div class="prev-bar-track"><div class="prev-bar-fill" style="width:${pct}%"></div></div>
      <span class="prev-bar-val">${item.qty}x · ${fmt(item.revenue)}</span>
    </div>`;
  }).join('');

  const salesRows = d.list.slice(0, 30).map(v => `
    <tr>
      <td>${fmtDate(v.date)}</td>
      <td>${v.cliente || '–'}</td>
      <td>${v.items.map(i => `${i.name} (${i.qty}x)`).join(', ')}</td>
      <td>${pagLabels[v.pagamento] || v.pagamento}</td>
      <td style="font-weight:700;color:#4f46e5">${fmt(v.total)}</td>
    </tr>
  `).join('');

  const pagRows = Object.entries(d.pagMap).map(([p, v]) => `
    <tr><td>${pagLabels[p]||p}</td><td style="font-weight:600">${fmt(v)}</td></tr>
  `).join('');

  return `<div class="prev-page">
    <div class="prev-head">
      <div class="prev-logo-area">
        <h1>📊 Relatório Mensal</h1>
        <p>${empresa}</p>
      </div>
      <div class="prev-meta">
        <strong>Período:</strong> ${monthLabel(month)}<br>
        <strong>Gerado em:</strong> ${dateStr}<br>
        <strong>Total de vendas:</strong> ${d.list.length}
      </div>
    </div>

    <div class="prev-section">
      <div class="prev-section-title">Resumo Financeiro</div>
      <div class="prev-kpi-row">
        <div class="prev-kpi"><p>Faturamento Total</p><h2>${fmt(d.fat)}</h2></div>
        <div class="prev-kpi"><p>Ticket Médio</p><h2>${fmt(d.ticket)}</h2></div>
        <div class="prev-kpi"><p>Itens Vendidos</p><h2>${d.itensCount}</h2></div>
      </div>
      ${d.bestDay ? `<p style="margin-top:12px;font-size:0.8rem;color:#64748b">📅 <strong>Melhor dia:</strong> ${fmtDate(d.bestDay[0])} com ${fmt(d.bestDay[1])}</p>` : ''}
    </div>

    <div class="prev-section">
      <div class="prev-section-title">Produtos / Serviços Mais Vendidos</div>
      ${barsHTML || '<p style="color:#94a3b8;font-size:0.8rem">Sem dados.</p>'}
    </div>

    <div class="prev-section">
      <div class="prev-section-title">Formas de Pagamento</div>
      <table class="prev-table">
        <thead><tr><th>Método</th><th>Total</th></tr></thead>
        <tbody>${pagRows || '<tr><td colspan="2" style="color:#94a3b8">Sem dados.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="prev-section">
      <div class="prev-section-title">Histórico de Vendas (${Math.min(d.list.length, 30)} registros${d.list.length > 30 ? ' – parcial' : ''})</div>
      <table class="prev-table">
        <thead><tr><th>Data</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th>Total</th></tr></thead>
        <tbody>${salesRows || '<tr><td colspan="5" style="color:#94a3b8">Sem vendas.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="prev-footer">
      <span>VendaPro · Sistema de Gestão de Vendas</span>
      <span>Gerado automaticamente em ${dateStr}</span>
    </div>
  </div>`;
}

async function generatePDF(month, empresa) {
  const btn = document.getElementById('btn-gerar-pdf');
  btn.disabled = true;
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Gerando PDF...`;

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const d = buildReportData(month);
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`;
    const pageW = 210;
    const margin = 20;
    const contentW = pageW - margin * 2;
    let y = 0;

    // Colors
    const accentRGB = [79, 70, 229];
    const lightBg   = [248, 250, 255];

    function newPage() {
      doc.addPage();
      y = margin;
    }

    function checkY(needed = 12) {
      if (y + needed > 280) newPage();
    }

    // ── HEADER ──
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, pageW, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Relatório Mensal', margin, 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(empresa, margin, 25);
    doc.text(`Período: ${monthLabel(month)}`, margin, 33);

    doc.setFontSize(9);
    doc.text(`Gerado em: ${dateStr}`, pageW - margin, 25, { align: 'right' });
    doc.text(`Total de vendas: ${d.list.length}`, pageW - margin, 33, { align: 'right' });

    y = 52;

    // ── KPI BOXES ──
    const kpis = [
      { label: 'Faturamento Total', value: fmt(d.fat) },
      { label: 'Ticket Médio',      value: fmt(d.ticket) },
      { label: 'Itens Vendidos',    value: `${d.itensCount}` },
    ];
    const boxW = contentW / 3 - 3;
    kpis.forEach((kpi, i) => {
      const bx = margin + i * (boxW + 4.5);
      doc.setFillColor(...lightBg);
      doc.roundedRect(bx, y, boxW, 24, 3, 3, 'F');
      doc.setDrawColor(200, 210, 255);
      doc.setLineWidth(0.4);
      doc.roundedRect(bx, y, boxW, 24, 3, 3, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label.toUpperCase(), bx + 8, y + 9);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...accentRGB);
      doc.text(kpi.value, bx + 8, y + 19);
    });
    y += 32;

    if (d.bestDay) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Melhor dia: ${fmtDate(d.bestDay[0])} com ${fmt(d.bestDay[1])}`, margin, y);
      y += 8;
    }

    // ── SECTION TITLE HELPER ──
    function sectionTitle(title) {
      checkY(16);
      y += 4;
      doc.setFillColor(...accentRGB);
      doc.rect(margin, y, contentW, 0.6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...accentRGB);
      doc.text(title.toUpperCase(), margin, y - 2);
      y += 6;
      doc.setTextColor(50, 50, 50);
    }

    // ── TOP ITEMS ──
    sectionTitle('Produtos / Serviços Mais Vendidos');
    const maxQty = d.topItems[0]?.qty || 1;
    d.topItems.slice(0, 12).forEach(item => {
      checkY(10);
      const pct = item.qty / maxQty;
      const nameW = 55;
      const barX  = margin + nameW + 4;
      const barW  = contentW - nameW - 50;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(50, 65, 80);
      const shortName = item.name.length > 28 ? item.name.slice(0,26)+'…' : item.name;
      doc.text(shortName, margin, y + 4.5);

      // Track
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(barX, y + 1, barW, 5, 1, 1, 'F');
      // Fill
      if (pct > 0) {
        doc.setFillColor(...accentRGB);
        doc.roundedRect(barX, y + 1, barW * pct, 5, 1, 1, 'F');
      }
      // Label
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${item.qty}x · ${fmt(item.revenue)}`, barX + barW + 3, y + 4.5);

      y += 9;
    });

    y += 4;

    // ── PAGAMENTOS ──
    sectionTitle('Formas de Pagamento');
    const pagEntries = Object.entries(d.pagMap);
    if (pagEntries.length) {
      const colW = contentW / 2 - 4;
      pagEntries.forEach(([p, v], i) => {
        checkY(10);
        const col = i % 2;
        const px  = margin + col * (colW + 8);
        if (i % 2 === 0 && i !== 0) {} // just continues
        doc.setFillColor(...lightBg);
        doc.roundedRect(px, y, colW, 10, 2, 2, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text(pagLabels[p] || p, px + 5, y + 6.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...accentRGB);
        doc.text(fmt(v), px + colW - 5, y + 6.5, { align: 'right' });
        if (col === 1) y += 13;
        else if (i === pagEntries.length - 1) y += 13;
      });
    }

    y += 4;

    // ── SALES TABLE ──
    sectionTitle(`Histórico de Vendas (${d.list.length} registros)`);
    const tableHeaders = ['Data', 'Cliente', 'Itens', 'Pagto', 'Total'];
    const colWidths    = [22, 28, contentW - 22 - 28 - 20 - 28, 20, 28];
    const rowH = 7.5;

    // Header row
    checkY(rowH + 2);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentW, rowH + 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    let cx = margin + 2;
    tableHeaders.forEach((h, i) => {
      doc.text(h, cx, y + rowH - 1);
      cx += colWidths[i];
    });
    y += rowH + 1;
    doc.setLineWidth(0.3);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, margin + contentW, y);

    // Data rows
    d.list.forEach((v, ri) => {
      checkY(rowH + 1);
      if (ri % 2 === 1) {
        doc.setFillColor(250, 251, 255);
        doc.rect(margin, y, contentW, rowH + 0.5, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);

      const itensStr = v.items.map(i => `${i.name}(${i.qty}x)`).join(', ');
      const cols = [
        fmtDate(v.date),
        v.cliente ? (v.cliente.length > 14 ? v.cliente.slice(0,12)+'…' : v.cliente) : '–',
        itensStr.length > 40 ? itensStr.slice(0,38)+'…' : itensStr,
        pagLabels[v.pagamento] || v.pagamento,
        fmt(v.total),
      ];

      cx = margin + 2;
      cols.forEach((c, i) => {
        if (i === 4) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...accentRGB);
        }
        doc.text(c, cx, y + rowH - 1);
        if (i === 4) { doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 65, 85); }
        cx += colWidths[i];
      });

      y += rowH;
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y, margin + contentW, y);
    });

    // ── FOOTER on each page ──
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      doc.text('VendaPro · Sistema de Gestão de Vendas', margin, 290);
      doc.text(`Página ${i}/${pageCount}`, pageW - margin, 290, { align: 'right' });
    }

    doc.save(`Relatorio_${monthLabel(month).replace(' ', '_')}.pdf`);
    toast('✅ PDF gerado e baixado com sucesso!');
  } catch (err) {
    console.error(err);
    toast('Erro ao gerar PDF. Verifique o console.', 'error');
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg> Gerar & Baixar PDF`;
}

// ── MONTH SELECTS SYNC ────────────────────────
document.getElementById('dash-month-select').addEventListener('change', e => {
  renderDashKPIs(e.target.value);
  renderChartDiario(e.target.value);
  renderChartTop5(e.target.value);
});

// ── NAV EVENTS ────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});

document.getElementById('btn-nova-venda-top').addEventListener('click', () => goToPage('nova-venda'));

document.getElementById('menu-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ── CURRENT MONTH LABEL ───────────────────────
function setCurrentMonthLabel() {
  const now = new Date();
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  document.getElementById('current-month-label').textContent = `${names[now.getMonth()]} ${now.getFullYear()}`;
}

// Spin animation for PDF button loading state
const styleEl = document.createElement('style');
styleEl.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
document.head.appendChild(styleEl);

// ── INIT ──────────────────────────────────────
function init() {
  setCurrentMonthLabel();
  goToPage('dashboard');
}

init();
