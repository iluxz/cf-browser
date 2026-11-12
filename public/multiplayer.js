// ===== BOOKMARKS =====
let bookmarks = [];
try { bookmarks = JSON.parse(localStorage.getItem('cfb_bookmarks') || '[]'); } catch {}
function saveBookmarks() { try { localStorage.setItem('cfb_bookmarks', JSON.stringify(bookmarks)); } catch {} }
function toggleBookmark() {
  if (!activeTab || !activeTab.url) return;
  const idx = bookmarks.findIndex(b => b.url === activeTab.url);
  if (idx === -1) bookmarks.push({ title: activeTab.title || activeTab.url, url: activeTab.url });
  else bookmarks.splice(idx, 1);
  saveBookmarks(); renderBookmarks(); updateStarBtn();
}
function removeBookmark(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  saveBookmarks(); renderBookmarks(); updateStarBtn();
}
function renderBookmarks() {
  const bar = document.getElementById('bookmarksBar');
  bar.innerHTML = '';
  bookmarks.forEach(bm => {
    const el = document.createElement('div');
    el.className = 'bookmark-item';
    el.title = bm.url;
    el.innerHTML = '<span>' + bm.title.slice(0, 20) + '</span><span class="bm-remove" onclick="removeBookmark(\'' + bm.url.replace(/'/g, "\\'") + '\')">x</span>';
    el.onclick = () => { if (activeTab) loadUrl(activeTab, bm.url); };
    bar.appendChild(el);
  });
}
function updateStarBtn() {
  const btn = document.getElementById('starBtn');
  if (!btn || !activeTab || !activeTab.url) { if (btn) { btn.textContent = '☆'; btn.classList.remove('starred'); } return; }
  const isBm = bookmarks.some(b => b.url === activeTab.url);
  btn.textContent = isBm ? '★' : '☆';
  btn.classList.toggle('starred', isBm);
}
renderBookmarks();

const MP_WORKER = 'https://cf-browser-mp.cnnecare.workers.dev';
let mpWs = null, mpRoomId = null, mpPeerId = null, mpIsHost = false, mpPeers = [];

// room codes are generated locally - the durable object is created by the websocket itself,
// so hosting needs zero fetch (no CORS, no NetworkError)
let mpConfig = { host: false, pw: '', max: 8, chat: true, cursors: true, nav: 'host' };
let mpRoomSettings = { locked: false, max: 8, chat: true, cursors: true, nav: 'all', peers: 0 };
let mpCursorsAllowed = true;

function mpRandomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) s += A[buf[i] % A.length];
  return s;
}

function mpInviteUrl() {
  const q = new URLSearchParams();
  q.set('join', mpRoomId || '');
  const pw = (document.getElementById('mpSetPw') || {}).value || '';
  if (pw) q.set('pw', pw);
  return location.origin + location.pathname + '?' + q.toString();
}

function mpRefreshInvite() {
  const hint = document.getElementById('mpInviteHint');
  if (!hint || !mpRoomId) return;
  hint.textContent = mpInviteUrl();
}

function mpHost() {
  mpRoomId = mpRandomCode();
  const overlay = document.createElement('div');
  overlay.className = 'mp-overlay';
  overlay.innerHTML = '<div class="mp-panel mp-panel-wide"><h2>New Room</h2>' +
    '<div class="code-display">' + mpRoomId + '</div>' +
    '<div class="mp-fields">' +
      '<label>password<input id="mpSetPw" type="text" placeholder="optional" maxlength="64" autocomplete="off"></label>' +
      '<label>people<input id="mpSetMax" type="number" min="2" max="50" value="8"></label>' +
    '</div>' +
    '<div class="mp-toggles">' +
      '<label class="mp-check"><input type="checkbox" id="mpSetChat" checked><span>chat</span></label>' +
      '<label class="mp-check"><input type="checkbox" id="mpSetCursors" checked><span>live cursors</span></label>' +
    '</div>' +
    '<label style="margin-top:8px;">page sync<select id="mpSetNav" style="margin-left:8px;"><option value="off">off - everyone browses alone</option><option value="host" selected>host leads</option><option value="all">anyone can change it</option></select></label>' +
    '<p class="mp-hint" id="mpInviteHint"></p>' +
    '<button onclick="mpStartHost()">Start room</button>' +
    '<button class="secondary" onclick="mpCopyInvite(this)">Copy invite</button>' +
    '<button class="secondary" onclick="mpRoomId = null; closeMpOverlay()">Cancel</button></div>';
  document.body.appendChild(overlay);
  ['mpSetPw', 'mpSetMax', 'mpSetChat', 'mpSetCursors', 'mpSetNav'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', mpRefreshInvite);
    el.addEventListener('change', mpRefreshInvite);
  });
  mpRefreshInvite();
}

