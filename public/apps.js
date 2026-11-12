// ===== TAB VIEWS =====
// every tab keeps its own persistent view node, so switching tabs is instant and
// never re-fetches the page (and never leaves you staring at a blank content area)
function ensureView(tab) {
  if (tab.view && tab.view.isConnected) return tab.view;
  const view = document.createElement('div');
  view.className = 'tabview';
  tab.view = view;
  document.getElementById('content').appendChild(view);
  return view;
}

function showView(tab) {
  const content = document.getElementById('content');
  if (!content) return;
  Array.from(content.children).forEach(el => { el.hidden = !(tab && el === tab.view); });
}

function disposeView(tab) {
  if (tab.view) { tab.view.remove(); tab.view = null; }
  tab.frame = null;
}

function renderContent() { showView(activeTab); }

function tabView(tab) {
  const view = ensureView(tab);
  showView(tab);
  return view;
}

function setStatusText(text) {
  const el = document.getElementById('statusbar');
  if (el) el.textContent = text;
}

function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); }
}

function cleanTitle(title, url) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t || /^(loading\.\.\.|untitled|error|new tab)$/i.test(t)) return hostLabel(url);
  return t.slice(0, 80);
}

function clearProxyHint() {
  const el = document.getElementById('proxyHint');
  if (el) el.remove();
}

function showProxyHint(url, message) {
  clearProxyHint();
  const bar = document.createElement('div');
  bar.id = 'proxyHint';
  bar.className = 'proxy-hint';
  const label = document.createElement('span');
  label.textContent = message || 'this page came back blank — it probably needs javascript the proxy cannot run.';
  const open = document.createElement('button');
  open.textContent = 'open without proxy';
  open.onclick = () => window.open(url, '_blank', 'noopener');
  const close = document.createElement('button');
  close.className = 'ghost';
  close.textContent = 'dismiss';
  close.onclick = clearProxyHint;
  bar.append(label, open, close);
  document.body.appendChild(bar);
}

const CAPTCHA_SEL = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="arkoselabs"], .g-recaptcha, .h-captcha, .cf-turnstile';
const WALL_TEXT = /invalid domain for site key|error for site owner|prove your humanity|verify (that )?you are (a )?human|unusual traffic|checking your browser|captcha/i;

function checkBlank(tab, frame, url) {
  if (!tab || tab !== activeTab || tab.frame !== frame) return;
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc || !doc.body) return;

  const text = (doc.body.innerText || '').trim();

  // captcha / bot walls can never work through a proxy: the widget checks that the
  // page's domain matches the key's registered domain, and our domain is pages.dev
  let captcha = false;
  try { captcha = !!doc.querySelector(CAPTCHA_SEL); } catch {}
  if (captcha || WALL_TEXT.test(text.slice(0, 4000))) {
    showProxyHint(url, 'this site runs a captcha or bot wall tied to its own domain — a proxy can never pass it. open it directly instead.');
    return;
  }

  let empty = false;
  const media = Array.from(doc.querySelectorAll('img, video, canvas, svg, picture, iframe')).some(el => {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 40;
    } catch { return false; }
  });
  empty = text.length === 0 && !media;
  if (empty) showProxyHint(url);
}

function showNewTab(tab) {
  const view = tabView(tab);
  tab.frame = null;
  tab.loading = false;
  tab.title = 'New Tab';
  clearProxyHint();
  const tiles = SHORTCUTS.map(s => {
    const action = s.cfb ? "openCfb('" + s.cfb + "')" : "navigateTo('" + s.url + "')";
    return '<div class="shortcut" onclick="' + action + '"><div class="icon">' + s.icon + '</div><div class="label">' + s.label + '</div></div>';
  }).join('');
  view.innerHTML = '<div class="newtab"><h1>CF Browser</h1><p>enter a url, or type <b>wordle</b></p><div class="shortcuts">' +
    tiles + '</div></div>';
  renderTabs();
  updateAddrBar();
  setStatusText('New Tab');
}

function showLoading() {
  if (!activeTab) return;
  const view = tabView(activeTab);
  view.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading...</div></div>';
}

function showError(url, msg) {
  if (!activeTab) return;
  const view = tabView(activeTab);
  view.innerHTML = '<div class="error-page"><h2>⚠️ Can\'t load this page</h2><div class="url">' +
    escapeHtml(url) + '</div><div>' + escapeHtml(msg) + '</div>' +
    '<div style="margin-top:12px;font-size:12px;color:#555">some sites block proxying or need javascript that cannot run through a proxy.</div></div>';
}

function rawTarget(raw) {
  let u = String(raw || '');
  if (u.startsWith(PROXY)) u = u.slice(PROXY.length);
  try { return decodeURIComponent(u); } catch { return u; }
}

function loadIntoFrame(tab, url) {
  const view = tabView(tab);
  view.innerHTML = '';
  clearProxyHint();

  const frame = document.createElement('iframe');
  frame.className = 'webview';
  // check if domain is in always-open-direct list
  let direct = false;
  try {
    const domains = (localStorage.getItem('cfb_direct_domains') || '').split(/\n/).map(d => d.trim().toLowerCase()).filter(Boolean);
    const host = new URL(url).hostname.toLowerCase();
    direct = domains.some(d => host === d || host.endsWith('.' + d));
  } catch {}
  frame.src = direct ? url : (PROXY + encodeURIComponent(url));
  tab.frame = frame;

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    tab.loading = false;
    let title = '';
    try { title = frame.contentDocument ? frame.contentDocument.title : ''; } catch {}
    tab.title = cleanTitle(title, url);
    renderTabs();
    setStatusText('Done');
    setTimeout(() => checkBlank(tab, frame, url), 1200);
  };

  frame.onload = finish;
  frame.onerror = () => {
    settled = true;
    tab.loading = false;
    tab.title = hostLabel(url);
    renderTabs();
    showError(url, 'the proxy could not reach that page');
  };

  view.appendChild(frame);
  applyZoom();

  // never sit on "Loading..." forever
  setTimeout(() => {
    if (settled) return;
    settled = true;
    tab.loading = false;
    tab.title = cleanTitle('', url);
    renderTabs();
    setStatusText('still loading — the site may be blocking the proxy');
  }, 15000);
}

function cfbPageFrom(url) {
  const s = String(url || '').trim();
  const m = s.match(/^cf(?:b)?(?:::|:\/\/|:)\s*\/?\s*([a-z0-9_-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function loadUrl(tab, url) {
  if (!url) return;

  // internal cfb:: pages never go through the proxy
  const cfbPage = cfbPageFrom(url);
  if (cfbPage) {
    tab.url = url;
    tab.title = 'cfb::' + cfbPage;
    if (tab.histIdx < tab.history.length - 1) tab.history = tab.history.slice(0, tab.histIdx + 1);
    tab.history.push(tab.url);
    tab.histIdx = tab.history.length - 1;
    renderTabs();
    updateNavButtons();
    updateAddrBar();
    updateStarBtn();
    showCfbPage(tab, cfbPage);
    return;
  }

  // Normalize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    } else {
      // duckduckgo instead of google: google bans cloudflare worker IPs
      url = 'https://www.bing.com/search?q=' + encodeURIComponent(url);
    }
  }

  tab.url = url;
  tab.loading = true;
  tab.title = hostLabel(url);
  renderTabs();
  setStatusText('Loading ' + url + '...');

  // Add to history
  if (tab.histIdx < tab.history.length - 1) {
    tab.history = tab.history.slice(0, tab.histIdx + 1);
  }
  tab.history.push(url);
  tab.histIdx = tab.history.length - 1;
  updateNavButtons();
  updateAddrBar();
  updateStarBtn();

  loadIntoFrame(tab, url);
}

// one listener for every proxied page (previously one got added per navigation and piled up)
window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data !== 'object' || !data.type) return;
  const tab = activeTab;
  if (!tab) return;

  if (data.type === 'navigate') {
    const target = rawTarget(data.url);
    if (target) loadUrl(tab, target);
    return;
  }

  if (data.type === 'cursor') {
    const frame = tab.frame;
    if (!frame || !frame.isConnected) return;
    const r = frame.getBoundingClientRect();
    const x = (r.left + data.x * r.width) / Math.max(1, window.innerWidth);
    const y = (r.top + data.y * r.height) / Math.max(1, window.innerHeight);
    mpSendCursor(x, y);
    return;
  }

  if (data.type === 'click') {
    const frame = tab.frame;
    if (!frame || !frame.isConnected) return;
    const r = frame.getBoundingClientRect();
    const x = (r.left + data.x * r.width) / Math.max(1, window.innerWidth);
    const y = (r.top + data.y * r.height) / Math.max(1, window.innerHeight);
    mpSendClick(x, y);
    return;
  }

  if (data.type === 'scroll') {
    const frame = tab.frame;
    if (!frame || !frame.isConnected) return;
    mpSendScroll(data.y);
    return;
  }

  if (data.type === 'input') {
    const frame = tab.frame;
    if (!frame || !frame.isConnected) return;
    mpSendInput(data);
    return;
  }

  if (data.type === 'snapshot') {
    const frame = tab.frame;
    if (!frame || !frame.isConnected) return;
    mpSendSnapshot(data.html);
    return;
  }

  if (data.type === 'pageerror') {
    const frame = tab.frame;
    if (!frame || !frame.isConnected) return;
    const url = tab.url;
    let attempts = 0;
    const check = () => {
      if (!frame.isConnected || tab.frame !== frame || tab.url !== url) return;
      let visibleText = '';
      try { visibleText = (frame.contentDocument.body.innerText || '').trim(); } catch { return; }
      if (visibleText.length > 120) return; // loaded fine
      attempts++;
      if (attempts < 4) {
        setTimeout(check, 1500);
      } else {
        showProxyHint(url, 'this page may need JavaScript that cannot run through the proxy');
      }
    };
    setTimeout(check, 1500);
    return;
  }
});

// click on the page body clears the blank-page hint
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('.proxy-hint')) return;
  clearProxyHint();
}, true);

function navigate() {
  const input = document.getElementById('addrInput');
  let url = input.value.trim();
  if (!url || !activeTab) return;
  if (url.toLowerCase() === 'wordle') url = 'cfb::wordle';
  loadUrl(activeTab, url);
}

