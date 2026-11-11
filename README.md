# cf-browser

a real browser that runs entirely on cloudflare — tabs, address bar, history, bookmarks, and multiplayer rooms where everyone shares the same page with live cursors and chat.

**live:** https://cf-browser.pages.dev

## how it works

there is no backend server doing the browsing. a cloudflare pages function at `/api/proxy` fetches the target page, strips `X-Frame-Options` / `CSP`, rewrites relative links, injects a `<base>` tag and a small relay script, then hands the HTML to an iframe. your browser really is rendering the real page — cloudflare is just wearing a fake mustache.

## features

**browsing**
- tabs, back/forward, refresh, home, per-tab history
- address bar with google fallback search
- bookmarks + bookmark bar, session restore, pinned tabs
- find in page (ctrl+f), page zoom, view source, reader mode
- cookie manager, download detection, `cfb::` internal pages
- right-click tab menu

**multiplayer**
- room codes, invite links (`?join=CODE&pw=...`)
- password, max people (2–50), chat toggle, live cursors toggle, host-only navigation
- all rules enforced server-side in the durable object, not just hidden in the UI
- settings persist even after the room empties
- live cursors with per-peer colors and name pills
- chat with display names, timestamps, colored names and an unread badge
- host drives / everyone watches mode for synced browsing

## stack

| piece | what it does |
|---|---|
| `public/index.html` | the whole browser UI + client logic, single file |
| `functions/api/proxy.js` | pages function that proxies and rewrites pages |
| `worker/index.js` | durable object room: websockets, chat, cursors, rules |

## local dev

```sh
npm run dev      # wrangler pages dev public
npm run deploy   # wrangler pages deploy public
```

the multiplayer worker deploys separately:

```sh
cd worker
wrangler deploy
```

worker config lives in `worker/wrangler.toml` (`new_sqlite_classes = ["Room"]`).

## notes

- the proxy runs on cloudflare workers — sites that hard-block datacenter IPs or require a real login session will still break. that's the tradeoff for zero servers.
- nothing is stored on a server except room settings and the last visited url per room.