function mpStartHost() {
  const pw = (document.getElementById('mpSetPw') || {}).value || '';
  const maxRaw = parseInt((document.getElementById('mpSetMax') || {}).value || '8', 10);
  mpConfig = {
    host: true,
    pw: pw.slice(0, 64),
    max: Number.isFinite(maxRaw) ? Math.max(2, Math.min(50, maxRaw)) : 8,
    chat: !!((document.getElementById('mpSetChat') || {}).checked),
    cursors: !!((document.getElementById('mpSetCursors') || {}).checked),
    nav: (document.getElementById('mpSetNav') || {}).value || 'host',
  };
  closeMpOverlay();
  mpConnect();
}

function mpCopyInvite(btn) {
  const url = mpInviteUrl();
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy invite'; }, 1200);
  }).catch(() => {});
}

function closeMpOverlay() {
  const o = document.querySelector('.mp-overlay');
  if (o) o.remove();
}

function mpJoin(prefillCode, prefillPw, errText) {
  const overlay = document.createElement('div');
  overlay.className = 'mp-overlay';
  overlay.innerHTML = '<div class="mp-panel"><h2>Join a Room</h2>' +
    (errText ? '<p class="mp-err">' + escapeHtml(errText) + '</p>' : '') +
    '<p>room code</p><input id="mpJoinCode" type="text" placeholder="XXXXXX" maxlength="6" autocomplete="off" value="' + escapeHtml(prefillCode || '') + '">' +
    '<p style="margin-top:10px;">password <span style="color:#555;">(if it has one)</span></p><input id="mpJoinPw" type="text" maxlength="64" autocomplete="off" placeholder="leave blank if open" value="' + escapeHtml(prefillPw || '') + '">' +
    '<div><button onclick="mpDoJoin()">Join</button><button class="secondary" onclick="closeMpOverlay()">Cancel</button></div></div>';
  document.body.appendChild(overlay);
  const codeEl = document.getElementById('mpJoinCode');
  const pwEl = document.getElementById('mpJoinPw');
  if (!prefillCode) codeEl.focus(); else pwEl.focus();
  [codeEl, pwEl].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') mpDoJoin(); }));
}

function mpDoJoin() {
  const codeEl = document.getElementById('mpJoinCode');
  const pwEl = document.getElementById('mpJoinPw');
  if (!codeEl) return;
  const code = codeEl.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code) return;
  closeMpOverlay();
  mpRoomId = code;
  mpConfig = { host: false, pw: (pwEl.value || '').slice(0, 64), max: 8, chat: true, cursors: true, nav: 'host' };
  mpConnect();
}