function showCfbPage(tab, page) {
  const content = document.getElementById('content');
  let html = '';
  switch (page) {
    case 'settings':
      html = '<div class="cfb-page"><h1>Settings</h1>' +
        '<div class="item"><div><div class="title">Homepage</div><div class="url">used by the Home button</div></div>' +
        '<input id="setHome" type="text" value="' + escapeHtml(localStorage.getItem('cfb_homepage') || 'https://www.google.com') +
        '" style="width:230px;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;"></div>' +
        '<div class="item"><div><div class="title">Theme</div><div class="url">color scheme</div></div>' +
        '<select id="setTheme" style="padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
        '<option value="dark">dark (default)</option>' +
        '<option value="light">light</option>' +
        '<option value="midnight">midnight (cyan)</option>' +
        '<option value="forest">forest (green)</option>' +
        '<option value="sunset">sunset (orange)</option>' +
        '</select></div>' +
        '<div class="item"><div><div class="title">Always open direct</div><div class="url">domains to skip the proxy (one per line)</div></div>' +
        '<textarea id="setDirect" style="width:230px;height:60px;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;resize:vertical;font-family:inherit;" placeholder="reddit.com">' + (localStorage.getItem('cfb_direct_domains') || '') + '</textarea></div>' +
        '<div class="item"><div><div class="title">User Agent</div><div class="url">pretend to be a different browser</div></div>' +
        '<select id="setUA" style="padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
        '<option value="">default (chrome)</option>' +
        '<option value="mobile">mobile chrome (android)</option>' +
        '<option value="firefox">firefox desktop</option>' +
        '<option value="safari">safari (mac)</option>' +
        '</select></div>' +
        '<div class="item"><div><div class="title">Sessions</div><div class="url">save/restore tab sessions</div></div>' +
        '<div style="display:flex;gap:6px;">' +
        '<button onclick="cfbSaveSession()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Save</button>' +
        '<button onclick="cfbLoadSession()" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Load</button>' +
        '<button onclick="cfbDeleteSession()" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Delete</button>' +
        '</div></div>' +
        '<div style="margin-top:14px;display:flex;gap:8px;">' +
        '<button onclick="cfbSetSettings()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">Save</button>' +
        '<button onclick="if(confirm(\'clear all browser data?\')){localStorage.clear();location.reload();}" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">Reset all data</button>' +
        '</div></div>';
      break;
    case 'cookies':
      html = '<div class="cfb-page"><h1>Cookies</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">cookies stored by the browser shell (proxied sites keep their own, forwarded where possible).</p>' +
        '<div id="cookieList" style="margin-bottom:12px;"></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<input id="ckName" placeholder="name" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
        '<input id="ckValue" placeholder="value" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
        '<button onclick="cfbAddCookie()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Add</button>' +
        '<button onclick="cfbClearCookies()" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Clear all</button>' +
        '</div>' +
        '</div>';
      break;
    case 'bookmarks':
      html = '<div class="cfb-page"><h1>Bookmarks</h1>';
      if (bookmarks.length === 0) html += '<div class="empty">No bookmarks yet.</div>';
      else bookmarks.forEach(bm => {
        html += '<div class="item"><div><div class="title">' + escapeHtml(bm.title) + '</div><div class="url">' + escapeHtml(bm.url) + '</div></div><button onclick="loadUrl(activeTab, \'' + bm.url.replace(/'/g, "\\'") + '\')">Open</button></div>';
      });
      html += '</div>';
      break;
    case 'history':
      html = '<div class="cfb-page"><h1>History</h1>' +
        '<input id="histSearch" type="text" placeholder="search history..." style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:13px;margin-bottom:12px;" oninput="cfbFilterHistory()">';
      const hist = tab.history || [];
      html += '<div id="histList">';
      if (hist.length === 0) html += '<div class="empty">No history yet.</div>';
      else hist.slice().reverse().forEach(url => {
        html += '<div class="item hist-item"><div class="url">' + escapeHtml(url) + '</div><button onclick="loadUrl(activeTab, \'' + url.replace(/'/g, "\\'") + '\')">Open</button></div>';
      });
      html += '</div></div>';
      break;
    case 'wordle':
      html = wdlPage();
      break;
    case 'games':
      html = '<div class="cfb-page"><h1>Games</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">little browser games that work offline, no proxy needed.</p>' +
        '<div class="item"><div><div class="title">Wordle</div><div class="url">guess the 5-letter word in 6 tries</div></div><button onclick="openCfb(\'wordle\')">Play</button></div>' +
        '<div class="item"><div><div class="title">Tic-Tac-Toe</div><div class="url">classic 3x3, play vs a friend or the cpu</div></div><button onclick="openCfb(\'tictactoe\')">Play</button></div>' +
        '<div class="item"><div><div class="title">Snake</div><div class="url">eat food grow longer dont hit walls</div></div><button onclick="openCfb(\'snake\')">Play</button></div>' +
        '<div class="item"><div><div class="title">2048</div><div class="url">slide tiles to reach 2048</div></div><button onclick="openCfb(\'g2048\')">Play</button></div>' +
        '<div class="item"><div><div class="title">Minesweeper</div><div class="url">find all mines without exploding</div></div><button onclick="openCfb(\'mines\')">Play</button></div>' +
        '</div>';
      break;
    case 'tictactoe':
      html = tttPage();
      break;
    case 'passwords':
      html = cfbPasswordsPage();
      break;
    case 'rss':
      html = cfbRssPage();
      break;
    case 'split':
      html = cfbSplitPage();
      break;
    case 'snake':
      html = snakePage();
      break;
    case 'g2048':
      html = g2048Page();
      break;
    case 'mines':
      html = minesPage();
      break;
    case 'search':
      html = '<div class="cfb-page"><h1>Search</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">search the web. results are fetched and displayed here (no bing homepage needed).</p>' +
        '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<input id="cfbSearchInput" type="text" placeholder="search the web..." style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:13px;" onkeydown="if(event.key===\'Enter\')cfbSearch()">' +
        '<button onclick="cfbSearch()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Search</button>' +
        '</div>' +
        '<div id="cfbSearchResults"></div>' +
        '</div>';
      break;
    case 'news':
      html = '<div class="cfb-page"><h1>News</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">publishers that work through the proxy.</p>' +
        '<div class="item"><div><div class="title">NPR</div><div class="url">npr.org</div></div><button onclick="loadUrl(activeTab,\'https://www.npr.org\')">Open</button></div>' +
        '<div class="item"><div><div class="title">The Guardian</div><div class="url">theguardian.com</div></div><button onclick="loadUrl(activeTab,\'https://www.theguardian.com/international\')">Open</button></div>' +
        '<div class="item"><div><div class="title">Ars Technica</div><div class="url">arstechnica.com</div></div><button onclick="loadUrl(activeTab,\'https://arstechnica.com\')">Open</button></div>' +
        '<div class="item"><div><div class="title">Hackaday</div><div class="url">hackaday.com</div></div><button onclick="loadUrl(activeTab,\'https://hackaday.com\')">Open</button></div>' +
        '<div class="item"><div><div class="title">Lobsters</div><div class="url">lobste.rs</div></div><button onclick="loadUrl(activeTab,\'https://lobste.rs\')">Open</button></div>' +
        '</div>';
      break;
    case 'updates':
      html = '<div class="cfb-page"><h1>Update Log</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:16px;">what changed in cf-browser.</p>' +
        '<div style="border-left:2px solid var(--accent);padding-left:14px;margin-bottom:16px;">' +
        '<div style="font-weight:600;color:var(--accent);font-size:12px;">v1.2 — ui rework + polish</div>' +
        '<div style="color:var(--text2);font-size:12px;margin-top:4px;">modern dark theme with css variables, 5 color themes (dark/light/midnight/forest/sunset), glassmorphism, better tabs, custom scrollbars, smoother transitions. theme picker in settings.</div></div>' +
        '<div style="border-left:2px solid var(--border2);padding-left:14px;margin-bottom:16px;">' +
        '<div style="font-weight:600;color:var(--text2);font-size:12px;">v1.1 — multiplayer presence</div>' +
        '<div style="color:var(--text3);font-size:12px;margin-top:4px;">live cursors, click ripples, scroll sync, nav sync modes (off/host/all), follow toggle, cursors toggle, draggable chat, shared wordle (guesses sync), webrtc screen sharing, auto-sync form inputs + dom snapshots.</div></div>' +
        '<div style="border-left:2px solid var(--border2);padding-left:14px;margin-bottom:16px;">' +
        '<div style="font-weight:600;color:var(--text2);font-size:12px;">v1.0 — core browser</div>' +
        '<div style="color:var(--text3);font-size:12px;margin-top:4px;">tabs, address bar, history, bookmarks, settings, find in page, zoom, tab pinning, view source, right-click menu, downloads, cookie manager. per-tab persistent views so switching never reloads.</div></div>' +
        '<div style="border-left:2px solid var(--border2);padding-left:14px;margin-bottom:16px;">' +
        '<div style="font-weight:600;color:var(--text2);font-size:12px;">proxy fixes</div>' +
        '<div style="color:var(--text3);font-size:12px;margin-top:4px;">fixed blank pages (rendercontent was undefined), youtube securityerror (relative proxy url), loading stuck forever (15s watchdog), captcha/bot wall detection with explanation bar, bing search form interception, subresource url rewriting for js apps.</div></div>' +
        '<div style="border-left:2px solid var(--border2);padding-left:14px;margin-bottom:16px;">' +
        '<div style="font-weight:600;color:var(--text2);font-size:12px;">cfb:: pages</div>' +
        '<div style="color:var(--text3);font-size:12px;margin-top:4px;">wordle (daily + practice, share, stats), tic-tac-toe, search (fetches bing results inline), news (working publishers), websites (tested site list), settings, cookies, bookmarks, history, about.</div></div>' +
        '</div>';
      break;
    case 'reader':
      html = '<div class="cfb-page"><h1>Reader Mode</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">paste a url to read just the article text, no ads or clutter.</p>' +
        '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<input id="readerUrl" type="text" placeholder="https://..." style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:13px;" onkeydown="cfbReaderKey(event)">' +
        '<button onclick="cfbReader()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Read</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
         '<button onclick="cfbReaderFontSize(-2)" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">A-</button>' +
         '<button onclick="cfbReaderFontSize(2)" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">A+</button>' +
         '</div>' +
         '<div id="readerContent" style="line-height:1.7;color:var(--text2);font-size:14px;"></div>' +
        '</div>';
      break;
    case 'calc':
      html = '<div class="cfb-page"><h1>Calculator</h1>' +
        '<div style="max-width:280px;margin:0 auto;">' +
        '<input id="calcDisplay" readonly style="width:100%;padding:12px;font-size:24px;text-align:right;border-radius:8px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;margin-bottom:8px;font-family:monospace;">' +
        '<div id="calcKeys" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;"></div>' +
        '</div>' +
        '</div>';
      break;
    case 'notes':
      html = '<div class="cfb-page"><h1>Notes</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:12px;">saved locally in your browser.</p>' +
        '<textarea id="notesArea" style="width:100%;height:60vh;padding:12px;border-radius:8px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:13px;resize:vertical;font-family:inherit;" oninput="cfbSaveNotes()"></textarea>' +
        '</div>';
      break;
    case 'terminal':
      html = '<div class="cfb-page"><h1>Terminal</h1>' +
        '<div id="termOutput" style="background:#0a0a14;color:#4ade80;font-family:monospace;font-size:12px;padding:12px;border-radius:8px;height:50vh;overflow:auto;margin-bottom:8px;white-space:pre-wrap;"></div>' +
        '<div style="display:flex;gap:8px;">' +
        '<span style="color:#4ade80;font-family:monospace;font-size:12px;line-height:28px;">$</span>' +
        '<input id="termInput" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#4ade80;font-size:12px;font-family:monospace;" onkeydown="cfbTermKey(event)">' +
        '</div>' +
        '</div>';
      break;
    case 'translate':
      html = '<div class="cfb-page"><h1>Translate</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">translate text using a free translation service.</p>' +
        '<textarea id="transInput" placeholder="enter text to translate..." style="width:100%;height:120px;padding:12px;border-radius:8px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:13px;resize:vertical;font-family:inherit;margin-bottom:8px;"></textarea>' +
        '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
        '<select id="transLang" style="padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
        '<option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option>' +
        '<option value="it">Italian</option><option value="pt">Portuguese</option><option value="ja">Japanese</option>' +
        '<option value="ko">Korean</option><option value="zh">Chinese</option><option value="ru">Russian</option>' +
        '<option value="ar">Arabic</option></select>' +
        '<button onclick="cfbTranslate()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Translate</button>' +
        '</div>' +
        '<div id="transOutput" style="padding:12px;border-radius:8px;background:var(--bg3);color:var(--text2);font-size:13px;min-height:60px;"></div>' +
        '</div>';
      break;
    case 'extensions':
      html = '<div class="cfb-page"><h1>Extensions</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">inject custom css/js into proxied pages.</p>' +
        '<textarea id="extCss" placeholder="/* custom css */" style="width:100%;height:120px;padding:12px;border-radius:8px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;font-family:monospace;resize:vertical;margin-bottom:8px;"></textarea>' +
        '<textarea id="extJs" placeholder="// custom js" style="width:100%;height:120px;padding:12px;border-radius:8px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;font-family:monospace;resize:vertical;margin-bottom:8px;"></textarea>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="cfbSaveExt()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Save</button>' +
        '<button onclick="cfbClearExt()" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Clear</button>' +
        '</div>' +
        '<p style="color:#666;font-size:11px;margin-top:8px;">extensions are stored locally and applied to every proxied page.</p>' +
        '</div>';
      break;
    case 'devtools':
      html = '<div class="cfb-page"><h1>DevTools</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">inspect the current page.</p>' +
        '<div id="devtoolsInfo" style="font-family:monospace;font-size:12px;color:var(--text2);white-space:pre-wrap;background:var(--bg3);padding:12px;border-radius:8px;max-height:60vh;overflow:auto;"></div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;">' +
        '<button onclick="cfbInspect()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Inspect Page</button>' +
        '</div>' +
        '</div>';
      break;
    case 'websites':
      html = '<div class="cfb-page"><h1>Sites that work</h1>' +
        '<p style="color:#888;font-size:12px;margin-bottom:14px;">tested against the live proxy. a site works if its html already contains the content.</p>' +
        '<h3 style="color:#7c5cff;font-size:13px;margin:12px 0 6px;">works great</h3>' +
        '<div class="item"><div class="title">wikipedia.org</div><div class="url">full articles</div></div>' +
        '<div class="item"><div class="title">github.com</div><div class="url">repos, code, profiles</div></div>' +
        '<div class="item"><div class="title">developer.mozilla.org</div><div class="url">full docs</div></div>' +
        '<div class="item"><div class="title">docs.python.org</div><div class="url">full docs</div></div>' +
        '<div class="item"><div class="title">theguardian.com</div><div class="url">full articles</div></div>' +
        '<div class="item"><div class="title">npr.org</div><div class="url">full articles</div></div>' +
        '<div class="item"><div class="title">arstechnica.com</div><div class="url">full articles</div></div>' +
        '<div class="item"><div class="title">hackaday.com</div><div class="url">full articles</div></div>' +
        '<div class="item"><div class="title">lobste.rs</div><div class="url">fully renders</div></div>' +
        '<div class="item"><div class="title">itch.io</div><div class="url">store pages</div></div>' +
        '<div class="item"><div class="title">gutenberg.org</div><div class="url">full books</div></div>' +
        '<div class="item"><div class="title">craigslist.org</div><div class="url">listings</div></div>' +
        '<div class="item"><div class="title">search.marginalia.nu</div><div class="url">works</div></div>' +
        '<div class="item"><div class="title">bing.com</div><div class="url">search results render</div></div>' +
        '<div class="item"><div class="title">duckduckgo.com</div><div class="url">captcha wall now</div></div>' +
        '<div class="item"><div class="title">neal.fun</div><div class="url">works</div></div>' +
        '<div class="item"><div class="title">spacejam.com/1996</div><div class="url">the whole 1996 site</div></div>' +
        '<div class="item"><div class="title">cloudflare.com</div><div class="url">everything</div></div>' +
        '<div class="item"><div class="title">nytimes.com/games/wordle</div><div class="url">wordle works now (js handling upgrade)</div></div>' +
        '<div class="item"><div class="title">youtube.com</div><div class="url">partial (js heavy, some content loads)</div></div>' +
        '<div class="item"><div class="title">roblox.com</div><div class="url">more renders now (dynamic scripts proxied)</div></div>' +
        '<h3 style="color:#e2685f;font-size:13px;margin:16px 0 6px;">dead on arrival (bot wall)</h3>' +
        '<div class="item"><div class="title">reddit.com</div><div class="url">blocked by network security</div></div>' +
        '<div class="item"><div class="title">old.reddit.com</div><div class="url">same block</div></div>' +
        '<div class="item"><div class="title">stackoverflow.com</div><div class="url">cloudflare challenge</div></div>' +
        '<div class="item"><div class="title">apnews.com</div><div class="url">just a moment...</div></div>' +
        '<div class="item"><div class="title">bbc.com/news</div><div class="url">access denied</div></div>' +
        '<div class="item"><div class="title">amazon.com</div><div class="url">blank, needs js</div></div>' +
        '<div class="item"><div class="title">ebay.com</div><div class="url">something went wrong</div></div>' +
        '<div class="item"><div class="title">news.ycombinator.com</div><div class="url">returns Sorry</div></div>' +
        '<div class="item"><div class="title">mcmansionhell.com</div><div class="url">checking your browser</div></div>' +
        '<div class="item"><div class="title">scratch.mit.edu</div><div class="url">js-only</div></div>' +
        '<h3 style="color:#b39321;font-size:13px;margin:16px 0 6px;">half dead (shell loads, content does not)</h3>' +
        '<div class="item"><div class="title">twitter.com / x.com</div><div class="url">login wall only</div></div>' +
        '<div class="item"><div class="title">roblox.com</div><div class="url">footer + nav only</div></div>' +
        '<div class="item"><div class="title">youtube.com</div><div class="url">blank (crashes on history api)</div></div>' +
        '<div class="item"><div class="title">reuters.com</div><div class="url">blank</div></div>' +
        '<p style="color:#666;font-size:11px;margin-top:16px;">rule: a site works if its html already contains the content. it dies if it is a js app, behind cloudflare/akamai bot protection, behind a login, or uses a captcha (captchas check the page domain against the key, and a proxy domain is always wrong).</p>' +
        '</div>';
      break;
    case 'about':
html = '<div class="cfb-page"><div class="about"><div class="logo">🌐</div><h1>CF Browser</h1><p>Version 1.0</p><p>Powered by Cloudflare Pages + Workers</p><p style="margin-top:16px;color:#555;font-size:11px;">' +
      ['settings','bookmarks','history','cookies','wordle','games','search','news','reader','calc','notes','terminal','shortcuts','downloads','translate','extensions','devtools','websites','updates','about'].map(p =>
        '<span style="cursor:pointer;color:#7c5cff;" onclick="openCfb(\'' + p + '\')">' + p + '</span>').join(' · ') +
      '</p></div></div>';
      break;
    default:
      html = '<div class="cfb-page"><h1>Unknown page</h1><p style="color:#aaa;">cfb::' + escapeHtml(page) + ' is not valid.</p><p style="color:#666;font-size:12px;margin-top:12px;">Available: settings, bookmarks, history, cookies, wordle, games, search, news, reader, calc, notes, terminal, shortcuts, downloads, translate, extensions, devtools, websites, updates, about</p></div>';
  }
  const view = tabView(tab);
  view.innerHTML = html;
  if (page === 'wordle') wdlInit();
  if (page === 'tictactoe') { tttState = { board: Array(9).fill(''), turn: 'X', mode: tttState.mode || 'pvp', over: false, winner: null }; setTimeout(tttRender, 0); }
  if (page === 'cookies') setTimeout(cfbRenderCookies, 0);
  if (page === 'calc') setTimeout(cfbInitCalc, 0);
  if (page === 'notes') setTimeout(cfbLoadNotes, 0);
  if (page === 'terminal') setTimeout(() => cfbTermPrint('cf-browser terminal v1.0\ntype \'help\' for commands.'), 0);
  if (page === 'devtools') setTimeout(cfbInspect, 0);
  if (page === 'extensions') {
    setTimeout(() => {
      const css = document.getElementById('extCss');
      const js = document.getElementById('extJs');
      if (css) css.value = localStorage.getItem('cfb_ext_css') || '';
      if (js) js.value = localStorage.getItem('cfb_ext_js') || '';
    }, 0);
  }
  tab.frame = null;
  tab.loading = false;
  clearProxyHint();
  setStatusText('cfb::' + page);
}

function openCfb(page) {
  if (!activeTab) newTab();
  loadUrl(activeTab, 'cfb::' + page);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== TIC-TAC-TOE =====
function tttPage() {
  return '<div class="cfb-page"><h1>Tic-Tac-Toe</h1>' +
    '<div class="wd-sub" style="margin-bottom:10px;">play vs a friend on the same screen, or vs the cpu</div>' +
    '<div id="tttBoard" style="display:grid;grid-template-columns:repeat(3,70px);gap:6px;margin:0 auto 12px;"></div>' +
    '<div id="tttMsg" style="text-align:center;font-size:13px;color:#9a9ab0;height:18px;margin-bottom:10px;"></div>' +
    '<div style="display:flex;gap:8px;justify-content:center;">' +
    '<button onclick="tttMode(\'pvp\')" style="background:transparent;border:1px solid #34344c;color:#9a9ab0;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;">vs friend</button>' +
    '<button onclick="tttMode(\'cpu\')" style="background:transparent;border:1px solid #34344c;color:#9a9ab0;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;">vs cpu</button>' +
    '<button onclick="tttReset()" style="background:transparent;border:1px solid #34344c;color:#9a9ab0;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;">reset</button>' +
    '</div></div>';
}

let tttState = { board: Array(9).fill(''), turn: 'X', mode: 'pvp', over: false };
function tttRender() {
  const el = document.getElementById('tttBoard');
  if (!el) return;
  el.innerHTML = '';
  tttState.board.forEach((v, i) => {
    const cell = document.createElement('div');
    cell.style.cssText = 'width:70px;height:70px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;border-radius:8px;border:2px solid #2e2e48;background:#12121c;color:#fff;cursor:pointer;';
    cell.textContent = v;
    if (v === 'X') cell.style.color = '#7c5cff';
    if (v === 'O') cell.style.color = '#56d18a';
    cell.onclick = () => tttMove(i);
    el.appendChild(cell);
  });
  const msg = document.getElementById('tttMsg');
  if (msg) {
    if (tttState.over) {
      if (tttState.winner === 'draw') msg.textContent = "it's a draw";
      else msg.textContent = tttState.winner + ' wins!';
    } else {
      msg.textContent = tttState.turn + "'s turn";
    }
  }
}

function tttCheckWin(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,c,d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  if (b.every(x => x)) return 'draw';
  return null;
}

function tttMove(i) {
  if (tttState.over || tttState.board[i]) return;
  tttState.board[i] = tttState.turn;
  const w = tttCheckWin(tttState.board);
  if (w) { tttState.over = true; tttState.winner = w; }
  else { tttState.turn = tttState.turn === 'X' ? 'O' : 'X'; }
  tttRender();
  if (!tttState.over && tttState.mode === 'cpu' && tttState.turn === 'O') {
    setTimeout(tttCpuMove, 300);
  }
}

function tttCpuMove() {
  if (tttState.over) return;
  // simple: try to win, block, center, corner, else random
  const b = tttState.board;
  let move = -1;
  // win
  for (let i = 0; i < 9; i++) {
    if (!b[i]) { b[i] = 'O'; if (tttCheckWin(b) === 'O') { move = i; b[i] = ''; break; } b[i] = ''; }
  }
  // block
  if (move < 0) for (let i = 0; i < 9; i++) {
    if (!b[i]) { b[i] = 'X'; if (tttCheckWin(b) === 'X') { move = i; b[i] = ''; break; } b[i] = ''; }
  }
  // center
  if (move < 0 && !b[4]) move = 4;
  // corners
  if (move < 0) { const corners = [0,2,6,8].filter(i => !b[i]); if (corners.length) move = corners[Math.floor(Math.random()*corners.length)]; }
  // sides
  if (move < 0) { const sides = [1,3,5,7].filter(i => !b[i]); if (sides.length) move = sides[Math.floor(Math.random()*sides.length)]; }
  if (move >= 0) tttMove(move);
}

function tttMode(m) { tttState.mode = m; tttReset(); }
function tttReset() { tttState = { board: Array(9).fill(''), turn: 'X', mode: tttState.mode, over: false, winner: null }; tttRender(); }

// ===== SNAKE =====
let snakeState = null, snakeTimer = null;
function snakePage() {
  return '<div class="cfb-page"><h1>Snake</h1>' +
    '<div class="wd-sub" style="margin-bottom:10px;">arrow keys or wasd to move. eat food, grow, don\'t hit walls.</div>' +
    '<div id="snakeScore" style="text-align:center;font-size:14px;color:#9a9ab0;margin-bottom:8px;">score: 0</div>' +
    '<canvas id="snakeCanvas" width="300" height="300" style="display:block;margin:0 auto;border:2px solid #2e2e48;border-radius:8px;background:#0a0a14;"></canvas>' +
    '<div style="text-align:center;margin-top:10px;"><button onclick="snakeStart()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">start / restart</button></div>' +
    '</div>';
}
function snakeStart() {
  const c = document.getElementById('snakeCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const grid = 15, cell = c.width / grid;
  snakeState = { snake: [{x:7,y:7}], dir: {x:1,y:0}, food: {x:5,y:5}, score: 0, over: false, grid, cell };
  snakeSpawnFood();
  if (snakeTimer) clearInterval(snakeTimer);
  snakeTimer = setInterval(snakeTick, 120);
  document.onkeydown = snakeKey;
  snakeDraw();
}
function snakeSpawnFood() {
  const s = snakeState;
  if (!s) return;
  let ok = false;
  while (!ok) {
    s.food = { x: Math.floor(Math.random()*s.grid), y: Math.floor(Math.random()*s.grid) };
    ok = !s.snake.some(p => p.x === s.food.x && p.y === s.food.y);
  }
}
function snakeKey(e) {
  const s = snakeState;
  if (!s || s.over) return;
  const k = e.key.toLowerCase();
  if ((k === 'arrowup' || k === 'w') && s.dir.y !== 1) s.dir = {x:0,y:-1};
  else if ((k === 'arrowdown' || k === 's') && s.dir.y !== -1) s.dir = {x:0,y:1};
  else if ((k === 'arrowleft' || k === 'a') && s.dir.x !== 1) s.dir = {x:-1,y:0};
  else if ((k === 'arrowright' || k === 'd') && s.dir.x !== -1) s.dir = {x:1,y:0};
  e.preventDefault();
}
function snakeTick() {
  const s = snakeState;
  if (!s || s.over) return;
  const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
  if (head.x < 0 || head.x >= s.grid || head.y < 0 || head.y >= s.grid || s.snake.some(p => p.x === head.x && p.y === head.y)) {
    s.over = true;
    clearInterval(snakeTimer);
    snakeDraw();
    const sc = document.getElementById('snakeScore');
    if (sc) sc.textContent = 'game over! score: ' + s.score;
    return;
  }
  s.snake.unshift(head);
  if (head.x === s.food.x && head.y === s.food.y) {
    s.score++;
    const sc = document.getElementById('snakeScore');
    if (sc) sc.textContent = 'score: ' + s.score;
    snakeSpawnFood();
  } else {
    s.snake.pop();
  }
  snakeDraw();
}
function snakeDraw() {
  const s = snakeState;
  const c = document.getElementById('snakeCanvas');
  if (!c || !s) return;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, c.width, c.height);
  // grid
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= s.grid; i++) {
    ctx.beginPath(); ctx.moveTo(i*s.cell, 0); ctx.lineTo(i*s.cell, c.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*s.cell); ctx.lineTo(c.width, i*s.cell); ctx.stroke();
  }
  // food
  ctx.fillStyle = '#e2685f';
  ctx.fillRect(s.food.x*s.cell+2, s.food.y*s.cell+2, s.cell-4, s.cell-4);
  // snake
  s.snake.forEach((p, i) => {
    ctx.fillStyle = i === 0 ? '#7c5cff' : '#56d18a';
    ctx.fillRect(p.x*s.cell+1, p.y*s.cell+1, s.cell-2, s.cell-2);
  });
  if (s.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', c.width/2, c.height/2);
  }
}

// ===== 2048 =====
let g2048Board = null, g2048Score = 0, g2048Over = false;
function g2048Page() {
  return '<div class="cfb-page"><h1>2048</h1>' +
    '<div class="wd-sub" style="margin-bottom:10px;">arrow keys to slide. combine tiles to reach 2048.</div>' +
    '<div id="g2048Score" style="text-align:center;font-size:14px;color:#9a9ab0;margin-bottom:8px;">score: 0</div>' +
    '<div id="g2048Board" style="display:grid;grid-template-columns:repeat(4,70px);gap:6px;margin:0 auto 12px;width:306px;"></div>' +
    '<div style="text-align:center;margin-top:10px;"><button onclick="g2048Start()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">new game</button></div>' +
    '</div>';
}
function g2048Start() {
  g2048Board = Array(16).fill(0);
  g2048Score = 0; g2048Over = false;
  g2048AddTile(); g2048AddTile();
  g2048Render();
  document.onkeydown = g2048Key;
}
function g2048AddTile() {
  const empty = g2048Board.map((v,i) => v === 0 ? i : -1).filter(i => i >= 0);
  if (!empty.length) return;
  const idx = empty[Math.floor(Math.random() * empty.length)];
  g2048Board[idx] = Math.random() < 0.9 ? 2 : 4;
}
function g2048Render() {
  const el = document.getElementById('g2048Board');
  if (!el) return;
  el.innerHTML = '';
  g2048Board.forEach(v => {
    const cell = document.createElement('div');
    cell.style.cssText = 'width:70px;height:70px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;border-radius:8px;background:' + (v ? '#1e1e3a' : '#12121c') + ';color:#fff;';
    cell.textContent = v || '';
    if (v === 2) cell.style.color = '#aaa';
    if (v === 4) cell.style.color = '#ddd';
    if (v >= 8) cell.style.color = '#7c5cff';
    if (v >= 128) cell.style.color = '#56d18a';
    if (v >= 512) cell.style.color = '#f59e0b';
    if (v >= 2048) cell.style.color = '#e2685f';
    el.appendChild(cell);
  });
  const sc = document.getElementById('g2048Score');
  if (sc) sc.textContent = 'score: ' + g2048Score + (g2048Over ? ' (game over)' : '');
}
function g2048Slide(row) {
  const arr = row.filter(x => x);
  const merged = [];
  let i = 0;
  while (i < arr.length) {
    if (i + 1 < arr.length && arr[i] === arr[i+1]) {
      merged.push(arr[i] * 2);
      g2048Score += arr[i] * 2;
      i += 2;
    } else {
      merged.push(arr[i]);
      i++;
    }
  }
  while (merged.length < 4) merged.push(0);
  return merged;
}
function g2048Move(dir) {
  if (g2048Over) return;
  const b = g2048Board.slice();
  let moved = false;
  if (dir === 'left') {
    for (let r = 0; r < 4; r++) {
      const row = [b[r*4], b[r*4+1], b[r*4+2], b[r*4+3]];
      const slid = g2048Slide(row);
      for (let c = 0; c < 4; c++) { if (b[r*4+c] !== slid[c]) moved = true; b[r*4+c] = slid[c]; }
    }
  } else if (dir === 'right') {
    for (let r = 0; r < 4; r++) {
      const row = [b[r*4+3], b[r*4+2], b[r*4+1], b[r*4]];
      const slid = g2048Slide(row);
      for (let c = 0; c < 4; c++) { if (b[r*4+3-c] !== slid[c]) moved = true; b[r*4+3-c] = slid[c]; }
    }
  } else if (dir === 'up') {
    for (let c = 0; c < 4; c++) {
      const col = [b[c], b[c+4], b[c+8], b[c+12]];
      const slid = g2048Slide(col);
      for (let r = 0; r < 4; r++) { if (b[r*4+c] !== slid[r]) moved = true; b[r*4+c] = slid[r]; }
    }
  } else if (dir === 'down') {
    for (let c = 0; c < 4; c++) {
      const col = [b[c+12], b[c+8], b[c+4], b[c]];
      const slid = g2048Slide(col);
      for (let r = 0; r < 4; r++) { if (b[(3-r)*4+c] !== slid[r]) moved = true; b[(3-r)*4+c] = slid[r]; }
    }
  }
  if (moved) {
    g2048Board = b;
    g2048AddTile();
    // check game over
    if (!g2048Board.includes(0)) {
      let canMove = false;
      for (let i = 0; i < 16; i++) {
        const r = Math.floor(i/4), c = i%4;
        if (c < 3 && g2048Board[i] === g2048Board[i+1]) canMove = true;
        if (r < 3 && g2048Board[i] === g2048Board[i+4]) canMove = true;
      }
      if (!canMove) g2048Over = true;
    }
    g2048Render();
  }
}
function g2048Key(e) {
  if (!g2048Board) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') g2048Move('left');
  else if (k === 'arrowright' || k === 'd') g2048Move('right');
  else if (k === 'arrowup' || k === 'w') g2048Move('up');
  else if (k === 'arrowdown' || k === 's') g2048Move('down');
  e.preventDefault();
}

// ===== MINESWEEPER =====
let minesState = null;
function minesPage() {
  return '<div class="cfb-page"><h1>Minesweeper</h1>' +
    '<div class="wd-sub" style="margin-bottom:10px;">left click to reveal, right click to flag. find all mines.</div>' +
    '<div id="minesInfo" style="text-align:center;font-size:14px;color:#9a9ab0;margin-bottom:8px;">mines: 10 | flags: 0</div>' +
    '<div id="minesBoard" style="display:grid;grid-template-columns:repeat(9,32px);gap:2px;margin:0 auto 12px;width:306px;"></div>' +
    '<div style="text-align:center;margin-top:10px;display:flex;gap:8px;justify-content:center;">' +
    '<button onclick="minesStart(9,9,10)" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">easy (9x9)</button>' +
    '<button onclick="minesStart(12,12,20)" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">medium (12x12)</button>' +
    '<button onclick="minesStart(16,16,40)" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;">hard (16x16)</button>' +
    '</div>' +
    '</div>';
}
function minesStart(rows, cols, mines) {
  minesState = { rows, cols, mines, board: [], revealed: [], flagged: [], over: false, won: false, firstClick: true };
  for (let i = 0; i < rows * cols; i++) { minesState.board.push(0); minesState.revealed.push(false); minesState.flagged.push(false); }
  minesRender();
}
function minesPlaceMines(safeIdx) {
  const s = minesState;
  const total = s.rows * s.cols;
  let placed = 0;
  while (placed < s.mines) {
    const idx = Math.floor(Math.random() * total);
    if (idx === safeIdx || s.board[idx] === -1) continue;
    s.board[idx] = -1;
    placed++;
  }
  // calculate numbers
  for (let i = 0; i < total; i++) {
    if (s.board[i] === -1) continue;
    const r = Math.floor(i / s.cols), c = i % s.cols;
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= s.rows || nc < 0 || nc >= s.cols) continue;
      if (s.board[nr * s.cols + nc] === -1) count++;
    }
    s.board[i] = count;
  }
}
function minesReveal(idx) {
  const s = minesState;
  if (s.over || s.revealed[idx] || s.flagged[idx]) return;
  if (s.firstClick) { s.firstClick = false; minesPlaceMines(idx); }
  s.revealed[idx] = true;
  if (s.board[idx] === -1) { s.over = true; minesRender(); return; }
  if (s.board[idx] === 0) {
    const r = Math.floor(idx / s.cols), c = idx % s.cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= s.rows || nc < 0 || nc >= s.cols) continue;
      minesReveal(nr * s.cols + nc);
    }
  }
  // check win
  const unrevealed = s.revealed.filter((v, i) => !v && s.board[i] !== -1).length;
  if (unrevealed === 0) { s.won = true; s.over = true; }
  minesRender();
}
function minesToggleFlag(idx) {
  const s = minesState;
  if (s.over || s.revealed[idx]) return;
  s.flagged[idx] = !s.flagged[idx];
  minesRender();
}
function minesRender() {
  const s = minesState;
  const el = document.getElementById('minesBoard');
  if (!el || !s) return;
  el.style.gridTemplateColumns = 'repeat(' + s.cols + ',32px)';
  el.style.width = (s.cols * 34) + 'px';
  el.innerHTML = '';
  for (let i = 0; i < s.rows * s.cols; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border-radius:4px;background:#12121c;border:1px solid #2e2e48;cursor:pointer;user-select:none;';
    if (s.revealed[i]) {
      cell.style.background = '#1a1a2e';
      if (s.board[i] === -1) { cell.textContent = '💣'; cell.style.background = '#3a1a1a'; }
      else if (s.board[i] > 0) { cell.textContent = s.board[i]; const colors = ['#7c5cff','#56d18a','#f59e0b','#e2685f','#a78bfa','#38bdf8','#f472b6','#fb923c']; cell.style.color = colors[s.board[i]-1] || '#fff'; }
    } else if (s.flagged[i]) {
      cell.textContent = '🚩';
    }
    if (s.over && s.board[i] === -1 && !s.revealed[i]) { cell.textContent = '💣'; cell.style.opacity = '0.5'; }
    if (s.won && s.board[i] === -1) { cell.textContent = '🚩'; }
    cell.oncontextmenu = (e) => { e.preventDefault(); minesToggleFlag(i); };
    cell.onclick = () => minesReveal(i);
    el.appendChild(cell);
  }
  const info = document.getElementById('minesInfo');
  if (info) {
    const flags = s.flagged.filter(Boolean).length;
    if (s.won) info.textContent = 'you win! all mines found.';
    else if (s.over) info.textContent = 'boom! game over.';
    else info.textContent = 'mines: ' + s.mines + ' | flags: ' + flags;
  }
}

