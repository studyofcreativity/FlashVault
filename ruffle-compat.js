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
      return new Response('OK\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }

    return nativeFetch(input, init);
  };

  window.FLASHVAULT_RUFFLE_COMPAT = {
    version: '1.0',
    checkServerPatched: true
  };
})();