function mpConnect() {
  if (!mpRoomId) return;
  mpSetStatus('Connecting to ' + mpRoomId + '...', 'hosting');

  const q = new URLSearchParams();
  if (mpConfig.host) q.set('create', '1');
  if (mpConfig.pw) q.set('pw', mpConfig.pw);
  if (mpConfig.host) {
    q.set('max', String(mpConfig.max));
    q.set('chat', mpConfig.chat ? '1' : '0');
    q.set('cursors', mpConfig.cursors ? '1' : '0');
    q.set('nav', mpConfig.nav);
  }
  const qs = q.toString();
  const wsUrl = MP_WORKER.replace('https://', 'wss://') + '/room/' + encodeURIComponent(mpRoomId) + (qs ? '?' + qs : '');

  try { mpWs = new WebSocket(wsUrl); } catch (e) { mpFail('Could not open socket: ' + e.message); return; }

  let opened = false;
  let rejected = null;
  const connectTimer = setTimeout(() => {
    if (!opened) mpFail('Timed out reaching the room server. check the worker is deployed.');
  }, 10000);

  mpWs.onopen = () => { opened = true; clearTimeout(connectTimer); };
  mpWs.onmessage = (event) => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'rejected') { rejected = msg.reason; return; }
    mpHandleMessage(msg);
  };
  mpWs.onclose = (ev) => {
    clearTimeout(connectTimer);
    const code = ev.code;
    const reason = rejected || ev.reason;

    if (code === 4001 || reason === 'bad-password') {
      const codeTaken = mpRoomId;
      mpResetRoom();
      mpJoin(codeTaken, mpConfig.pw, 'wrong password for that room');
      return;
    }
    if (code === 4002 || reason === 'full') {
      mpFail('that room is full');
      mpResetRoom();
      return;
    }
    if (!opened) { mpFail('Room server closed the connection (code ' + code + ').'); mpResetRoom(); return; }

    mpSetStatus('Disconnected', '');
    const wasLeaving = mpLeavingType;
    mpLeavingType = false;
    mpResetRoom();
    if (!wasLeaving) mpAddChatMsg('', 'disconnected', { sys: true });
  };
  mpWs.onerror = () => { if (!opened) mpFail('NetworkError reaching the room server.'); };
}

function mpResetRoom() {
  mpRoomId = null; mpPeerId = null; mpPeers = []; mpIsHost = false;
  mpClearCursors();
  mpClearUnread();
  mpUpdatePeers();
  const chatBtn = document.getElementById('mpChatBtn');
  const leaveBtn = document.getElementById('mpLeaveBtn');
  if (chatBtn) chatBtn.style.display = 'none';
  if (leaveBtn) leaveBtn.style.display = 'none';
  const followBtn = document.getElementById('mpFollowBtn');
  const cursorsBtn = document.getElementById('mpCursorsBtn');
  if (followBtn) followBtn.style.display = 'none';
  if (cursorsBtn) cursorsBtn.style.display = 'none';
  const shareBtn = document.getElementById('mpShareBtn');
  if (shareBtn) { shareBtn.style.display = 'none'; shareBtn.textContent = 'Share screen'; }
  mpFollow = true;
  if (mpSharing) mpStopShare();
  mpStopViewing();
  const chat = document.getElementById('mpChat');
  if (chat) chat.classList.remove('open');
}

function mpFail(text) {
  mpSetStatus(text, '');
  const overlay = document.createElement('div');
  overlay.className = 'mp-overlay';
  overlay.innerHTML = '<div class="mp-panel"><h2>Multiplayer</h2><p>' + escapeHtml(text) + '</p>' +
    '<p style="font-size:11px;color:#666;">server: ' + escapeHtml(MP_WORKER) + '</p>' +
    '<button onclick="closeMpOverlay()">Close</button></div>';
  document.body.appendChild(overlay);
}

function mpStatusText() {
  if (!mpRoomId) return 'Not connected';
  const s = mpRoomSettings;
  const count = (mpPeers.length || 1) + '/' + (s.max || 8);
  let extra = '';
  if (s.locked) extra += ' 🔒';
  if (s.nav === 'host') extra += ' · host nav';
  if (s.chat === false) extra += ' · no chat';
  if (s.cursors === false) extra += ' · no cursors';
  return (mpIsHost ? 'Hosting ' : 'In ') + mpRoomId + ' (' + count + ')' + extra;
}

function mpApplySettings(s) {
  if (!s) return;
  mpRoomSettings = s;
  mpCursorsAllowed = s.cursors !== false;
  if (s.cursors === false) mpClearCursors();
  const chatBtn = document.getElementById('mpChatBtn');
  if (chatBtn && s.chat === false) chatBtn.style.display = 'none';
  if (s.chat === false) {
    const chat = document.getElementById('mpChat');
    if (chat) chat.classList.remove('open');
  }
  mpSetStatus(mpStatusText(), mpIsHost ? 'hosting' : 'connected');
}

function mpHandleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      mpPeerId = msg.id; mpIsHost = msg.host;
      mpPeers = msg.peers || [];
      if (msg.name) { mpMyName = msg.name; mpSetWho(); }
      mpUpdatePeers();
      document.getElementById('mpChatBtn').style.display = msg.settings && msg.settings.chat === false ? 'none' : '';
      document.getElementById('mpLeaveBtn').style.display = '';
      const _followBtn = document.getElementById('mpFollowBtn');
      const _cursorsBtn = document.getElementById('mpCursorsBtn');
      const _shareBtn = document.getElementById('mpShareBtn');
      if (_followBtn) {
        _followBtn.style.display = (msg.settings && msg.settings.nav === 'off') ? 'none' : '';
        _followBtn.textContent = 'Follow: on';
      }
      if (_cursorsBtn) {
        _cursorsBtn.style.display = '';
        _cursorsBtn.textContent = 'Cursors: ' + (msg.settings && msg.settings.cursors === false ? 'off' : 'on');
      }
      if (_shareBtn) _shareBtn.style.display = '';
      mpFollow = true;
      mpApplySettings(msg.settings);
      mpAddChatMsg('', (mpIsHost ? 'room ' + mpRoomId + ' opened, you are host' : 'joined room ' + mpRoomId) +
        (msg.settings && msg.settings.locked ? ' (locked)' : ''), { sys: true });
      if (msg.settings && msg.settings.nav === 'host' && !mpIsHost) {
        mpAddChatMsg('', 'only the host can change the page in this room', { sys: true });
      }
      if (msg.currentUrl && activeTab) loadUrl(activeTab, msg.currentUrl);
      break;
    case 'peer-joined':
      mpPeers = msg.peers || mpPeers;
      mpUpdatePeers();
      mpSetStatus(mpStatusText(), mpIsHost ? 'hosting' : 'connected');
      mpAddChatMsg('', (msg.peer ? msg.peer.name : 'someone') + ' joined', { sys: true });
      // if we are sharing, start sharing to the new peer too
      if (mpSharing && mpSharingStream && mpIsHost && msg.peer) {
        mpCreateHostPeer(msg.peer.id, mpSharingStream);
      }
      break;
    case 'peer-left': {
      const gone = mpPeers.find(p => p.id === msg.id);
      mpPeers = msg.peers || mpPeers;
      mpUpdatePeers();
      mpRemoveCursor(msg.id);
      mpSetStatus(mpStatusText(), mpIsHost ? 'hosting' : 'connected');
      mpAddChatMsg('', (gone ? gone.name : 'someone') + ' left', { sys: true });
      break;
    }
    case 'room-info':
      mpApplySettings(msg.settings);
      break;
    case 'peer-renamed':
      mpPeers = msg.peers || mpPeers;
      mpUpdatePeers();
      if (msg.id === mpPeerId) { mpMyName = msg.name; mpSetWho(); }
      break;
    case 'navigate':
      if (msg.by !== mpPeerId && activeTab && msg.url) {
        if (!mpIsHost && !mpFollow) return;
        mpSuppressNav = true;
        try { loadUrl(activeTab, msg.url); } finally { mpSuppressNav = false; }
      }
      break;
    case 'chat':
      mpAddChatMsg(msg.from, msg.text, { color: mpCursorColor(msg.id || msg.from || 'x'), ts: msg.ts });
      break;
    case 'cursor':
      if (msg.id !== mpPeerId) mpUpsertCursor(msg.id, msg.name, msg.x, msg.y);
      break;
    case 'click':
      if (msg.id !== mpPeerId) mpShowClick(msg.x, msg.y);
      break;
    case 'scroll':
      if (msg.id !== mpPeerId) mpApplyScroll(msg.y);
      break;
    case 'input':
      if (msg.id !== mpPeerId) mpApplyInput(msg);
      break;
    case 'snapshot':
      if (msg.id !== mpPeerId) mpApplySnapshot(msg.html);
      break;
    case 'wordle':
      if (msg.by === mpPeerId) break;
      wdlApplyRemote(msg.guess, msg.answer);
      break;
    case 'offer':
      if (msg.to && msg.to !== mpPeerId) break;
      mpHandleOffer(msg);
      break;
    case 'answer':
      if (msg.to && msg.to !== mpPeerId) break;
      mpHandleAnswer(msg);
      break;
    case 'ice':
      if (msg.to && msg.to !== mpPeerId) break;
      mpHandleIce(msg);
      break;
    case 'share-stopped':
      mpStopViewing();
      break;
    case 'host-changed':
      mpIsHost = (msg.host === mpPeerId);
      mpSetStatus(mpIsHost ? 'Hosting ' + mpRoomId : 'Connected to ' + mpRoomId, mpIsHost ? 'hosting' : 'connected');
      break;
  }
}