// ===== SEARCH =====
async function cfbSearchKey(e) { if (e.key === 'Enter') cfbSearch(); }
async function cfbSearch() {
  const inp = document.getElementById('cfbSearchInput');
  const res = document.getElementById('cfbSearchResults');
  if (!inp || !res) return;
  const q = inp.value.trim();
  if (!q) return;
  res.innerHTML = '<p style="color:#888;">searching...</p>';
  try {
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent('https://www.bing.com/search?q=' + encodeURIComponent(q));
    const r = await fetch(proxyUrl);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // bing results: .b_algo contains title (h2 a), url (cite), snippet (p or .b_caption p)
    const items = doc.querySelectorAll('.b_algo');
    if (!items.length) {
      // fallback: show raw text
      res.innerHTML = '<p style="color:#888;">no parsed results. <a href="#" onclick="loadUrl(activeTab,\'https://www.bing.com/search?q=' + encodeURIComponent(q) + '\');return false;" style="color:#7c5cff;">open results page</a></p>';
      return;
    }
    let out = '';
    items.forEach(item => {
      const a = item.querySelector('h2 a');
      const cite = item.querySelector('cite');
      const snippet = item.querySelector('.b_caption p, p');
      if (!a) return;
      const title = a.textContent.trim();
      const href = a.getAttribute('href') || '';
      const url = cite ? cite.textContent.trim() : href;
      const desc = snippet ? snippet.textContent.trim() : '';
      out += '<div class="item"><div><div class="title">' + escapeHtml(title) + '</div><div class="url">' + escapeHtml(url) + '</div>' +
        (desc ? '<div style="color:#888;font-size:11px;margin-top:4px;">' + escapeHtml(desc.slice(0,200)) + '</div>' : '') +
        '</div><button onclick="loadUrl(activeTab,\'' + href.replace(/'/g, "\\'") + '\')">Open</button></div>';
    });
    res.innerHTML = out || '<p style="color:#888;">no results found.</p>';
  } catch (e) {
    res.innerHTML = '<p style="color:#e2685f;">search failed: ' + escapeHtml(e.message) + '</p>';
  }
}

// hook tictactoe init into showCfbPage
const _origShowCfbPageTTT = showCfbPage;
// (tttRender called after page insert via setTimeout in showCfbPage patch below)

function openCfb(page) {
  if (!activeTab) newTab();
  loadUrl(activeTab, 'cfb::' + page);
}

// ===== READER MODE =====
function cfbReaderKey(e) { if (e.key === 'Enter') cfbReader(); }

function cfbReaderKey(e) { if (e.key === 'Enter') cfbReader(); }

async function cfbReader() {
  const inp = document.getElementById('readerUrl');
  const out = document.getElementById('readerContent');
  if (!inp || !out) return;
  const url = inp.value.trim();
  if (!url) return;
  out.innerHTML = '<p style="color:#888;">loading...</p>';
  try {
    const r = await fetch('/api/proxy?url=' + encodeURIComponent(url));
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // try article, main, or body
    const article = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body;
    // extract text from paragraphs
    const paras = article.querySelectorAll('p, h1, h2, h3, h4, li');
    let text = '';
    paras.forEach(p => {
      const t = p.textContent.trim();
      if (t.length > 20) text += '<p>' + escapeHtml(t) + '</p>';
    });
    if (!text) text = '<p style="color:#888;">could not extract article text. try opening the page directly.</p>';
    // get title
    const title = doc.querySelector('title');
    const h = title ? '<h2 style="color:var(--text);margin-bottom:12px;">' + escapeHtml(title.textContent) + '</h2>' : '';
    out.innerHTML = h + text;
  } catch (e) {
    out.innerHTML = '<p style="color:#e2685f;">failed: ' + escapeHtml(e.message) + '</p>';
  }
}

// ===== CALCULATOR =====
function cfbInitCalc() {
  const display = document.getElementById('calcDisplay');
  const keys = document.getElementById('calcKeys');
  if (!display || !keys) return;
  const layout = ['C','⌫','%', '÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','='];
  keys.innerHTML = '';
  layout.forEach(k => {
    const btn = document.createElement('button');
    btn.textContent = k;
    btn.style.cssText = 'padding:12px;border-radius:6px;border:none;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;';
    if (k === '=') { btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; }
    else if (['C','⌫','%','÷','×','−','+'].includes(k)) { btn.style.background = 'var(--surface2)'; btn.style.color = 'var(--text)'; }
    else { btn.style.background = 'var(--bg3)'; btn.style.color = 'var(--text)'; }
    btn.onclick = () => cfbCalcKey(k, display);
    keys.appendChild(btn);
  });
}

function cfbCalcKey(k, display) {
  if (!display) display = document.getElementById('calcDisplay');
  if (!display) return;
  if (k === 'C') { display.value = ''; return; }
  if (k === '⌫') { display.value = display.value.slice(0, -1); return; }
  if (k === '=') {
    try {
      const expr = display.value.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
      display.value = String(Function('"use strict"; return (' + expr + ')')());
    } catch { display.value = 'Error'; }
    return;
  }
  display.value += k;
}

// ===== NOTES =====
function cfbLoadNotes() {
  const el = document.getElementById('notesArea');
  if (!el) return;
  try { el.value = localStorage.getItem('cfb_notes') || ''; } catch {}
}

function cfbSaveNotes() {
  const el = document.getElementById('notesArea');
  if (!el) return;
  try { localStorage.setItem('cfb_notes', el.value); } catch {}
}

// ===== TERMINAL =====
function cfbTermPrint(text) {
  const out = document.getElementById('termOutput');
  if (!out) return;
  out.textContent += text + '\n';
  out.scrollTop = out.scrollHeight;
}

function cfbTermKey(e) { if (e.key === 'Enter') cfbTerm(); }

function cfbTerm() {
  const inp = document.getElementById('termInput');
  const out = document.getElementById('termOutput');
  if (!inp || !out) return;
  const cmd = inp.value.trim();
  inp.value = '';
  cfbTermPrint('$ ' + cmd);
  const parts = cmd.split(/\s+/);
  const c = parts[0].toLowerCase();
  const args = parts.slice(1);
  switch (c) {
    case '': break;
    case 'help':
      cfbTermPrint('commands: help, clear, date, echo, calc, ls, about, theme');
      break;
    case 'clear':
      out.textContent = '';
      break;
    case 'date':
      cfbTermPrint(new Date().toString());
      break;
    case 'echo':
      cfbTermPrint(args.join(' '));
      break;
    case 'calc':
      try {
        const expr = args.join(' ').replace(/×/g, '*').replace(/÷/g, '/');
        cfbTermPrint(String(Function('"use strict"; return (' + expr + ')')()));
      } catch { cfbTermPrint('error'); }
      break;
    case 'about':
      cfbTermPrint('cf-browser terminal v1.0\\npowered by cf-browser');
      break;
    case 'ls':
      cfbTermPrint('notes.txt  readme.md  (virtual)');
      break;
    case 'theme':
      if (args[0]) {
        try { localStorage.setItem('cfb_theme', args[0]); cfbApplyTheme(); cfbTermPrint('theme set to ' + args[0]); } catch { cfbTermPrint('error'); }
      } else {
        cfbTermPrint('usage: theme <dark|light|midnight|forest|sunset>');
      }
      break;
    default:
      cfbTermPrint('command not found: ' + c);
  }
}

// ===== READER MODE =====
async function cfbReader() {
  const inp = document.getElementById('readerUrl');
  const out = document.getElementById('readerContent');
  if (!inp || !out) return;
  const url = inp.value.trim();
  if (!url) return;
  out.innerHTML = '<p style="color:#888;">loading...</p>';
  try {
    const r = await fetch('/api/proxy?url=' + encodeURIComponent(url));
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const article = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body;
    const paras = article.querySelectorAll('p, h1, h2, h3, h4, li');
    let text = '';
    paras.forEach(p => {
      const t = p.textContent.trim();
      if (t.length > 20) text += '<p>' + escapeHtml(t) + '</p>';
    });
    if (!text) text = '<p style="color:#888;">could not extract article text. try opening the page directly.</p>';
    const title = doc.querySelector('title');
    const h = title ? '<h2 style="color:var(--text);margin-bottom:12px;">' + escapeHtml(title.textContent) + '</h2>' : '';
    out.innerHTML = h + text;
  } catch (e) {
    out.innerHTML = '<p style="color:#e2685f;">failed: ' + escapeHtml(e.message) + '</p>';
  }
}

// ===== TRANSLATE =====
async function cfbTranslate() {
  const inp = document.getElementById('transInput');
  const out = document.getElementById('transOutput');
  const lang = document.getElementById('transLang');
  if (!inp || !out) return;
  const text = inp.value.trim();
  if (!text) return;
  out.textContent = 'translating...';
  try {
    const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|' + (lang ? lang.value : 'es'));
    const data = await r.json();
    out.textContent = (data.responseData && data.responseData.translatedText) || 'translation failed';
  } catch (e) {
    out.textContent = 'error: ' + e.message;
  }
}

// ===== EXTENSIONS =====
function cfbSaveExt() {
  const css = document.getElementById('extCss');
  const js = document.getElementById('extJs');
  if (css) localStorage.setItem('cfb_ext_css', css.value);
  if (js) localStorage.setItem('cfb_ext_js', js.value);
  const btn = document.querySelector('[onclick="cfbSaveExt()"]');
  if (btn) { btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = 'Save'; }, 1200); }
}

