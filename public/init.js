// ===== ZOOM =====
function zoomIn() { if (!activeTab) return; activeTab.zoom = Math.min(3, (activeTab.zoom || 1) + 0.1); applyZoom(); }
function zoomOut() { if (!activeTab) return; activeTab.zoom = Math.max(0.3, (activeTab.zoom || 1) - 0.1); applyZoom(); }
function applyZoom() {
  if (!activeTab) return;
  const iframe = activeTab.frame;
  if (iframe) {
    iframe.style.transform = 'scale(' + activeTab.zoom + ')';
    iframe.style.transformOrigin = 'top left';
    iframe.style.width = (100 / activeTab.zoom) + '%';
    iframe.style.height = (100 / activeTab.zoom) + '%';
  }
  const zl = document.getElementById('zoomLevel');
  if (zl) zl.textContent = Math.round(activeTab.zoom * 100) + '%';
}

// ===== HOME =====
function goHome() { if (!activeTab) return; loadUrl(activeTab, localStorage.getItem('cfb_homepage') || 'https://www.google.com'); }

function cfbRenderCookies() {
  const el = document.getElementById('cookieList');
  if (!el) return;
  const cookies = document.cookie ? document.cookie.split(';').map(c => c.trim()) : [];
  if (!cookies.length) { el.innerHTML = '<p style="color:#888;font-size:12px;">no cookies.</p>'; return; }
  el.innerHTML = cookies.map(c => {
    const eq = c.indexOf('=');
    const name = eq > -1 ? c.slice(0, eq) : c;
    const val = eq > -1 ? c.slice(eq + 1) : '';
    return '<div class="item"><div><div class="title">' + escapeHtml(name) + '</div><div class="url">' + escapeHtml(val) + '</div></div>' +
      '<button onclick="cfbDeleteCookie(\'' + name.replace(/'/g, "\\'") + '\')">Delete</button></div>';
  }).join('');
}

function cfbDeleteCookie(name) {
  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  cfbRenderCookies();
}

function cfbAddCookie() {
  const n = document.getElementById('ckName');
  const v = document.getElementById('ckValue');
  if (!n || !v) return;
  const name = n.value.trim();
  const value = v.value.trim();
  if (!name) return;
  document.cookie = name + '=' + value + ';path=/;max-age=31536000';
  n.value = ''; v.value = '';
  cfbRenderCookies();
}

function cfbClearCookies() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
  cfbRenderCookies();
}

function cfbSetSettings() {
  const homeEl = document.getElementById('setHome');
  const themeEl = document.getElementById('setTheme');
  const directEl = document.getElementById('setDirect');
  const uaEl = document.getElementById('setUA');
  if (homeEl) { try { localStorage.setItem('cfb_homepage', homeEl.value.trim() || 'https://www.google.com'); } catch {} }
  if (themeEl) { try { localStorage.setItem('cfb_theme', themeEl.value); } catch {} }
  if (directEl) { try { localStorage.setItem('cfb_direct_domains', directEl.value); } catch {} }
  if (uaEl) { try { localStorage.setItem('cfb_ua', uaEl.value); } catch {} }
  cfbApplyTheme();
  const btn = document.querySelector('[onclick="cfbSetSettings()"]');
  if (btn) { btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = 'Save'; }, 1200); }
}

function cfbApplyTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('cfb_theme') || 'dark'; } catch {}
  document.body.className = document.body.className.replace(/theme-\S+/g, '').trim();
  if (theme !== 'dark') document.body.classList.add('theme-' + theme);
  // update select if present
  const sel = document.getElementById('setTheme');
  if (sel) sel.value = theme;
}

// apply theme on load
cfbApplyTheme();

// ===== TAB PINNING =====
function togglePin(id, e) {
  if (e) e.stopPropagation();
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  renderTabs();
}

// ===== VIEW SOURCE =====
async function viewSource() {
  if (!activeTab || !activeTab.url) return;
  const overlay = document.createElement('div');
  overlay.className = 'source-overlay';
  overlay.innerHTML = '<div class="source-panel"><div class="source-header"><h3>View Source</h3><button class="source-close" onclick="closeSourceOverlay()">X</button></div><div class="source-body"><pre>Loading...</pre></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSourceOverlay(); });
  try {
    const resp = await fetch(PROXY + encodeURIComponent(activeTab.url));
    const html = await resp.text();
    overlay.querySelector('pre').textContent = html;
  } catch (err) {
    overlay.querySelector('pre').textContent = 'Error: ' + err.message;
  }
}
function closeSourceOverlay() {
  const overlay = document.querySelector('.source-overlay');
  if (overlay) overlay.remove();
}