// ===== LIVE CURSORS =====
const mpCursorEls = new Map();
let mpLastCursorSend = 0;

function mpCursorColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return 'hsl(' + h + ',85%,62%)';
}

function mpCursorRoot() {
  let root = document.getElementById('mpCursorLayer');
  if (!root) {
    root = document.createElement('div');
    root.id = 'mpCursorLayer';
    root.className = 'mp-cursor-layer';
    document.body.appendChild(root);
  }
  return root;
}

function mpUpsertCursor(id, name, x, y) {
  if (!id) return;
  let el = mpCursorEls.get(id);
  if (!el) {
    const color = mpCursorColor(id);
    el = document.createElement('div');
    el.className = 'mp-cursor';
    el.innerHTML = '<svg viewBox="0 0 12 18" width="14" height="20" aria-hidden="true">' +
      '<path d="M1 1 L1 15 L4.9 11.6 L7.4 17 L9.8 15.9 L7.3 10.5 L12 10 Z" fill="' + color +
      '" stroke="#0b0b12" stroke-width="1.2" stroke-linejoin="round"/></svg>' +
      '<span class="mp-cursor-label"></span>';
    el.querySelector('.mp-cursor-label').style.background = color;
    mpCursorRoot().appendChild(el);
    mpCursorEls.set(id, el);
  }
  const label = el.querySelector('.mp-cursor-label');
  const niceName = name || 'peer';
  if (label.textContent !== niceName) label.textContent = niceName;
  el.style.left = (Math.max(0, Math.min(1, x)) * 100) + '%';
  el.style.top = (Math.max(0, Math.min(1, y)) * 100) + '%';
  el.classList.add('live');
  clearTimeout(el._hideT);
  el._hideT = setTimeout(() => el.classList.remove('live'), 4000);
}

function mpRemoveCursor(id) {
  const el = mpCursorEls.get(id);
  if (el) { clearTimeout(el._hideT); el.remove(); mpCursorEls.delete(id); }
}

function mpShowClick(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:' + (x * 100) + '%;top:' + (y * 100) + '%;width:0;height:0;pointer-events:none;z-index:62;';
  const ring = document.createElement('div');
  ring.className = 'mp-click-ring';
  el.appendChild(ring);
  document.body.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (e) {} }, 700);
}

function mpApplyInput(msg) {
  const frame = activeTab && activeTab.frame;
  if (!frame || !frame.isConnected) return;
  if (!mpFollow && !mpIsHost) return;
  try {
    const doc = frame.contentDocument;
    const all = Array.from(doc.querySelectorAll('input, textarea, select'));
    const el = all[msg.idx];
    if (!el) return;
    if (msg.checked !== null && msg.checked !== undefined) {
      el.checked = !!msg.checked;
    } else {
      el.value = msg.value || '';
    }
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  } catch (e) {}
}

function mpApplySnapshot(html) {
  const frame = activeTab && activeTab.frame;
  if (!frame || !frame.isConnected) return;
  if (!mpFollow && !mpIsHost) return;
  if (typeof html !== 'string' || html.length > 40000) return;
  try {
    const doc = frame.contentDocument;
    if (doc.body) {
      const scrollY = frame.contentWindow ? frame.contentWindow.scrollY : 0;
      doc.body.innerHTML = html;
      if (frame.contentWindow) frame.contentWindow.scrollTo(0, scrollY);
    }
  } catch (e) {}
}

function mpApplyScroll(y) {
  if (!Number.isFinite(y)) return;
  if (!mpFollow && !mpIsHost) return;
  const frame = activeTab && activeTab.frame;
  if (!frame || !frame.isConnected) return;
  mpScrollLock = true;
  try {
    const doc = frame.contentDocument;
    const sh = (doc.documentElement && doc.documentElement.scrollHeight) || (doc.body && doc.body.scrollHeight) || 0;
    const max = Math.max(1, sh - frame.clientHeight);
    if (frame.contentWindow) frame.contentWindow.scrollTo(0, y * max);
  } catch (e) {}
  setTimeout(() => { mpScrollLock = false; }, 250);
}