function cfbClearExt() {
  localStorage.removeItem('cfb_ext_css');
  localStorage.removeItem('cfb_ext_js');
  const css = document.getElementById('extCss');
  const js = document.getElementById('extJs');
  if (css) css.value = '';
  if (js) js.value = '';
}

// apply extensions to proxied pages (injected via proxy.js relay)
// (stored in localStorage, applied by the proxy script on page load)

// ===== DEVTOOLS =====
function cfbInspect() {
  const el = document.getElementById('devtoolsInfo');
  if (!el) return;
  const frame = activeTab && activeTab.frame;
  if (!frame) { el.textContent = 'no page loaded.'; return; }
  try {
    const doc = frame.contentDocument;
    const info = [];
    info.push('URL: ' + (activeTab.url || ''));
    info.push('Title: ' + (frame.contentDocument.title || ''));
    info.push('Ready state: ' + doc.readyState);
    info.push('Scripts: ' + doc.querySelectorAll('script').length);
    info.push('Images: ' + doc.querySelectorAll('img').length);
    info.push('Links: ' + doc.querySelectorAll('a').length);
    info.push('Forms: ' + doc.querySelectorAll('form').length);
    info.push('Inputs: ' + doc.querySelectorAll('input').length);
    info.push('Iframes: ' + doc.querySelectorAll('iframe').length);
    info.push('Body text length: ' + (doc.body ? doc.body.innerText.length : 0));
    info.push('Scroll height: ' + (doc.documentElement ? doc.documentElement.scrollHeight : 0));
    // list all cookies
    info.push('Cookies: ' + (doc.cookie || '(none)'));
    el.textContent = info.join('\\n');
  } catch (e) {
    el.textContent = 'error: ' + e.message;
  }
}

