(() => {
  // FlashVault compatibility + resource diagnostics.
  // The diagnostics layer records requests made through fetch/XHR so a game can
  // be inspected without opening browser developer tools.
  const nativeFetch = window.fetch.bind(window);
  const NativeXHR = window.XMLHttpRequest;
  const CHECK_SERVER_RE = /\/juego_swf\/check_server\.txt(?:\?|$)/i;
  const MAX_LOG = 500;
  const resourceLog = [];
  let diagnosticsEnabled = false;

  function normalizeUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href).href;
      if (input && typeof input.url === 'string') return new URL(input.url, location.href).href;
    } catch (_) {}
    return String(input || '');
  }

  function safeErrorMessage(error) {
    return error && error.message ? error.message : String(error || 'Unknown error');
  }

  function recordResource(entry) {
    if (!diagnosticsEnabled) return null;
    const item = {
      id: resourceLog.length + 1,
      time: new Date().toISOString(),
      url: entry.url || '',
      method: entry.method || 'GET',
      type: entry.type || 'fetch',
      status: Number.isFinite(entry.status) ? entry.status : null,
      ok: entry.ok === true,
      error: entry.error || null,
      patched: entry.patched === true,
      durationMs: Number.isFinite(entry.durationMs) ? Math.round(entry.durationMs) : null
    };
    resourceLog.push(item);
    if (resourceLog.length > MAX_LOG) resourceLog.shift();

    window.dispatchEvent(new CustomEvent('flashvault:resource', { detail: item }));
    return item;
  }

  function isCheckServer(url) {
    return CHECK_SERVER_RE.test(url);
  }

  window.FLASHVAULT_RUFFLE_COMPAT = {
    version: '2.0',
    checkServerPatched: true,
    getNetworkLog() { return resourceLog.slice(); },
    clearNetworkLog() {
      resourceLog.length = 0;
      window.dispatchEvent(new CustomEvent('flashvault:resource-clear'));
    },
    setDiagnosticsEnabled(enabled) {
      diagnosticsEnabled = !!enabled;
      if (!diagnosticsEnabled) resourceLog.length = 0;
      window.dispatchEvent(new CustomEvent('flashvault:resource-mode', { detail: { enabled: diagnosticsEnabled } }));
    },
    isDiagnosticsEnabled() { return diagnosticsEnabled; }
  };

  window.fetch = async function flashVaultFetch(input, init) {
    const url = normalizeUrl(input);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const started = performance.now();

    if (isCheckServer(url)) {
      const result = new Response('OK\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-FlashVault-Patched': 'check_server'
        }
      });
      recordResource({
        url,
        method,
        type: 'fetch',
        status: 200,
        ok: true,
        patched: true,
        durationMs: performance.now() - started
      });
      return result;
    }

    try {
      const response = await nativeFetch(input, init);
      recordResource({
        url,
        method,
        type: 'fetch',
        status: response.status,
        ok: response.ok,
        durationMs: performance.now() - started
      });
      return response;
    } catch (error) {
      recordResource({
        url,
        method,
        type: 'fetch',
        status: null,
        ok: false,
        error: safeErrorMessage(error),
        durationMs: performance.now() - started
      });
      throw error;
    }
  };

  class FlashVaultXHR extends NativeXHR {
    #startedAt = 0;
    #url = '';
    #method = 'GET';

    open(method, url, ...rest) {
      this.#method = String(method || 'GET').toUpperCase();
      this.#url = normalizeUrl(url);
      return super.open(method, url, ...rest);
    }

    send(body) {
      this.#startedAt = performance.now();
      const done = () => {
        recordResource({
          url: this.#url,
          method: this.#method,
          type: 'xhr',
          status: this.status || null,
          ok: this.status >= 200 && this.status < 400,
          durationMs: performance.now() - this.#startedAt
        });
        cleanup();
      };
      const failed = (event) => {
        recordResource({
          url: this.#url,
          method: this.#method,
          type: 'xhr',
          status: this.status || null,
          ok: false,
          error: event && event.type ? event.type : 'network error',
          durationMs: performance.now() - this.#startedAt
        });
        cleanup();
      };
      const cleanup = () => {
        this.removeEventListener('load', done);
        this.removeEventListener('error', failed);
        this.removeEventListener('abort', failed);
        this.removeEventListener('timeout', failed);
      };

      this.addEventListener('load', done, { once: true });
      this.addEventListener('error', failed, { once: true });
      this.addEventListener('abort', failed, { once: true });
      this.addEventListener('timeout', failed, { once: true });
      return super.send(body);
    }
  }

  try {
    window.XMLHttpRequest = FlashVaultXHR;
  } catch (_) {
    // Some environments may expose XMLHttpRequest as a non-configurable global.
  }

  // Extra visibility for resource errors that escape fetch/XHR instrumentation.
  window.addEventListener('error', (event) => {
    const target = event && event.target;
    if (!target || target === window) return;
    const src = target.src || target.href;
    if (!src) return;
    recordResource({
      url: normalizeUrl(src),
      method: 'GET',
      type: target.tagName ? target.tagName.toLowerCase() : 'resource',
      status: null,
      ok: false,
      error: 'resource-load-error'
    });
  }, true);
})();