function mpClearCursors() {
  for (const el of mpCursorEls.values()) { clearTimeout(el._hideT); el.remove(); }
  mpCursorEls.clear();
}

// normalized 0..1 coords, throttled to ~20/s
function mpSendCursor(x, y) {
  if (!mpCursorsAllowed) return;
  if (!mpWs || mpWs.readyState !== WebSocket.OPEN) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const now = Date.now();
  if (now - mpLastCursorSend < 33) return;
  mpLastCursorSend = now;
  mpWs.send(JSON.stringify({
    type: 'cursor',
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
  }));
}

let mpLastClickSend = 0;
function mpSendClick(x, y) {
  if (!mpWs || mpWs.readyState !== WebSocket.OPEN) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const now = Date.now();
  if (now - mpLastClickSend < 80) return;
  mpLastClickSend = now;
  mpWs.send(JSON.stringify({
    type: 'click',
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
  }));
}

let mpLastScrollSend = 0;
let mpScrollLock = false;
function mpSendScroll(y) {
  if (mpScrollLock) return;
  if (!mpWs || mpWs.readyState !== WebSocket.OPEN) return;
  if (!Number.isFinite(y)) return;
  const now = Date.now();
  if (now - mpLastScrollSend < 80) return;
  mpLastScrollSend = now;
  mpWs.send(JSON.stringify({ type: 'scroll', y: Math.max(0, Math.min(1, y)) }));
}

let mpLastInputSend = 0;
function mpSendInput(d) {
  if (!mpWs || mpWs.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (now - mpLastInputSend < 30) return;
  mpLastInputSend = now;
  mpWs.send(JSON.stringify({ type: 'input', idx: d.idx, tag: d.tag, itype: d.type, value: d.value, checked: d.checked }));
}

let mpLastSnapSend = 0;
function mpSendSnapshot(html) {
  if (!mpWs || mpWs.readyState !== WebSocket.OPEN) return;
  if (typeof html !== 'string' || html.length > 40000) return;
  const now = Date.now();
  if (now - mpLastSnapSend < 1500) return;
  mpLastSnapSend = now;
  mpWs.send(JSON.stringify({ type: 'snapshot', html: html }));
}

document.addEventListener('mousemove', (e) => {
  mpSendCursor(e.clientX / Math.max(1, window.innerWidth), e.clientY / Math.max(1, window.innerHeight));
}, { passive: true });

function mpSetStatus(text, cls) {
  const el = document.getElementById('mpStatus');
  el.textContent = text;
  el.className = 'mp-status ' + cls;
}

function mpUpdatePeers() {
  const container = document.getElementById('mpPeers');
  container.innerHTML = '';
  mpPeers.forEach(p => {
    const el = document.createElement('div');
    el.className = 'mp-peer';
    el.title = p.name;
    el.textContent = p.name.charAt(0).toUpperCase();
    container.appendChild(el);
  });
}

function mpLeave() {
  mpLeavingType = true;
  if (mpWs) { try { mpWs.close(1000, 'left'); } catch {} mpWs = null; }
  mpClearCursors();
  mpResetRoom();
  mpSetStatus('Not connected', '');
  mpAddChatMsg('', 'left the room', { sys: true });
}

let mpLeavingType = false;
let mpFollow = true;

function mpToggleChat() {
  const panel = document.getElementById('mpChat');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    mpClearUnread();
    const input = document.getElementById('mpChatInput');
    if (input) setTimeout(() => input.focus(), 30);
  }
}

function mpToggleFollow() {
  mpFollow = !mpFollow;
  const btn = document.getElementById('mpFollowBtn');
  if (btn) btn.textContent = 'Follow: ' + (mpFollow ? 'on' : 'off');
}

function mpToggleCursors() {
  mpCursorsAllowed = !mpCursorsAllowed;
  if (!mpCursorsAllowed) mpClearCursors();
  const btn = document.getElementById('mpCursorsBtn');
  if (btn) btn.textContent = 'Cursors: ' + (mpCursorsAllowed ? 'on' : 'off');
}

