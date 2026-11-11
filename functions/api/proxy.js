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

    // Inject a script that rewrites link clicks to go through the proxy
    const proxyScript = `
<script>
(function() {
  const PROXY = '/api/proxy?url=';
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
})();
</script>`;

    html = html.replace('</head>', proxyScript + '</head>');

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