// ===== TRANSLATE =====
async function cfbTranslate() {
  const inp = document.getElementById('transInput');
  const out = document.getElementById('transOutput');
  const lang = document.getElementById('transLang');
  if (!inp || !out) return;
  const text = inp.value.trim();
  if (!text) return;
  out.textContent = 'translating...';
  try {
    const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|' + (lang ? lang.value : 'es'));
    const data = await r.json();
    out.textContent = (data.responseData && data.responseData.translatedText) || 'translation failed';
  } catch (e) {
    out.textContent = 'error: ' + e.message;
  }
}

// ===== EXTENSIONS =====
function cfbSaveExt() {
  const css = document.getElementById('extCss');
  const js = document.getElementById('extJs');
  if (css) localStorage.setItem('cfb_ext_css', css.value);
  if (js) localStorage.setItem('cfb_ext_js', js.value);
  const btn = document.querySelector('[onclick="cfbSaveExt()"]');
  if (btn) { btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = 'Save'; }, 1200); }
}

function cfbClearExt() {
  localStorage.removeItem('cfb_ext_css');
  localStorage.removeItem('cfb_ext_js');
  const css = document.getElementById('extCss');
  const js = document.getElementById('extJs');
  if (css) css.value = '';
  if (js) js.value = '';
}