// ===== SCREEN SHARING (WebRTC) =====
let mpSharing = false;
let mpViewingShare = false;
const mpPeerConnections = new Map();
const mpIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

function mpToggleShare() {
  if (mpSharing) mpStopShare();
  else mpStartShare();
}

async function mpStartShare() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert('screen sharing is not supported in this browser');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    return; // user cancelled
  }
  mpSharing = true;
  const btn = document.getElementById('mpShareBtn');
  if (btn) btn.textContent = 'Stop sharing';
  mpSharingStream = stream;
  stream.getVideoTracks()[0].onended = () => mpStopShare();

  // create a peer connection to each existing peer
  mpPeers.forEach(p => mpCreateHostPeer(p.id, stream));
}

let mpSharingStream = null;

function mpCreateHostPeer(peerId, stream) {
  const pc = new RTCPeerConnection({ iceServers: mpIceServers });
  mpPeerConnections.set(peerId, pc);
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  pc.onicecandidate = (e) => {
    if (e.candidate && mpWs && mpWs.readyState === WebSocket.OPEN) {
      mpWs.send(JSON.stringify({ type: 'ice', to: peerId, candidate: e.candidate }));
    }
  };
  pc.createOffer().then(offer => {
    pc.setLocalDescription(offer);
    if (mpWs && mpWs.readyState === WebSocket.OPEN) {
      mpWs.send(JSON.stringify({ type: 'offer', to: peerId, sdp: offer }));
    }
  }).catch(() => {});
}

function mpStopShare() {
  mpSharing = false;
  const btn = document.getElementById('mpShareBtn');
  if (btn) btn.textContent = 'Share screen';
  if (mpSharingStream) {
    mpSharingStream.getTracks().forEach(t => t.stop());
    mpSharingStream = null;
  }
  mpPeerConnections.forEach(pc => { try { pc.close(); } catch (e) {} });
  mpPeerConnections.clear();
  if (mpWs && mpWs.readyState === WebSocket.OPEN) {
    mpWs.send(JSON.stringify({ type: 'share-stopped' }));
  }
}

function mpStopViewing() {
  mpViewingShare = false;
  const v = document.getElementById('mpShareView');
  if (v) v.style.display = 'none';
  const vid = document.getElementById('mpShareVideo');
  if (vid) vid.srcObject = null;
  mpPeerConnections.forEach(pc => { try { pc.close(); } catch (e) {} });
  mpPeerConnections.clear();
}

// guest: handle incoming offer
async function mpHandleOffer(msg) {
  const pc = new RTCPeerConnection({ iceServers: mpIceServers });
  mpPeerConnections.set(msg.from, pc);
  pc.ontrack = (e) => {
    const vid = document.getElementById('mpShareVideo');
    if (vid && e.streams && e.streams[0]) {
      vid.srcObject = e.streams[0];
      const view = document.getElementById('mpShareView');
      if (view) view.style.display = 'block';
      mpViewingShare = true;
      const label = document.getElementById('mpShareLabel');
      if (label) label.textContent = (msg.name || 'host') + ' is sharing their screen';
    }
  };
  pc.onicecandidate = (e) => {
    if (e.candidate && mpWs && mpWs.readyState === WebSocket.OPEN) {
      mpWs.send(JSON.stringify({ type: 'ice', to: msg.from, candidate: e.candidate }));
    }
  };
  await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  if (mpWs && mpWs.readyState === WebSocket.OPEN) {
    mpWs.send(JSON.stringify({ type: 'answer', to: msg.from, sdp: answer }));
  }
}

async function mpHandleAnswer(msg) {
  const pc = mpPeerConnections.get(msg.from);
  if (!pc) return;
  try { await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); } catch (e) {}
}

async function mpHandleIce(msg) {
  const pc = mpPeerConnections.get(msg.from);
  if (!pc) return;
  try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) {}
}

let mpChatDrag = null;

function mpChatDragStart(e) {
  const t = e.target;
  if (!t || (t.closest && t.closest('button, input, select, textarea, .close, .mp-chat-who'))) return;
  const panel = document.getElementById('mpChat');
  if (!panel || !panel.classList.contains('open')) return;
  const r = panel.getBoundingClientRect();
  panel.style.left = r.left + 'px';
  panel.style.top = r.top + 'px';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  mpChatDrag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
  e.preventDefault();
}