// ===== FIND IN PAGE =====
let findBar = null;
let findMatches = [];
let findIdx = 0;
function toggleFindBar() {
  if (findBar) { closeFindBar(); return; }
  const container = document.getElementById('findBarContainer');
  findBar = document.createElement('div');
  findBar.className = 'find-bar';
  findBar.innerHTML = '<input type="text" id="findInput" placeholder="Find in page..." oninput="doFind()" onkeydown="if(event.key===\'Enter\')findNext(); if(event.key===\'Escape\')closeFindBar();"><button onclick="findPrev()">Up</button><button onclick="findNext()">Down</button><span class="find-count" id="findCount"></span><button onclick="closeFindBar()">X</button>';
  container.appendChild(findBar);
  document.getElementById('findInput').focus();
}
function closeFindBar() {
  if (findBar) { findBar.remove(); findBar = null; }
  findMatches = []; findIdx = 0;
  const iframe = document.querySelector('iframe');
  if (iframe && iframe.contentDocument) {
    try {
      const marks = iframe.contentDocument.querySelectorAll('mark.find-highlight');
      marks.forEach(m => { const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); });
    } catch {}
  }
}
function doFind() {
  const query = document.getElementById('findInput').value;
  const iframe = document.querySelector('iframe');
  if (!iframe || !iframe.contentDocument || !query) { document.getElementById('findCount').textContent = ''; return; }
  try {
    const doc = iframe.contentDocument;
    const oldMarks = doc.querySelectorAll('mark.find-highlight');
    oldMarks.forEach(m => { const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); });
    findMatches = []; findIdx = 0;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      const text = node.textContent;
      const lower = text.toLowerCase();
      const qLower = query.toLowerCase();
      let idx = lower.indexOf(qLower);
      if (idx === -1) return;
      const frag = doc.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        frag.appendChild(doc.createTextNode(text.slice(lastIdx, idx)));
        const mark = doc.createElement('mark');
        mark.className = 'find-highlight';
        mark.style.background = '#ffd700';
        mark.style.color = '#000';
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        findMatches.push(mark);
        lastIdx = idx + query.length;
        idx = lower.indexOf(qLower, lastIdx);
      }
      frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    });
    document.getElementById('findCount').textContent = findMatches.length > 0 ? (findIdx + 1) + '/' + findMatches.length : '0 results';
    if (findMatches.length > 0) findMatches[0].scrollIntoView({ block: 'center' });
  } catch (e) {
    document.getElementById('findCount').textContent = 'error';
  }
}
function findNext() {
  if (findMatches.length === 0) return;
  findIdx = (findIdx + 1) % findMatches.length;
  findMatches[findIdx].scrollIntoView({ block: 'center' });
  document.getElementById('findCount').textContent = (findIdx + 1) + '/' + findMatches.length;
}
function findPrev() {
  if (findMatches.length === 0) return;
  findIdx = (findIdx - 1 + findMatches.length) % findMatches.length;
  findMatches[findIdx].scrollIntoView({ block: 'center' });
  document.getElementById('findCount').textContent = (findIdx + 1) + '/' + findMatches.length;
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); toggleFindBar(); }
  if (e.key === 'Escape' && findBar) closeFindBar();
  // keyboard shortcuts
  if ((e.ctrlKey || e.metaKey) && e.key === 't') { e.preventDefault(); newTab(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); if (activeTab) closeTab(activeTab.id); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); const ab = document.getElementById('addrBar'); if (ab) { ab.focus(); ab.select(); } }
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); if (activeTab) loadUrl(activeTab, activeTab.url); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); toggleBookmark(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') { e.preventDefault(); /* cycle tabs */ const tabs = allTabs(); if (tabs.length > 1) { const idx = tabs.indexOf(activeTab); const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length; activateTab(tabs[next].id); } }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') { e.preventDefault(); screenshotPage(); }
});

// Patch renderTabs to include pin
const _origRenderTabs = renderTabs;
renderTabs = function() {
  _origRenderTabs();
};