// ===== DEVTOOLS =====
function cfbInspect() {
  const el = document.getElementById('devtoolsInfo');
  if (!el) return;
  const frame = activeTab && activeTab.frame;
  if (!frame) { el.textContent = 'no page loaded.'; return; }
  try {
    const doc = frame.contentDocument;
    const info = [];
    info.push('URL: ' + (activeTab.url || ''));
    info.push('Title: ' + (doc.title || ''));
    info.push('Ready state: ' + doc.readyState);
    info.push('Scripts: ' + doc.querySelectorAll('script').length);
    info.push('Images: ' + doc.querySelectorAll('img').length);
    info.push('Links: ' + doc.querySelectorAll('a').length);
    info.push('Forms: ' + doc.querySelectorAll('form').length);
    info.push('Inputs: ' + doc.querySelectorAll('input').length);
    info.push('Iframes: ' + doc.querySelectorAll('iframe').length);
    info.push('Body text length: ' + (doc.body ? doc.body.innerText.length : 0));
    info.push('Scroll height: ' + (doc.documentElement ? doc.documentElement.scrollHeight : 0));
    info.push('Cookies: ' + (doc.cookie || '(none)'));
    el.textContent = info.join('\\n');
  } catch (e) {
    el.textContent = 'error: ' + e.message;
  }
}

// ===== WORDLE =====
// nyt wordle is a client-side app behind a bot wall, so a proxy can only ever hand
// back an empty shell. this is a native one instead: no network, no proxy, always works.
const WDL_DAILY_KEY = 'cfb_wordle_daily';
const WDL_STATS_KEY = 'cfb_wordle_stats';
const WDL_MODE_KEY = 'cfb_wordle_mode';
const WDL_FALLBACK = 'about other which their there first would these state email world music after video where books links years';

let WDL_DATA = null;
function wdlData() {
  if (WDL_DATA) return WDL_DATA;
  const raw = window.WORDLE_WORDS;
  const answers = raw && raw.answers ? raw.answers.split(' ') : WDL_FALLBACK.split(' ');
  const valid = new Set(raw && raw.valid ? raw.valid.split(' ') : answers);
  WDL_DATA = { answers, valid };
  return WDL_DATA;
}

let wdl = null;
let wdlBusy = false;
let wdlSuppress = false;

function wdlDayNum() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

function wdlDailyAnswer(dayNum) {
  const answers = wdlData().answers;
  // every step has to be forced back into unsigned territory: bitwise ops in js
  // return signed int32, so a negative hash would index off the end of the array
  let x = (dayNum * 2654435761) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 2246822519) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  return answers[x % answers.length] || answers[0];
}

function wdlLoadDaily() {
  try { return JSON.parse(localStorage.getItem(WDL_DAILY_KEY) || 'null'); } catch { return null; }
}

function wdlSave() {
  if (!wdl || wdl.mode !== 'daily') return;
  try {
    localStorage.setItem(WDL_DAILY_KEY, JSON.stringify({
      day: wdl.day, answer: wdl.answer, guesses: wdl.guesses, done: wdl.done,
    }));
  } catch {}
}

function wdlGetStats() {
  try {
    const s = JSON.parse(localStorage.getItem(WDL_STATS_KEY) || 'null');
    if (s && Array.isArray(s.dist)) return s;
  } catch {}
  return { played: 0, wins: 0, streak: 0, max: 0, dist: [0, 0, 0, 0, 0, 0] };
}

function wdlRecord(won) {
  if (!wdl || wdl.mode !== 'daily' || wdl.scored) return;
  wdl.scored = true;
  const s = wdlGetStats();
  s.played++;
  if (won) {
    s.wins++;
    s.streak++;
    s.max = Math.max(s.max, s.streak);
    s.dist[Math.min(5, wdl.guesses.length - 1)]++;
  } else {
    s.streak = 0;
  }
  try { localStorage.setItem(WDL_STATS_KEY, JSON.stringify(s)); } catch {}
}

function wdlScore(guess, answer) {
  const res = ['absent', 'absent', 'absent', 'absent', 'absent'];
  const pool = answer.split('');
  for (let i = 0; i < 5; i++) {
    if (guess[i] === pool[i]) { res[i] = 'correct'; pool[i] = ''; }
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'correct') continue;
    const j = pool.indexOf(guess[i]);
    if (j > -1) { res[i] = 'present'; pool[j] = ''; }
  }
  return res;
}

function wdlPage() {
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  let kb = '';
  rows.forEach((row, ri) => {
    let keys = '';
    if (ri === 2) keys += '<button class="wd-key wide" data-key="enter">enter</button>';
    for (const ch of row) keys += '<button class="wd-key" data-key="' + ch + '">' + ch + '</button>';
    if (ri === 2) keys += '<button class="wd-key wide" data-key="back">del</button>';
    kb += '<div class="wd-kbrow">' + keys + '</div>';
  });

  let grid = '';
  for (let r = 0; r < 6; r++) {
    grid += '<div class="wd-row" id="wdRow' + r + '">';
    for (let c = 0; c < 5; c++) grid += '<div class="wd-tile" id="wdTile' + r + '-' + c + '"></div>';
    grid += '</div>';
  }

  return '<div class="cfb-page wd">' +
    '<h1>Wordle</h1>' +
    '<div class="wd-sub">guess the 5 letter word in 6 tries</div>' +
    '<div class="wd-grid" id="wdGrid">' + grid + '</div>' +
    '<div class="wd-msg" id="wdMsg"></div>' +
    '<div class="wd-kb" id="wdKb">' + kb + '</div>' +
    '<div class="wd-foot">' +
      '<select id="wdMode"><option value="daily">daily</option><option value="practice">practice</option></select>' +
      '<button onclick="wdlNewWord()">new word</button>' +
      '<button onclick="wdlShare()">share</button>' +
    '</div>' +
    '<div class="wd-stats" id="wdStats"></div>' +
    '</div>';
}

function wdlInit() {
  let mode = 'daily';
  try { mode = localStorage.getItem(WDL_MODE_KEY) || 'daily'; } catch {}
  const answers = wdlData().answers;
  const day = wdlDayNum();

  if (mode !== 'practice') {
    const saved = wdlLoadDaily();
    if (saved && saved.day === day && Array.isArray(saved.guesses)) {
      wdl = {
        mode: 'daily', day,
        answer: saved.answer || wdlDailyAnswer(day),
        guesses: saved.guesses.slice(0, 6),
        current: '', done: !!saved.done, msg: '', msgKind: '',
      };
    } else {
      wdl = { mode: 'daily', day, answer: wdlDailyAnswer(day), guesses: [], current: '', done: false, msg: '', msgKind: '' };
      wdlSave();
    }
  } else {
    wdl = {
      mode: 'practice', day,
      answer: answers[Math.floor(Math.random() * answers.length)],
      guesses: [], current: '', done: false, msg: '', msgKind: '',
    };
  }

  wdlBusy = false;
  if (wdl.done && wdl.guesses.length) {
    const won = wdl.guesses[wdl.guesses.length - 1] === wdl.answer;
    wdl.msg = won ? 'you already got this one in ' + wdl.guesses.length : 'the word was ' + wdl.answer.toUpperCase();
    wdl.msgKind = won ? 'good' : 'bad';
  }
  wdlRender();
}