document.addEventListener('mousedown', (e) => {
  const header = e.target && e.target.closest ? e.target.closest('.mp-chat-header') : null;
  if (header) mpChatDragStart(e);
});
document.addEventListener('mousemove', (e) => {
  if (!mpChatDrag) return;
  const panel = document.getElementById('mpChat');
  if (!panel) return;
  let x = e.clientX - mpChatDrag.ox;
  let y = e.clientY - mpChatDrag.oy;
  const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
  x = Math.max(0, Math.min(maxX, x));
  y = Math.max(0, Math.min(maxY, y));
  panel.style.left = x + 'px';
  panel.style.top = y + 'px';
});
document.addEventListener('mouseup', () => { mpChatDrag = null; });

let mpMyName = '';
let mpUnread = 0;

function mpSetWho() {
  const el = document.getElementById('mpChatWho');
  if (el) el.textContent = (mpMyName || 'you') + ' (you)';
}

function mpRename() {
  const name = prompt('your name in this room:', mpMyName || '');
  if (!name) return;
  const clean = name.trim().slice(0, 24);
  if (!clean) return;
  mpMyName = clean;
  mpSetWho();
  if (mpWs && mpWs.readyState === WebSocket.OPEN) mpWs.send(JSON.stringify({ type: 'name', name: clean }));
}

function mpChatKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); mpSendChat(); }
  else if (e.key === 'Escape') { e.preventDefault(); mpToggleChat(); }
  e.stopPropagation();
}

function mpSendChat() {
  const input = document.getElementById('mpChatInput');
  if (!input) return;
  const text = input.value.trim().slice(0, 500);
  if (!text) return;
  input.value = '';
  if (!mpWs || mpWs.readyState !== WebSocket.OPEN) return;
  mpWs.send(JSON.stringify({ type: 'chat', text }));
  mpAddChatMsg((mpMyName || 'you') + ' (you)', text, { me: true });
  input.focus();
}

function mpFmtTime(ts) {
  try {
    return new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function mpAddChatMsg(name, text, opts = {}) {
  const container = document.getElementById('mpChatMessages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'mp-chat-msg' + (opts.sys ? ' sys' : '') + (opts.me ? ' me' : '');
  if (opts.sys) {
    div.textContent = text;
  } else {
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = mpFmtTime(opts.ts);
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = name + ':';
    if (opts.color) nm.style.color = opts.color;
    div.appendChild(ts);
    div.appendChild(nm);
    div.appendChild(document.createTextNode(' ' + text));
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (!opts.me && !opts.sys) {
    const panel = document.getElementById('mpChat');
    if (!panel || !panel.classList.contains('open')) mpBumpUnread();
  }
}

function mpBumpUnread() {
  mpUnread++;
  const btn = document.getElementById('mpChatBtn');
  if (!btn) return;
  let badge = btn.querySelector('.mp-chat-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'mp-chat-badge';
    btn.appendChild(badge);
  }
  badge.textContent = mpUnread > 9 ? '9+' : String(mpUnread);
}

function mpClearUnread() {
  mpUnread = 0;
  const btn = document.getElementById('mpChatBtn');
  if (!btn) return;
  const badge = btn.querySelector('.mp-chat-badge');
  if (badge) badge.remove();
}

// Hook into loadUrl to broadcast navigation
// mpSuppressNav exists because a received navigate -> loadUrl would broadcast again,
// which ping-pongs the two peers back and forth forever
let mpSuppressNav = false;
const _origLoadUrlMp = loadUrl;
loadUrl = function(tab, url) {
  _origLoadUrlMp(tab, url);
  if (mpSuppressNav) return;
  if (mpWs && mpWs.readyState === WebSocket.OPEN && tab === activeTab) {
    if (mpRoomSettings.nav === 'host' && !mpIsHost) return;
    mpWs.send(JSON.stringify({ type: 'navigate', url: url }));
  }
};

// ?join=CODE invite links open the join panel prefilled
(function mpAutoJoin() {
  const p = new URLSearchParams(location.search);
  const code = (p.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!code) return;
  setTimeout(() => mpJoin(code, p.get('pw') || '', ''), 250);
})();

