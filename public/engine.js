const PROXY = '/api/proxy?url=';

let tabs = [];
let activeTab = null;
let tabCounter = 0;

const SHORTCUTS = [
  { icon: '🟩', label: 'Wordle', cfb: 'wordle' },
  { icon: '🎮', label: 'Games', cfb: 'games' },
  { icon: '🔍', label: 'Search', cfb: 'search' },
  { icon: '📰', label: 'News', cfb: 'news' },
  { icon: '📖', label: 'Reader', cfb: 'reader' },
  { icon: '🧮', label: 'Calc', cfb: 'calc' },
  { icon: '📋', label: 'Sites', cfb: 'websites' },
  { icon: '📝', label: 'Updates', cfb: 'updates' },
  { icon: 'W', label: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { icon: 'G', label: 'GitHub', url: 'https://github.com' },
  { icon: 'M', label: 'MDN', url: 'https://developer.mozilla.org' },
];

function newTab(url) {
  const id = ++tabCounter;
  const tab = { id, url: url || null, title: 'New Tab', history: [], histIdx: -1, loading: false, pinned: false, zoom: 1, view: null, frame: null, group: null, color: null };
  tabs.push(tab);
  activeTab = tab;
  renderTabs();
  if (url) {
    loadUrl(tab, url);
  } else {
    showNewTab(tab);
  }
}

function closeTab(id, e) {
  if (e) e.stopPropagation();
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (tabs[idx].pinned) { tabs[idx].pinned = false; renderTabs(); return; }
  disposeView(tabs[idx]);
  tabs.splice(idx, 1);
  if (activeTab && activeTab.id === id) {
    activeTab = tabs.length > 0 ? tabs[Math.max(0, idx - 1)] : null;
  }
  if (tabs.length === 0) newTab();
  renderTabs();
  renderContent();
  updateAddrBar();
  updateNavButtons();
  updateStarBtn();
}

function switchTab(id) {
  activeTab = tabs.find(t => t.id === id);
  renderTabs();
  renderContent();
  clearProxyHint();
  updateAddrBar();
  updateNavButtons();
  applyZoom();
  updateStarBtn();
}

function renderTabs() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = '<button class="newtab-btn" onclick="newTab()">+</button>';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.pinned ? ' pinned' : '') + (activeTab && activeTab.id === tab.id ? ' active' : '');
    if (tab.color) el.style.borderLeft = '3px solid ' + tab.color;
    el.onclick = () => switchTab(tab.id);
    el.ondblclick = (e) => { e.stopPropagation(); cycleTabColor(tab); };
    el.innerHTML = `<span class="pin" onclick="togglePin(${tab.id}, event)" title="Pin">P</span><span style="overflow:hidden;text-overflow:ellipsis">${tab.title}</span><span class="close" onclick="closeTab(${tab.id}, event)">×</span>`;
    bar.insertBefore(el, bar.lastChild);
  });
}

function updateAddrBar() {
  const input = document.getElementById('addrInput');
  if (activeTab && activeTab.url) {
    try {
      const u = new URL(activeTab.url);
      input.value = u.href;
    } catch {
      input.value = activeTab.url;
    }
  } else {
    input.value = '';
  }
}

function updateNavButtons() {
  if (!activeTab) return;
  document.getElementById('backBtn').disabled = activeTab.histIdx <= 0;
  document.getElementById('fwdBtn').disabled = activeTab.histIdx >= activeTab.history.length - 1;
}

