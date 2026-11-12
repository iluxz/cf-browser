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
    const cookieHeader = request.headers.get('Cookie') || '';
    let currentUrl = targetUrl.toString();
    let resp;
    let allCookies = [];
    let redirects = 0;
    // Follow redirects manually so we can capture Set-Cookie from each hop
    while (redirects < 10) {
      resp = await fetch(currentUrl, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        },
        redirect: 'manual',
      });
      const sc = (typeof resp.headers.getSetCookie === 'function')
        ? resp.headers.getSetCookie()
        : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);
allCookies = allCookies.concat(sc.map(c => {
  let cleaned = c.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Secure/gi, '');
  // ensure path is root so cookies work across the proxy
  if (!/;\s*Path=/i.test(cleaned)) cleaned += '; Path=/';
  else cleaned = cleaned.replace(/;\s*Path=[^;]*/gi, '; Path=/');
  return cleaned;
}));
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (loc) {
          currentUrl = new URL(loc, currentUrl).toString();
          redirects++;
          continue;
        }
      }
      break;
    }

    const contentType = resp.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');

    // Forward Set-Cookie headers (strip Domain so cookies bind to the proxy origin)
    // allCookies already collected from all redirect hops (see redirect loop above)
    if (!isHtml) {
      // Pass through non-HTML (images, css, js) with CORS headers
      const body = await resp.arrayBuffer();
      const h = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      };
      if (allCookies.length) h['Set-Cookie'] = allCookies;
      return new Response(body, { status: resp.status, headers: h });
    }

    let html = await resp.text();

    // Rewrite the base URL so relative links work
    const base = targetUrl.origin + targetUrl.pathname.replace(/\/[^\/]*$/, '/');
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);

    // Rewrite subresource URLs (scripts, stylesheets, images, modules) so JS
    // apps load their assets through the proxy instead of fetching directly
    // from the origin (which gets CORS-blocked or fails).
    const AD_DOMAINS = /doubleclick\.net|googlesyndication\.com|googleadservices\.com|googletagmanager\.com|google-analytics\.com|facebook\.com\/tr|analytics\.|ads\.|tracking\.|tracker\./i;
    const PROXY_PREFIX = url.origin + '/api/proxy?url=';
    function toProxy(u) {
      if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:') || u.startsWith('#') || u.startsWith('mailto:')) return u;
      try {
        const resolved = new URL(u, base).href;
        if (AD_DOMAINS.test(resolved)) return null; // block ads
        if (resolved.startsWith(PROXY_PREFIX)) return u;
        return PROXY_PREFIX + encodeURIComponent(resolved);
      } catch { return u; }
    }
    // Remove script/link tags pointing to ad domains entirely
    html = html.replace(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi, function(m, src) {
      try { if (AD_DOMAINS.test(new URL(src, base).href)) return ''; } catch {}
      return m;
    });
    html = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi, function(m, href) {
      try { if (AD_DOMAINS.test(new URL(href, base).href)) return ''; } catch {}
      return m;
    });
    html = html.replace(/(src|href)\s*=\s*"([^"]*)"/gi, function(m, attr, val) {
      const nu = toProxy(val);
      return nu === val ? m : attr + '="' + nu + '"';
    });
    html = html.replace(/(src|href)\s*=\s*'([^']*)'/gi, function(m, attr, val) {
      const nu = toProxy(val);
      return nu === val ? m : attr + "='" + nu + "'";
    });

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
  function handleFormSubmit(form) {
    if (!form) return;
    let action = form.action || window.location.href;
    const method = (form.method || 'get').toLowerCase();
    if (method === 'get') {
      try {
        const u = new URL(action, window.location.href);
        const fd = new FormData(form);
        for (const [k, v] of fd.entries()) {
          if (v !== null && v !== undefined) u.searchParams.set(k, v);
        }
        action = u.toString();
      } catch (err) {}
    }
    const newUrl = rewriteUrl(action);
    window.parent.postMessage({ type: 'navigate', url: newUrl }, '*');
  }
  // Let the page's own JS drive navigation (bing etc. use location.href), but
  // route it through the parent so it stays inside the proxy.
  try {
    const origAssign = window.location.assign.bind(window.location);
    const origReplace = window.location.replace.bind(window.location);
    window.location.assign = function(u) { window.parent.postMessage({ type: 'navigate', url: rewriteUrl(String(u)) }, '*'); };
    window.location.replace = function(u) { window.parent.postMessage({ type: 'navigate', url: rewriteUrl(String(u)) }, '*'); };
  } catch (e) {}
  try {
    const locProto = Object.getPrototypeOf(window.location);
    const desc = Object.getOwnPropertyDescriptor(locProto, 'href');
    if (desc && desc.set) {
      Object.defineProperty(locProto, 'href', {
        get: desc.get,
        set: function(v) {
          window.parent.postMessage({ type: 'navigate', url: rewriteUrl(String(v)) }, '*');
        }
      });
    }
  } catch (e) {}
  // Intercept clicks on submit buttons in capture phase, before page JS can mutate form fields
  document.addEventListener('click', function(e) {
    const t = e.target;
    if (!t) return;
    const btn = t.closest ? t.closest('button, input[type="submit"], input[type="image"]') : null;
    if (!btn) return;
    const form = btn.form || (btn.closest ? btn.closest('form') : null);
    if (!form) return;
    if (btn.tagName === 'BUTTON' && btn.getAttribute('type') && btn.getAttribute('type').toLowerCase() !== 'submit') return;
    if (btn.tagName === 'INPUT' && btn.type !== 'submit' && btn.type !== 'image') return;

    e.preventDefault();
    e.stopPropagation();

    let action = form.action || window.location.href;
    const method = (form.method || 'get').toLowerCase();
    if (method === 'get') {
      try {
        const u = new URL(action, window.location.href);
        const fields = form.querySelectorAll('input, select, textarea');
        fields.forEach(function(el) {
          if (!el.name) return;
          if (el.type === 'checkbox' || el.type === 'radio') {
            if (el.checked) u.searchParams.set(el.name, el.value);
          } else if (el.type !== 'submit' && el.type !== 'button' && el.type !== 'image' && el.type !== 'reset' && el.type !== 'file') {
            const lname = (el.name || '').toLowerCase();
            let val = el.value;
            if ((lname === 'q' || lname.indexOf('search') !== -1 || lname.indexOf('query') !== -1) && mpLastSearchValue) {
              val = mpLastSearchValue;
            }
            u.searchParams.set(el.name, val);
          }
        });
        action = u.toString();
      } catch (err) {}
    }
    const newUrl = rewriteUrl(action);
    window.parent.postMessage({ type: 'navigate', url: newUrl }, '*');
  }, true);

  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form) return;
    e.preventDefault();
    e.stopPropagation();
    handleFormSubmit(form);
  }, true);
  try {
    const origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() { handleFormSubmit(this); };
  } catch (e) {}
  // Intercept link clicks (already there) but NOT submit buttons, so page JS can run first.
  // Override window.open
  const origOpen = window.open;
  window.open = function(u) { window.parent.postMessage({ type: 'navigate', url: rewriteUrl(String(u)) }, '*'); return null; };
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
  // Track the last real value typed into search-like inputs. Bing etc. overwrite
  // the field with "javascript:void(0)" on submit, so we capture it earlier.
  var mpLastSearchValue = '';
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const origSet = desc.set;
    const origGet = desc.get;
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      get: function() { return origGet.call(this); },
      set: function(v) {
        const name = (this.name || this.id || '').toLowerCase();
        if (name.indexOf('q') !== -1 || name.indexOf('search') !== -1 || name.indexOf('query') !== -1) {
          if (v && v !== 'javascript:void(0)' && String(v).trim().length > 0) {
            mpLastSearchValue = String(v);
          }
        }
        origSet.call(this, v);
      }
    });
  } catch (e) {}
  document.addEventListener('input', function(e) {
    const t = e.target;
    if (!t) return;
    const name = (t.name || t.id || '').toLowerCase();
    if (name.indexOf('q') !== -1 || name.indexOf('search') !== -1 || name.indexOf('query') !== -1) {
      if (t.value && t.value !== 'javascript:void(0)') mpLastSearchValue = t.value;
    }
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
  // Apply user extensions (CSS + JS from localStorage)
  try {
    var extCss = localStorage.getItem('cfb_ext_css');
    if (extCss) {
      var styleEl = document.createElement('style');
      styleEl.textContent = extCss;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    var extJs = localStorage.getItem('cfb_ext_js');
    if (extJs) {
      var scriptEl = document.createElement('script');
      scriptEl.textContent = extJs;
      (document.head || document.documentElement).appendChild(scriptEl);
    }
  } catch (e) {}
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
    const htmlHeaders = {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    };
    if (allCookies.length) htmlHeaders['Set-Cookie'] = allCookies;
    return new Response(html, {
      status: resp.status,
      headers: htmlHeaders,
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 502 });
  }
}
