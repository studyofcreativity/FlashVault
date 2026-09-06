(() => {
  // FlashVault compatibility layer for old Inkagames-era SWFs.
  // IMPORTANT: only intercept requests to the ORIGINAL game domains.
  // Never intercept Supabase Storage URLs, even if a stored path happens to
  // contain "juego_swf/check_server.txt".
  const nativeFetch = window.fetch.bind(window);
  const LEGACY_HOST_RE = /^(?:www\.)?(?:inkagames\.info|inkagames\.com|patajuegos\.com)$/i;
  const CHECK_SERVER_PATH_RE = /^\/juego_swf\/check_server\.txt(?:\?|$)/i;

  window.fetch = async function flashVaultFetch(input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
    } catch (_) {}

    let parsed = null;
    try { parsed = new URL(url, window.location.href); } catch (_) {}

    // Only fake check_server.txt when the SWF is actually requesting it from
    // an original Inkagames/Patajuegos domain. This prevents the patch from
    // hijacking Supabase uploads of a file with the same path/name.
    if (parsed && LEGACY_HOST_RE.test(parsed.hostname) && CHECK_SERVER_PATH_RE.test(parsed.pathname + parsed.search)) {
      return new Response('OK\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }

    // For package games, rewrite requests to the original legacy domains to
    // the matching file preserved inside the uploaded ZIP.
    const root = window.FLASHVAULT_PACKAGE_ROOT;
    if (parsed && root && LEGACY_HOST_RE.test(parsed.hostname)) {
      try {
        const packageBase = root.endsWith('/') ? root : root + '/';
        const rewritten = packageBase + parsed.hostname + parsed.pathname.replace(/^\/+/, '') + parsed.search;
        return nativeFetch(rewritten, init);
      } catch (_) {}
    }

    return nativeFetch(input, init);
  };

  window.FLASHVAULT_RUFFLE_COMPAT = {
    version: '1.1',
    checkServerPatched: true
  };
})();
