// Multiplayer room Durable Object

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// WebSocket.OPEN === 1 (READY_STATE_OPEN does not exist in workerd)
const WS_OPEN = 1;

const DEFAULT_SETTINGS = { password: '', max: 8, chat: true, cursors: true, nav: 'all' };

function parseSettings(params) {
  const rawMax = parseInt(params.get('max') || '', 10);
  const max = Number.isFinite(rawMax) ? Math.max(2, Math.min(50, rawMax)) : 8;
  return {
    password: String(params.get('pw') || '').slice(0, 64),
    max,
    chat: params.get('chat') !== '0',
    cursors: params.get('cursors') !== '0',
    nav: (function (r) { return r === 'off' ? 'off' : (r === 'host' ? 'host' : 'all'); })(params.get('nav')),
  };
}

const CLOSE = { BAD_PASSWORD: 4001, FULL: 4002, BAD_ROOM: 4003 };

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // ws -> { id, name }
    this.currentUrl = null;
    this.host = null;
    this.settings = null;
    state.blockConcurrencyWhile(async () => {
      this.settings = (await state.storage.get('settings')) || null;
      this.currentUrl = (await state.storage.get('url')) || null;
    });
  }

  async saveSettings(settings) {
    this.settings = settings;
    try { await this.state.storage.put('settings', settings); } catch {}
  }

  // settings that are safe to hand to clients - never the password
  publicInfo() {
    const s = this.settings || DEFAULT_SETTINGS;
    return {
      locked: !!s.password,
      max: s.max,
      chat: s.chat,
      cursors: s.cursors,
      nav: s.nav,
      peers: this.sessions.size,
    };
  }

  reject(server, code, reason) {
    try {
      server.accept();
      server.send(JSON.stringify({ type: 'rejected', code, reason }));
      server.close(code, reason);
    } catch {}
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    const params = url.searchParams;

    if (upgrade === 'websocket') {
      // first peer opening this code decides the room rules
      if (params.get('create') === '1' && !this.settings) {
        await this.saveSettings(parseSettings(params));
      }
      const settings = this.settings || DEFAULT_SETTINGS;

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      if (settings.password && String(params.get('pw') || '') !== settings.password) {
        this.reject(server, CLOSE.BAD_PASSWORD, 'bad-password');
      } else if (this.sessions.size >= settings.max) {
        this.reject(server, CLOSE.FULL, 'full');
      } else {
        await this.handleSession(server, settings);
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/init') {
      if (!this.settings) await this.saveSettings(parseSettings(params));
      return json({ ok: true, settings: this.publicInfo() });
    }

    if (url.pathname === '/info') {
      return json({
        peers: this.getPeerList(),
        host: this.host,
        currentUrl: this.currentUrl,
        settings: this.publicInfo(),
      });
    }

    return json({ error: 'not found' }, 404);
  }

  async handleSession(ws, settings) {
    ws.accept();
    const id = crypto.randomUUID().slice(0, 8);
    const session = { id, name: 'User ' + id.slice(0, 4), joinedAt: Date.now() };
    this.sessions.set(ws, session);

    if (!this.host) this.host = id;

    ws.send(JSON.stringify({
      type: 'welcome',
      id,
      name: session.name,
      host: this.host === id,
      peers: this.getPeerList(),
      currentUrl: this.currentUrl,
      settings: this.publicInfo(),
    }));

    this.broadcast({ type: 'peer-joined', peer: session, peers: this.getPeerList() }, ws);
    this.broadcast({ type: 'room-info', settings: this.publicInfo() }, null);

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      const isHost = this.host === id;

      switch (msg.type) {
        case 'navigate':
          if (settings.nav === 'off') return;
          if (settings.nav === 'host' && !isHost) return;
          this.currentUrl = msg.url;
          this.state.storage.put('url', msg.url).catch(() => {});
          this.broadcast({ type: 'navigate', url: msg.url, by: id }, ws);
          break;
        case 'chat': {
          if (!settings.chat) return;
          const text = String(msg.text || '').slice(0, 500);
          if (!text.trim()) return;
          this.broadcast({ type: 'chat', from: session.name, id, text, ts: Date.now() }, ws);
          break;
        }
        case 'name':
          session.name = String(msg.name || '').slice(0, 24) || session.name;
          this.broadcast({ type: 'peer-renamed', id, name: session.name, peers: this.getPeerList() }, null);
          break;
        case 'cursor':
          if (!settings.cursors) return;
          this.broadcast({
            type: 'cursor',
            id,
            name: session.name,
            x: Math.max(0, Math.min(1, Number(msg.x) || 0)),
            y: Math.max(0, Math.min(1, Number(msg.y) || 0)),
          }, ws);
          break;
        case 'click':
          if (!settings.cursors) return;
          this.broadcast({
            type: 'click',
            id,
            x: Math.max(0, Math.min(1, Number(msg.x) || 0)),
            y: Math.max(0, Math.min(1, Number(msg.y) || 0)),
          }, ws);
          break;
        case 'scroll':
          if (settings.nav === 'off') return;
          this.broadcast({ type: 'scroll', id, y: Math.max(0, Math.min(1, Number(msg.y) || 0)) }, ws);
          break;
        case 'ping':
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
          break;
      }
    });

    const drop = () => {
      if (!this.sessions.has(ws)) return;
      this.sessions.delete(ws);
      if (this.host === id) {
        const next = this.sessions.values().next().value;
        this.host = next ? next.id : null;
        if (next) this.broadcast({ type: 'host-changed', host: this.host }, null);
      }
      this.broadcast({ type: 'peer-left', id, peers: this.getPeerList() }, null);
      this.broadcast({ type: 'room-info', settings: this.publicInfo() }, null);
    };

    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
  }

  getPeerList() {
    return Array.from(this.sessions.values()).map(s => ({ id: s.id, name: s.name }));
  }

  broadcast(msg, exclude) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.sessions) {
      if (ws !== exclude && ws.readyState === WS_OPEN) {
        try { ws.send(data); } catch {}
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'cf-browser-mp' });
    }

    if (url.pathname === '/create') {
      const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      await stub.fetch(new Request('https://internal/init?' + url.searchParams.toString()));
      const info = await stub.fetch(new Request('https://internal/info'));
      const data = await info.json();
      return json({ roomId, settings: data.settings });
    }

    if (url.pathname.startsWith('/room/')) {
      const roomId = url.pathname.split('/')[2];
      if (!roomId) return json({ error: 'missing room id' }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/info/')) {
      const roomId = url.pathname.split('/')[2];
      if (!roomId) return json({ error: 'missing room id' }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      return stub.fetch(new Request('https://internal/info'));
    }

    return json({ error: 'not found' }, 404);
  },
};
