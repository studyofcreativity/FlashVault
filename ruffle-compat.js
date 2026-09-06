(() => {
  // FlashVault compatibility layer for old Flash games.
  // Some legacy Inkagames-era SWFs request check_server.txt from old domains
  // that no longer resolve or do not allow browser CORS requests. Ruffle uses
  // the page's fetch API for these requests, so we provide a harmless local
  // 200 response for that server-check resource instead of letting it crash
  // the movie's loading flow.
  const nativeFetch = window.fetch.bind(window);
  const CHECK_SERVER_RE = /\/juego_swf\/check_server\.txt(?:\?|$)/i;

  window.fetch = async function flashVaultFetch(input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
    } catch (_) {}

    if (CHECK_SERVER_RE.test(url)) {
      const response = new Response('OK\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
      // Some Ruffle/browser paths call response.json() even though the
      // original Inkagames check_server.txt is plain text. Keep text()
      // compatible with the original file, but make json() harmless too.
      response.json = async () => ({ ok: true, value: 'OK' });
      return response;
    }

    // A Flashpoint/Inkagames package can contain resources under several
    // legacy domains. When the package was uploaded to Supabase, rewrite
    // those absolute requests to the corresponding file inside the package.
    const root = window.FLASHVAULT_PACKAGE_ROOT;
    if (root && /^https?:\/\/(?:www\.)?(?:inkagames\.info|inkagames\.com|patajuegos\.com)(?:\/|$)/i.test(url)) {
      try {
        const u = new URL(url);
        const packageBase = root.endsWith('/') ? root : root + '/';
        const rewritten = packageBase + u.hostname + u.pathname.replace(/^\/+/, '') + u.search;
        return nativeFetch(rewritten, init);
      } catch (_) {}
    }

    return nativeFetch(input, init);
  };

  window.FLASHVAULT_RUFFLE_COMPAT = {
    version: '1.0',
    checkServerPatched: true
  };
})();