function wdlRender() {
  if (!wdl) return;
  const grid = document.getElementById('wdGrid');
  if (!grid) return;

  for (let r = 0; r < 6; r++) {
    const guess = wdl.guesses[r];
    const cur = (r === wdl.guesses.length && !wdl.done) ? wdl.current : '';
    const text = guess || cur || '';
    for (let c = 0; c < 5; c++) {
      const tile = document.getElementById('wdTile' + r + '-' + c);
      if (!tile) continue;
      tile.textContent = text[c] || '';
      tile.className = 'wd-tile' + (text[c] ? ' filled' : '');
    }
  }

  wdl.guesses.forEach((g, r) => {
    const res = wdlScore(g, wdl.answer);
    for (let c = 0; c < 5; c++) {
      const tile = document.getElementById('wdTile' + r + '-' + c);
      if (tile) tile.classList.add(res[c]);
    }
  });

  wdlRenderKeys();
  wdlRenderStats();

  const msg = document.getElementById('wdMsg');
  if (msg) { msg.textContent = wdl.msg || ''; msg.className = 'wd-msg ' + (wdl.msgKind || ''); }

  const sel = document.getElementById('wdMode');
  if (sel) sel.value = wdl.mode === 'daily' ? 'daily' : 'practice';
}

function wdlRenderKeys() {
  const best = {};
  const rank = { absent: 1, present: 2, correct: 3 };
  if (wdl) {
    wdl.guesses.forEach(g => {
      const res = wdlScore(g, wdl.answer);
      for (let i = 0; i < 5; i++) {
        const ch = g[i];
        if (!best[ch] || rank[res[i]] > rank[best[ch]]) best[ch] = res[i];
      }
    });
  }
  document.querySelectorAll('.wd-key[data-key]').forEach(btn => {
    const k = btn.dataset.key;
    btn.classList.remove('correct', 'present', 'absent');
    if (best[k]) btn.classList.add(best[k]);
  });
}

function wdlRenderStats() {
  const el = document.getElementById('wdStats');
  if (!el) return;
  const s = wdlGetStats();
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  el.textContent = 'played ' + s.played + ' · win ' + pct + '% · streak ' + s.streak + ' · best ' + s.max;
}

function wdlMsg(text, kind, shake) {
  if (!wdl) return;
  wdl.msg = text;
  wdl.msgKind = kind || '';
  const el = document.getElementById('wdMsg');
  if (el) { el.textContent = text; el.className = 'wd-msg ' + (kind || ''); }
  if (shake) {
    const row = document.getElementById('wdRow' + wdl.guesses.length);
    if (row) { row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); }
  }
}

function wdlInput(ch) {
  if (!wdl || wdl.done || wdlBusy) return;
  if (wdl.current.length >= 5) return;
  wdl.current += ch;
  wdl.msg = '';
  wdl.msgKind = '';
  wdlRender();
}

function wdlBack() {
  if (!wdl || wdl.done || wdlBusy) return;
  wdl.current = wdl.current.slice(0, -1);
  wdlRender();
}

function wdlKey(k) {
  if (!wdl) return;
  if (k === 'enter') { wdlSubmit(); return; }
  if (k === 'back' || k === 'backspace' || k === 'del') { wdlBack(); return; }
  if (/^[a-z]$/.test(k)) wdlInput(k);
}

function wdlSubmit() {
  if (!wdl || wdl.done || wdlBusy) return;
  const guess = wdl.current.toLowerCase();
  if (guess.length < 5) { wdlMsg('not enough letters', 'bad', true); return; }
  if (!wdlData().valid.has(guess)) { wdlMsg('not in the word list', 'bad', true); return; }

  const answer = wdl.answer;
  const res = wdlScore(guess, answer);
  const rowIdx = wdl.guesses.length;

  wdl.guesses.push(guess);
  wdl.current = '';
  if (mpWs && mpWs.readyState === WebSocket.OPEN && !wdlSuppress) {
    try { mpWs.send(JSON.stringify({ type: 'wordle', guess, answer: wdl.answer, by: mpPeerId })); } catch (e) {}
  }
  wdl.msg = '';
  wdl.msgKind = '';
  wdlBusy = true;

  for (let c = 0; c < 5; c++) {
    const tile = document.getElementById('wdTile' + rowIdx + '-' + c);
    if (tile) { tile.textContent = guess[c]; tile.className = 'wd-tile filled'; }
  }
  const msgEl = document.getElementById('wdMsg');
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'wd-msg'; }

  for (let c = 0; c < 5; c++) {
    setTimeout(() => {
      const tile = document.getElementById('wdTile' + rowIdx + '-' + c);
      if (!tile) return;
      tile.classList.add('flip');
      setTimeout(() => tile.classList.add(res[c]), 120);
    }, c * 170);
  }

  setTimeout(() => {
    wdlBusy = false;
    const won = guess === answer;
    if (won) {
      wdl.done = true;
      wdl.msg = wdl.guesses.length === 1 ? 'one try. unreal.' : 'got it in ' + wdl.guesses.length + '!';
      wdl.msgKind = 'good';
    } else if (wdl.guesses.length >= 6) {
      wdl.done = true;
      wdl.msg = 'the word was ' + answer.toUpperCase();
      wdl.msgKind = 'bad';
    }
    if (wdl.done) wdlRecord(won);
    wdlSave();
    wdlRenderKeys();
    wdlRenderStats();
    const el = document.getElementById('wdMsg');
    if (el) { el.textContent = wdl.msg || ''; el.className = 'wd-msg ' + (wdl.msgKind || ''); }
  }, 5 * 170 + 220);
}

function wdlApplyRemote(guess, answer) {
  if (!wdl || !guess) return;
  if (answer) wdl.answer = answer;
  // avoid double-applying the same guess
  if (wdl.guesses.length && wdl.guesses[wdl.guesses.length - 1] === guess) return;
  wdl.guesses.push(String(guess).toLowerCase());
  wdl.current = '';
  wdlBusy = false;
  const won = wdl.guesses[wdl.guesses.length - 1] === wdl.answer;
  if (won) { wdl.done = true; wdl.msg = 'got it in ' + wdl.guesses.length + '!'; wdl.msgKind = 'good'; wdlRecord(won); }
  else if (wdl.guesses.length >= 6) { wdl.done = true; wdl.msg = 'the word was ' + wdl.answer.toUpperCase(); wdl.msgKind = 'bad'; wdlRecord(false); }
  wdlSave();
  wdlRender();
  const el = document.getElementById('wdMsg');
  if (el) { el.textContent = wdl.msg || ''; el.className = 'wd-msg ' + (wdl.msgKind || ''); }
}

function wdlNewWord() {
  const answers = wdlData().answers;
  let next = answers[Math.floor(Math.random() * answers.length)];
  let guard = 0;
  while (wdl && next === wdl.answer && guard++ < 20) {
    next = answers[Math.floor(Math.random() * answers.length)];
  }
  try { localStorage.setItem(WDL_MODE_KEY, 'practice'); } catch {}
  wdl = { mode: 'practice', day: wdlDayNum(), answer: next, guesses: [], current: '', done: false, msg: '', msgKind: '' };
  wdlBusy = false;
  wdlRender();
}

function wdlSetMode(mode) {
  try { localStorage.setItem(WDL_MODE_KEY, mode === 'practice' ? 'practice' : 'daily'); } catch {}
  if (mode === 'practice') { wdlNewWord(); return; }
  wdlInit();
}

function wdlLegacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function wdlShare() {
  if (!wdl || !wdl.guesses.length) { wdlMsg('nothing to share yet', 'bad'); return; }
  const emoji = { correct: '🟩', present: '🟨', absent: '⬛' };
  const won = wdl.guesses[wdl.guesses.length - 1] === wdl.answer;
  const head = 'wordle ' + (wdl.mode === 'daily' ? 'daily' : 'practice') + ' ' +
    wdl.guesses.length + '/6' + (won ? '' : ' X');
  const gridText = wdl.guesses.map(g => wdlScore(g, wdl.answer).map(r => emoji[r]).join('')).join('\n');
  const text = head + '\n\n' + gridText + '\n\ncf-browser';

  const done = ok => wdlMsg(ok ? 'copied to clipboard' : 'copy failed', ok ? 'good' : 'bad');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(!!wdlLegacyCopy(text)));
    return;
  }
  done(!!wdlLegacyCopy(text));
}

document.addEventListener('keydown', (e) => {
  const grid = document.getElementById('wdGrid');
  if (!grid || grid.offsetParent === null) return;
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'enter') { e.preventDefault(); wdlKey('enter'); return; }
  if (k === 'backspace') { e.preventDefault(); wdlKey('back'); return; }
  if (/^[a-z]$/.test(k)) { e.preventDefault(); wdlKey(k); }
});

document.addEventListener('click', (e) => {
  const key = e.target && e.target.closest ? e.target.closest('.wd-key') : null;
  if (key) wdlKey(key.dataset.key);
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'wdMode') wdlSetMode(e.target.value);
});


function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function cfbFilterHistory() {
  const input = document.getElementById('histSearch');
  const items = document.querySelectorAll('.hist-item');
  if (!input) return;
  const q = input.value.toLowerCase();
  items.forEach(item => {
    const url = item.textContent.toLowerCase();
    item.style.display = url.includes(q) ? '' : 'none';
  });
}

function setTabColor(tab, color) {
  tab.color = color;
  renderTabs();
}

function cycleTabColor(tab) {
  const colors = [null, '#7c5cff', '#56d18a', '#f59e0b', '#e2685f', '#38bdf8', '#f472b6'];
  const idx = colors.indexOf(tab.color);
  tab.color = colors[(idx + 1) % colors.length];
  renderTabs();
}

function screenshotPage() {
  const frame = activeTab && activeTab.frame;
  if (!frame) { setStatusText('No page loaded'); return; }
  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) { setStatusText('Cannot capture (cross-origin)'); return; }
    const canvas = document.createElement('canvas');
    const w = doc.documentElement.scrollWidth || window.innerWidth;
    const h = doc.documentElement.scrollHeight || window.innerHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.font = '12px sans-serif';
    const text = doc.body.innerText || '';
    const lines = text.split('\n').slice(0, 200);
    let y = 20;
    lines.forEach(l => { ctx.fillText(l.slice(0, 120), 10, y); y += 16; });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'screenshot-' + Date.now() + '.png';
    a.click();
    setStatusText('Screenshot saved');
  } catch (e) {
    setStatusText('Screenshot failed: ' + e.message);
  }
}

// ===== SESSION MANAGER =====
function cfbSaveSession() {
  const name = prompt('session name:');
  if (!name) return;
  const session = tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned, color: t.color }));
  try {
    const sessions = JSON.parse(localStorage.getItem('cfb_sessions') || '{}');
    sessions[name] = session;
    localStorage.setItem('cfb_sessions', JSON.stringify(sessions));
    setStatusText('session "' + name + '" saved');
  } catch {}
}

