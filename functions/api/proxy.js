export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  if (!target) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  // Block non-http(s)
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return new Response('Only http/https allowed', { status: 400 });
  }

  try {
    const resp = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    const contentType = resp.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    if (!isHtml) {
      // Pass through non-HTML (images, css, js) with CORS headers
      const body = await resp.arrayBuffer();
      return new Response(body, {
        status: resp.status,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    let html = await resp.text();

    // Rewrite the base URL so relative links work
    const base = targetUrl.origin + targetUrl.pathname.replace(/\/[^\/]*$/, '/');
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);

    // Absolute proxy url: a relative "/api/proxy?url=" gets resolved against the
    // target's <base>, which is what made youtube/gmail throw SecurityError and go blank
    const proxyBase = JSON.stringify(url.origin + '/api/proxy?url=');

    // Inject a script that rewrites link clicks to go through the proxy
    const proxyScript = `
<script>
(function() {
  const PROXY = ${proxyBase};
  function rewriteUrl(u) {
    if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:') || u.startsWith('#')) return u;
    try {
      const resolved = new URL(u, window.location.href).href;
      if (resolved.startsWith(window.location.origin + '/api/proxy')) return u;
      return PROXY + encodeURIComponent(resolved);
    } catch { return u; }
  }
  // Intercept link clicks
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a');
    if (a && a.href) {
      e.preventDefault();
      const newUrl = rewriteUrl(a.href);
      window.parent.postMessage({ type: 'navigate', url: newUrl }, '*');
    }
  }, true);
  // Rewrite form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action) {
      e.preventDefault();
      const newUrl = rewriteUrl(form.action);
      window.parent.postMessage({ type: 'navigate', url: newUrl }, '*');
    }
  }, true);
  // Relay cursor position so peers can see it even over this page
  var lastCursor = 0;
  window.addEventListener('mousemove', function(e) {
    var now = Date.now();
    if (now - lastCursor < 33) return;
    lastCursor = now;
    window.parent.postMessage({
      type: 'cursor',
      x: e.clientX / Math.max(1, window.innerWidth),
      y: e.clientY / Math.max(1, window.innerHeight)
    }, '*');
  }, { passive: true });
  // Relay clicks so peers can see what you are actually doing, not just the cursor
  document.addEventListener('click', function(e) {
    try {
      window.parent.postMessage({
        type: 'click',
        x: e.clientX / Math.max(1, window.innerWidth),
        y: e.clientY / Math.max(1, window.innerHeight)
      }, '*');
    } catch (err) {}
  }, true);
  // Relay form input changes so peers see typing, toggles, and selections
  function mpInputIndex(el) {
    const all = Array.from(document.querySelectorAll('input, textarea, select'));
    return all.indexOf(el);
  }
  function relayInput(el) {
    if (!el) return;
    const idx = mpInputIndex(el);
    if (idx < 0) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let value = '';
    let checked = null;
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      checked = !!el.checked;
    } else if (tag === 'select') {
      value = el.value;
    } else {
      value = el.value;
    }
    try {
      window.parent.postMessage({ type: 'input', idx, tag, type, value, checked }, '*');
    } catch (e) {}
  }
  document.addEventListener('input', function(e) { relayInput(e.target); }, true);
  document.addEventListener('change', function(e) { relayInput(e.target); }, true);
  // Relay structural DOM changes as a throttled snapshot so peers see dynamic content
  var lastSnap = 0;
  var snapTimer = null;
  function scheduleSnap() {
    if (snapTimer) return;
    snapTimer = setTimeout(function() {
      snapTimer = null;
      var now = Date.now();
      if (now - lastSnap < 1500) return;
      lastSnap = now;
      try {
        var html = document.body ? document.body.innerHTML : '';
        if (html.length > 40000) return;
        window.parent.postMessage({ type: 'snapshot', html: html }, '*');
      } catch (e) {}
    }, 400);
  }
  try {
    var mo = new MutationObserver(function() { scheduleSnap(); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  } catch (e) {}
  // Relay scroll position so followers stay in sync
  var lastScroll = 0;
  window.addEventListener('scroll', function() {
    var now = Date.now();
    if (now - lastScroll < 60) return;
    lastScroll = now;
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.parent.postMessage({ type: 'scroll', y: window.scrollY / max }, '*');
  }, { passive: true });
  // Tell the browser shell when the page's own scripts die, so it can show a
  // useful message instead of leaving a silent white screen
  var reported = 0;
  function reportError(text) {
    if (reported >= 3) return;
    reported++;
    try {
      window.parent.postMessage({ type: 'pageerror', message: String(text || '').slice(0, 200) }, '*');
    } catch (e) {}
  }
  window.addEventListener('error', function(e) {
    if (e && e.message) reportError(e.message);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var r = e && e.reason;
    reportError((r && (r.message || r)) || 'unhandled promise rejection');
  });
})();
</script>`;

    // inject before </head>, but plenty of pages omit it or write </HEAD>
    if (/<\/head\s*>/i.test(html)) {
      html = html.replace(/<\/head\s*>/i, proxyScript + '</head>');
    } else if (/<body[^>]*>/i.test(html)) {
      html = html.replace(/<body[^>]*>/i, (m) => m + proxyScript);
    } else {
      html = proxyScript + html;
    }

    // Strip X-Frame-Options and CSP by not forwarding them
    return new Response(html, {
      status: resp.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 502 });
  }
}