function cfbLoadSession() {
  let sessions = {};
  try { sessions = JSON.parse(localStorage.getItem('cfb_sessions') || '{}'); } catch {}
  const names = Object.keys(sessions);
  if (names.length === 0) { setStatusText('no saved sessions'); return; }
  const name = prompt('load session: ' + names.join(', '));
  if (!name || !sessions[name]) { setStatusText('session not found'); return; }
  // close all tabs
  while (tabs.length > 0) closeTab(tabs[0].id);
  sessions[name].forEach(s => {
    const t = newTab(s.url);
    if (s.pinned) t.pinned = true;
    if (s.color) t.color = s.color;
    t.title = s.title || t.title;
  });
  renderTabs();
  setStatusText('session "' + name + '" loaded');
}

function cfbDeleteSession() {
  let sessions = {};
  try { sessions = JSON.parse(localStorage.getItem('cfb_sessions') || '{}'); } catch {}
  const names = Object.keys(sessions);
  if (names.length === 0) { setStatusText('no saved sessions'); return; }
  const name = prompt('delete session: ' + names.join(', '));
  if (name && sessions[name]) {
    delete sessions[name];
    localStorage.setItem('cfb_sessions', JSON.stringify(sessions));
    setStatusText('session "' + name + '" deleted');
  }
}

// ===== READER MODE POLISH =====
function cfbReaderFontSize(delta) {
  const el = document.getElementById('readerContent');
  if (!el) return;
  const current = parseInt(el.style.fontSize) || 14;
  el.style.fontSize = Math.max(10, Math.min(24, current + delta)) + 'px';
}

// ===== PASSWORD MANAGER =====
function cfbPasswordsPage() {
  let entries = [];
  try { entries = JSON.parse(localStorage.getItem('cfb_passwords') || '[]'); } catch {}
  let html = '<div class="cfb-page"><h1>Password Manager</h1>' +
    '<p style="color:#888;font-size:12px;margin-bottom:14px;">stored locally in your browser (not encrypted, for convenience only).</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' +
    '<input id="pwSite" placeholder="site (e.g. github.com)" style="flex:1;min-width:120px;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
    '<input id="pwUser" placeholder="username" style="flex:1;min-width:120px;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
    '<input id="pwPass" placeholder="password" type="password" style="flex:1;min-width:120px;padding:6px 8px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:12px;">' +
    '<button onclick="cfbSavePw()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">Save</button>' +
    '</div>' +
    '<div id="pwList">';
  if (entries.length === 0) html += '<div class="empty">No passwords saved.</div>';
  else entries.forEach((e, i) => {
    html += '<div class="item"><div><div class="title">' + escapeHtml(e.site) + '</div><div class="url">' + escapeHtml(e.user) + '</div></div>' +
      '<button onclick="cfbShowPw(' + i + ')" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;margin-right:4px;">Show</button>' +
      '<button onclick="cfbDeletePw(' + i + ')" style="background:transparent;border:1px solid #e2685f;color:#e2685f;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Delete</button></div>';
  });
  html += '</div></div>';
  return html;
}
function cfbSavePw() {
  const site = document.getElementById('pwSite').value.trim();
  const user = document.getElementById('pwUser').value.trim();
  const pass = document.getElementById('pwPass').value;
  if (!site || !user || !pass) { setStatusText('fill all fields'); return; }
  let entries = [];
  try { entries = JSON.parse(localStorage.getItem('cfb_passwords') || '[]'); } catch {}
  entries.push({ site, user, pass });
  localStorage.setItem('cfb_passwords', JSON.stringify(entries));
  openCfb('passwords');
  setStatusText('password saved');
}
function cfbShowPw(i) {
  let entries = [];
  try { entries = JSON.parse(localStorage.getItem('cfb_passwords') || '[]'); } catch {}
  if (entries[i]) alert(entries[i].site + '\\n' + entries[i].user + '\\n' + entries[i].pass);
}
function cfbDeletePw(i) {
  let entries = [];
  try { entries = JSON.parse(localStorage.getItem('cfb_passwords') || '[]'); } catch {}
  entries.splice(i, 1);
  localStorage.setItem('cfb_passwords', JSON.stringify(entries));
  openCfb('passwords');
  setStatusText('password deleted');
}

// ===== RSS FEED READER =====
function cfbRssPage() {
  let feeds = [];
  try { feeds = JSON.parse(localStorage.getItem('cfb_rss_feeds') || '[]'); } catch {}
  let html = '<div class="cfb-page"><h1>RSS Feed Reader</h1>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<input id="rssUrl" placeholder="feed url (e.g. https://hnrss.org/frontpage)" style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid #3a3a5e;background:#0f0f1a;color:#e0e0e0;font-size:13px;">' +
    '<button onclick="cfbAddFeed()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Add Feed</button>' +
    '</div>' +
    '<div id="rssFeeds">';
  if (feeds.length === 0) html += '<div class="empty">No feeds added. Try https://hnrss.org/frontpage</div>';
  else feeds.forEach((f, i) => {
    html += '<div class="item"><div><div class="title">' + escapeHtml(f) + '</div></div>' +
      '<button onclick="cfbLoadFeed(' + i + ')" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;margin-right:4px;">Load</button>' +
      '<button onclick="cfbRemoveFeed(' + i + ')" style="background:transparent;border:1px solid #e2685f;color:#e2685f;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">Remove</button></div>';
  });
  html += '</div><div id="rssArticles" style="margin-top:16px;"></div></div>';
  return html;
}
async function cfbAddFeed() {
  const url = document.getElementById('rssUrl').value.trim();
  if (!url) return;
  let feeds = [];
  try { feeds = JSON.parse(localStorage.getItem('cfb_rss_feeds') || '[]'); } catch {}
  if (!feeds.includes(url)) { feeds.push(url); localStorage.setItem('cfb_rss_feeds', JSON.stringify(feeds)); }
  openCfb('rss');
  setStatusText('feed added');
}
function cfbRemoveFeed(i) {
  let feeds = [];
  try { feeds = JSON.parse(localStorage.getItem('cfb_rss_feeds') || '[]'); } catch {}
  feeds.splice(i, 1);
  localStorage.setItem('cfb_rss_feeds', JSON.stringify(feeds));
  openCfb('rss');
}
async function cfbLoadFeed(i) {
  let feeds = [];
  try { feeds = JSON.parse(localStorage.getItem('cfb_rss_feeds') || '[]'); } catch {}
  const url = feeds[i];
  if (!url) return;
  const el = document.getElementById('rssArticles');
  if (el) el.innerHTML = '<div style="color:#888;">loading...</div>';
  try {
    const proxyUrl = PROXY + encodeURIComponent(url);
    const r = await fetch(proxyUrl);
    const text = await r.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const items = doc.querySelectorAll('item');
    let html = '';
    items.forEach(item => {
      const title = item.querySelector('title')?.textContent || 'untitled';
      const link = item.querySelector('link')?.textContent || '#';
      const desc = item.querySelector('description')?.textContent || '';
      const date = item.querySelector('pubDate')?.textContent || '';
      html += '<div class="item"><div><div class="title">' + escapeHtml(title) + '</div>' +
        '<div class="url">' + escapeHtml(date) + '</div>' +
        '<div style="color:#9a9ab0;font-size:12px;margin-top:4px;">' + escapeHtml(desc.replace(/<[^>]*>/g, '').slice(0, 200)) + '</div></div>' +
        '<button onclick="loadUrl(activeTab, ' + JSON.stringify(link) + ')">Open</button></div>';
    });
    if (el) el.innerHTML = html || '<div class="empty">no articles found</div>';
  } catch (e) {
    if (el) el.innerHTML = '<div style="color:#e2685f;">error: ' + escapeHtml(e.message) + '</div>';
  }
}

// ===== SPLIT VIEW =====
function cfbSplitPage() {
  return '<div class="cfb-page"><h1>Split View</h1>' +
    '<p style="color:#888;font-size:12px;margin-bottom:14px;">open two tabs side by side.</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<button onclick="cfbSplitEnable()" style="background:#7c5cff;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Enable Split View</button>' +
    '<button onclick="cfbSplitDisable()" style="background:transparent;border:1px solid #3a3a5e;color:#9a9ab0;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;">Disable</button>' +
    '</div>' +
    '<p style="color:#666;font-size:11px;">split view shows the active tab and the previous tab side by side. use tab switching to change which tabs are shown.</p>' +
    '</div>';
}
function cfbSplitEnable() {
  const content = document.getElementById('content');
  if (!content) return;
  content.style.display = 'flex';
  content.style.flexDirection = 'row';
  const views = content.querySelectorAll('.tabview');
  views.forEach(v => { v.style.flex = '1'; v.style.width = '50%'; });
  setStatusText('split view enabled');
}
function cfbSplitDisable() {
  const content = document.getElementById('content');
  if (!content) return;
  content.style.display = '';
  content.style.flexDirection = '';
  const views = content.querySelectorAll('.tabview');
  views.forEach(v => { v.style.flex = ''; v.style.width = ''; });
  setStatusText('split view disabled');
}

function navigateTo(url) {
  if (!activeTab) newTab(url);
  else loadUrl(activeTab, url);
}

function goBack() {
  if (!activeTab || activeTab.histIdx <= 0) return;
  activeTab.histIdx--;
  const url = activeTab.history[activeTab.histIdx];
  activeTab.url = url;
  loadUrlWithoutHistory(activeTab, url);
}

function goForward() {
  if (!activeTab || activeTab.histIdx >= activeTab.history.length - 1) return;
  activeTab.histIdx++;
  const url = activeTab.history[activeTab.histIdx];
  activeTab.url = url;
  loadUrlWithoutHistory(activeTab, url);
}

function loadUrlWithoutHistory(tab, url) {
  const cfbPage = cfbPageFrom(url);
  if (cfbPage) {
    tab.url = url;
    tab.title = 'cfb::' + cfbPage;
    renderTabs();
    updateAddrBar();
    updateNavButtons();
    updateStarBtn();
    showCfbPage(tab, cfbPage);
    return;
  }
  tab.loading = true;
  tab.title = hostLabel(url);
  renderTabs();
  setStatusText('Loading ' + url + '...');
  loadIntoFrame(tab, url);
  updateAddrBar();
  updateNavButtons();
  updateStarBtn();
}

function reload() {
  if (activeTab && activeTab.url) {
    loadUrl(activeTab, activeTab.url);
  }
}

// Save session before unload
window.addEventListener('beforeunload', () => {
  try {
    const session = tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned })).filter(t => t.url);
    localStorage.setItem('cfb_session', JSON.stringify(session));
  } catch {}
});

// Restore session on load
(function restoreSession() {
  try {
    const raw = localStorage.getItem('cfb_session');
    if (raw) {
      const session = JSON.parse(raw);
      if (Array.isArray(session) && session.length) {
        if (tabs.length === 1 && !tabs[0].url) { tabs.splice(0, 1); }
        session.forEach(s => {
          if (!s.url) return;
          const id = ++tabCounter;
          const tab = { id, url: s.url, title: s.title || 'Loading...', history: [s.url], histIdx: 0, loading: false, pinned: !!s.pinned, zoom: 1, view: null, frame: null };
          tabs.push(tab);
        });
        if (tabs.length) { activeTab = tabs[0]; renderTabs(); if (activeTab.url) loadUrl(activeTab, activeTab.url); }
        return;
      }
    }
  } catch {}
  // no saved session — open a new tab
  newTab();
})();

