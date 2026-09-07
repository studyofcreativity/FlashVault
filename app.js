(() => {
  const cfg = window.FLASHVAULT_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
    $('status').textContent = 'Configura primero config.js con tu URL y publishable key de Supabase.';
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const gamesGrid = $('gamesGrid');
  const status = $('status');

  let games = [];
  let activePlayer = null;
  let activeRuffleApi = null;
  let activeGameId = null;
  let activeGameTitle = '';
  let fullscreenCleanup = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[ch]));

  function openModal(id) {
    $(id).classList.add('open');
    $(id).setAttribute('aria-hidden', 'false');
  }

  function setAnalyzingStatus(text) {
    let el = document.getElementById('playerAnalyzing');
    if (!el) {
      el = document.createElement('p');
      el.id = 'playerAnalyzing';
      el.className = 'muted';
      el.style.margin = '10px 0 0';
      el.style.fontSize = '.85rem';
      const titleWrap = $('playerModal').querySelector('.player-title-wrap');
      (titleWrap || $('playerModal').querySelector('.modal-close'))?.after(el);
    }
    if (text) { el.textContent = text; el.style.display = ''; }
    else { el.style.display = 'none'; }
  }

  async function stopActiveGame() {
    try {
      if (fullscreenCleanup) { try { fullscreenCleanup(); } catch (_) {} fullscreenCleanup = null; }
      if (activeRuffleApi) {
        try { activeRuffleApi.exitFullscreen?.(); } catch (_) {}
        try { activeRuffleApi.suspend?.(); } catch (_) {}
        try { activeRuffleApi.volume = 0; } catch (_) {}
      }
      if (activePlayer) {
        try { activePlayer.pause?.(); } catch (_) {}
        try { activePlayer.volume = 0; } catch (_) {}
        try { activePlayer.remove(); } catch (_) {}
      }
    } finally {
      activePlayer = null;
      activeRuffleApi = null;
      activeGameId = null;
      activeGameTitle = '';
      $('ruffleHost').replaceChildren();
      $('ruffleHost').style.aspectRatio = '';
      setAnalyzingStatus(null);
    }
  }

  function closePlayerModal() {
    stopActiveGame();
    $('playerError').classList.add('hidden');
    $('fullscreenBtn').disabled = true;
    $('fullscreenBtn').textContent = '⛶ Pantalla completa';
    $('playerModal').classList.remove('open');
    $('playerModal').setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', async () => {
      if (el.dataset.close === 'player') await closePlayerModal();
    });
  });

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && $('playerModal').classList.contains('open')) await closePlayerModal();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeRuffleApi) {
      try { activeRuffleApi.suspend?.(); } catch (_) {}
    }
  });

  function encodePath(path) {
    return String(path || '').split('/').map(encodeURIComponent).join('/');
  }

  function normalizePackagePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^content\//i, '');
  }

  function publicPackageUrl(prefix, path = '') {
    const base = String(cfg.SUPABASE_URL).replace(/\/$/, '') + '/storage/v1/object/public/flash-games/';
    return base + encodePath(prefix) + (path ? '/' + encodePath(normalizePackagePath(path)) : '');
  }

  function dirname(path) {
    const p = normalizePackagePath(path);
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(0, i + 1) : '';
  }

  function commonRuffleOptions() {
    return {
      allowNetworking: 'all',
      allowFullscreen: true,
      allowScriptAccess: true,
      compatibilityRules: true,
      autoplay: 'on',
      playerRuntime: 'flashPlayer',
      upgradeToHttps: true,
      quality: 'high',
      scale: 'showAll',
      forceScale: false,
      wmode: 'window',
      splashScreen: false,
      showSwfDownload: false,
      contextMenu: 'on',
      logLevel: 'debug',
      // preferredRenderer se deja SIN definir a propósito: así Ruffle elige
      // el renderer más compatible con el navegador/GPU del visitante, igual
      // que hace la demo oficial de Ruffle. El análisis por-juego de más
      // abajo puede reactivar 'canvas' cuando confirma que es seguro.
    };
  }

  // ===================================================================
  // Análisis binario del SWF: lee la cabecera y recorre TODOS los tags
  // del archivo para detectar qué necesita ese juego en particular, y así
  // elegir automáticamente el wmode/renderer/calidad más adecuados antes
  // de reproducirlo. Si algo falla (red, SWF comprimido con LZMA, CORS),
  // se descarta el análisis y se usa la configuración segura por defecto.
  // ===================================================================

  async function fetchBytes(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { cache: 'force-cache', signal: controller.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return new Uint8Array(await resp.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  async function inflateZlib(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (_) {
      return null;
    }
  }

  class BitReader {
    constructor(bytes, byteOffset = 0) {
      this.bytes = bytes;
      this.bytePos = byteOffset;
      this.bitPos = 0;
    }
    readBits(n) {
      let value = 0;
      for (let i = 0; i < n; i++) {
        const byte = this.bytes[this.bytePos] || 0;
        const bit = (byte >> (7 - this.bitPos)) & 1;
        value = (value << 1) | bit;
        this.bitPos++;
        if (this.bitPos === 8) { this.bitPos = 0; this.bytePos++; }
      }
      return value >>> 0;
    }
    readSBits(n) {
      const v = this.readBits(n);
      return (n > 0 && (v & (1 << (n - 1)))) ? v - (1 << n) : v;
    }
    align() { if (this.bitPos !== 0) { this.bitPos = 0; this.bytePos++; } }
  }

  // Recorre el cuerpo (ya descomprimido) de un SWF y extrae señales reales
  // sobre cómo está construida la película.
  function parseSwfInfo(bytes) {
    const info = {
      isAS3: false, hasBlendMode: false, hasFilterList: false, hasCacheAsBitmap: false,
      hasStreamingSound: false, bitmapTagCount: 0, shapeTagCount: 0, spriteTagCount: 0,
      frameWidth: null, frameHeight: null, frameRate: null, frameCount: null,
      backgroundColor: null, totalTags: 0,
    };

    const br = new BitReader(bytes, 8); // salta signature(3)+version(1)+fileLength(4)
    const nbits = br.readBits(5);
    const xmin = br.readSBits(nbits), xmax = br.readSBits(nbits);
    const ymin = br.readSBits(nbits), ymax = br.readSBits(nbits);
    br.align();
    info.frameWidth = Math.round((xmax - xmin) / 20);
    info.frameHeight = Math.round((ymax - ymin) / 20);

    let pos = br.bytePos;
    info.frameRate = ((bytes[pos + 1] << 8) | bytes[pos]) / 256;
    pos += 2;
    info.frameCount = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2;

    const total = bytes.length;
    while (pos + 2 <= total) {
      const codeAndLength = bytes[pos] | (bytes[pos + 1] << 8);
      pos += 2;
      const tagCode = codeAndLength >> 6;
      let tagLength = codeAndLength & 0x3f;
      if (tagLength === 0x3f) {
        if (pos + 4 > total) break;
        tagLength = (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) >>> 0;
        pos += 4;
      }
      if (pos + tagLength > total) break; // archivo truncado/corrupto: paramos sin romper nada
      info.totalTags++;

      switch (tagCode) {
        case 0: pos = total; break; // End
        case 9: // SetBackgroundColor
          if (tagLength >= 3) info.backgroundColor = `rgb(${bytes[pos]},${bytes[pos+1]},${bytes[pos+2]})`;
          break;
        case 69: // FileAttributes: bit 0x08 = ActionScript3
          info.isAS3 = !!(bytes[pos] & 0x08);
          break;
        case 82: // DoABC -> bytecode AS3
          info.isAS3 = true;
          break;
        case 70: { // PlaceObject3: banderas de blend mode / filtros / cacheAsBitmap
          const flagsByte0 = bytes[pos];
          info.hasCacheAsBitmap = info.hasCacheAsBitmap || !!(flagsByte0 & 0x04);
          info.hasBlendMode = info.hasBlendMode || !!(flagsByte0 & 0x02);
          info.hasFilterList = info.hasFilterList || !!(flagsByte0 & 0x01);
          break;
        }
        case 6: case 21: case 35: case 90: // DefineBits(JPEG/JPEG2/JPEG3/JPEG4)
        case 20: case 36: // DefineBitsLossless(2)
          info.bitmapTagCount++;
          break;
        case 2: case 22: case 32: case 83: // DefineShape(2/3/4)
          info.shapeTagCount++;
          break;
        case 39: // DefineSprite
          info.spriteTagCount++;
          break;
        case 18: case 45: case 19: // SoundStreamHead(2), SoundStreamBlock
          info.hasStreamingSound = true;
          break;
      }
      pos += tagLength;
    }
    return info;
  }

  async function analyzeGameSwf(url) {
    try {
      const bytes = await fetchBytes(url);
      const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
      let body = bytes;
      if (signature === 'CWS') {
        const inflated = await inflateZlib(bytes.slice(8));
        if (!inflated) return null; // el navegador no pudo descomprimir: sin análisis
        body = new Uint8Array(8 + inflated.length);
        body.set(bytes.slice(0, 8), 0);
        body.set(inflated, 8);
      } else if (signature !== 'FWS') {
        return null; // ZWS (LZMA) u otro formato: no lo analizamos
      }
      return parseSwfInfo(body);
    } catch (err) {
      console.warn('[FlashVault] No se pudo analizar el SWF para autoconfigurar Ruffle:', err);
      return null;
    }
  }

  // A partir de lo detectado en el SWF, decide la configuración de Ruffle
  // más adecuada para ESE juego en particular.
  function chooseOptionsForSwf(info) {
    const richVisuals = info.hasBlendMode || info.hasFilterList || info.hasCacheAsBitmap
      || info.bitmapTagCount > 3 || info.isAS3;
    const patch = {
      quality: info.bitmapTagCount > info.shapeTagCount ? 'medium' : 'high',
    };
    if (richVisuals) {
      // Blend modes, filtros, cacheAsBitmap o AS3 con muchos bitmaps: el modo
      // más compatible es dejar que Ruffle elija el renderer y usar wmode
      // 'window' (evita fondos en blanco/recortados como el que reportaste).
      patch.wmode = 'window';
    } else {
      // Película simple, vectorial, sin efectos de composición: 'opaque' +
      // canvas es seguro aquí y va un poco más liviano.
      patch.wmode = 'opaque';
      patch.preferredRenderer = 'canvas';
    }
    return patch;
  }

  async function buildSmartOptions(analysisUrl, label) {
    if (!analysisUrl) return null;
    const info = await analyzeGameSwf(analysisUrl);
    if (!info) return null;
    const patch = chooseOptionsForSwf(info);
    console.info(`[FlashVault] "${label}" analizado (${info.totalTags} tags, ${info.isAS3 ? 'AS3' : 'AS1/2'}):`, info, '→ configuración:', patch);
    return { patch, frameWidth: info.frameWidth, frameHeight: info.frameHeight };
  }

  function applyStageAspectRatio(smart) {
    const host = $('ruffleHost');
    const w = smart?.frameWidth, h = smart?.frameHeight;
    if (w > 0 && h > 0 && w < 8000 && h < 8000) host.style.aspectRatio = `${w} / ${h}`;
    else host.style.aspectRatio = '';
  }

  function installFullscreenButton(api, player) {
    const btn = $('fullscreenBtn');
    btn.disabled = false;
    const enter = () => {
      try {
        if (typeof api.requestFullscreen === 'function') return api.requestFullscreen();
        if (typeof player.enterFullscreen === 'function') return player.enterFullscreen();
      } catch (err) {
        $('playerError').textContent = 'No se pudo activar pantalla completa: ' + (err.message || err);
        $('playerError').classList.remove('hidden');
      }
    };
    btn.onclick = enter;
    const sync = () => {
      let fs = false;
      try { fs = !!api.isFullscreen; } catch (_) {}
      btn.textContent = fs ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
    };
    document.addEventListener('fullscreenchange', sync);
    fullscreenCleanup = () => document.removeEventListener('fullscreenchange', sync);
    sync();
  }

  async function createPlayer() {
    if (!window.RufflePlayer) throw new Error('Ruffle todavía no está listo. Recarga la página e inténtalo otra vez.');
    const factory = window.RufflePlayer.newest();
    const player = factory.createPlayer();
    activePlayer = player;
    $('ruffleHost').appendChild(player);
    const api = typeof player.ruffle === 'function' ? player.ruffle() : player;
    activeRuffleApi = api;
    return { player, api };
  }

  async function playGame(id) {
    const game = games.find(x => x.id === id);
    if (!game) return;

    await stopActiveGame();
    activeGameId = game.id;
    activeGameTitle = game.title;
    $('playerTitle').textContent = game.title;
    $('playerError').classList.add('hidden');
    $('fullscreenBtn').disabled = true;
    $('fullscreenBtn').textContent = '⛶ Pantalla completa';
    openModal('playerModal');

    try {
      const { player, api } = await createPlayer();
      installFullscreenButton(api, player);

      // Analiza el SWF real que se va a ejecutar primero (el loader en
      // paquetes multi-recurso, o el único SWF si es un juego simple) para
      // elegir la mejor configuración para ESTE juego en particular.
      setAnalyzingStatus('Analizando el juego para elegir la mejor configuración…');
      let smart = null;
      try {
        const analysisUrl = (game.game_type === 'multi_resource' && game.storage_prefix)
          ? publicPackageUrl(game.storage_prefix, game.loader_path || game.main_swf_path)
          : game.swf_url;
        smart = await buildSmartOptions(analysisUrl, game.title);
      } catch (_) { /* seguimos con la configuración por defecto */ }
      setAnalyzingStatus(null);
      applyStageAspectRatio(smart);

      const common = { ...commonRuffleOptions(), ...(smart?.patch || {}) };

      if (game.game_type === 'multi_resource' && game.storage_prefix && game.main_html_path && (game.loader_path || game.main_swf_path)) {
        const flashvars = game.flashvars && typeof game.flashvars === 'object' ? game.flashvars : {};
        const mainName = game.main_swf_path ? game.main_swf_path.split('/').pop() : (flashvars.NombreSWF || flashvars.nameSWF || '');
        if (!mainName) throw new Error('No hay SWF principal configurado para este paquete.');

        // Algunos juegos de Inkagames no usan loader intermedio: el HTML
        // carga el SWF principal directamente. En ese caso game.loader_path
        // es null y arrancamos directo con el SWF principal.
        const entryPath = game.loader_path || game.main_swf_path;

        // Cargamos el loader/SWF directamente desde su URL real en Storage.
        const loaderUrl = publicPackageUrl(game.storage_prefix, entryPath);
        const loaderBase = new URL('.', loaderUrl).href;
        const parameters = { ...flashvars, NombreSWF: mainName };

        const options = {
          ...common,
          url: loaderUrl,
          base: loaderBase,
          parameters
        };

        if (typeof api.load === 'function') await api.load(options);
        else await player.load(options);

        // Archived Inkagames loaders can finish their own loading screen while
        // failing to render the game movie. Keep a safe manual fallback to the
        // detected main SWF, using the same FlashVars and URL rewriting rules.
        // Si no hay loader, ya estamos cargando el SWF principal: el botón no aporta nada.
        if (game.loader_path && game.main_swf_path) {
          const fallback = document.createElement('button');
          fallback.type = 'button';
          fallback.className = 'ghost player-fallback';
          fallback.textContent = 'Cargar SWF principal directamente';
          fallback.onclick = async () => {
            fallback.disabled = true;
            fallback.textContent = 'Analizando y cargando…';
            let mainSmart = null;
            try {
              mainSmart = await buildSmartOptions(publicPackageUrl(game.storage_prefix, game.main_swf_path), game.title + ' (SWF principal)');
            } catch (_) {}
            applyStageAspectRatio(mainSmart);
            const mainUrl = publicPackageUrl(game.storage_prefix, game.main_swf_path);
            const directOptions = { ...common, ...(mainSmart?.patch || {}), url: mainUrl, base: new URL('.', mainUrl).href, parameters };
            try {
              if (typeof api.load === 'function') await api.load(directOptions);
              else await player.load(directOptions);
              fallback.remove();
            } catch (e) {
              fallback.disabled = false;
              fallback.textContent = 'Reintentar SWF principal';
              console.error(e);
            }
          };
          $('playerModal').querySelector('.player-toolbar')?.prepend(fallback);
        }
      } else if (game.swf_url) {
        const options = { ...common, url: game.swf_url };
        if (typeof api.load === 'function') await api.load(options);
        else await player.load(options);
      } else {
        throw new Error('Este juego no tiene una fuente reproducible.');
      }
    } catch (err) {
      console.error(err);
      setAnalyzingStatus(null);
      $('playerError').textContent = err.message || 'No se pudo iniciar el juego.';
      $('playerError').classList.remove('hidden');
    }
  }

  async function loadGames() {
    let result = await sb.from('games')
      .select('id,title,description,swf_url,cover_url,created_at,game_type,storage_prefix,main_html_path,loader_path,main_swf_path,flashvars')
      .eq('published', true)
      .order('created_at', { ascending: false });

    // Backwards compatibility: if the database hasn't received the migration,
    // fall back to the original schema so old games keep loading.
    if (result.error && /column .* does not exist/i.test(result.error.message || '')) {
      result = await sb.from('games')
        .select('id,title,description,swf_url,cover_url,created_at')
        .eq('published', true)
        .order('created_at', { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      status.textContent = 'No se pudo cargar la biblioteca: ' + error.message;
      return;
    }

    games = (data || []).map(g => ({ ...g, game_type: g.game_type || 'single_swf' }));
    status.textContent = `${games.length} juego${games.length === 1 ? '' : 's'} publicado${games.length === 1 ? '' : 's'}.`;
    render(games);
  }

  function render(list) {
    if (!list.length) {
      gamesGrid.innerHTML = '<div class="empty">No hay juegos que coincidan con tu búsqueda.</div>';
      return;
    }

    gamesGrid.innerHTML = list.map(g => `
        <article class="game-card">
          <img class="cover" src="${esc(g.cover_url)}" alt="Portada de ${esc(g.title)}" loading="lazy">
          <div class="game-body">
            <h3>${esc(g.title)}</h3>
            <p>${esc(g.description || 'Sin descripción.')}</p>
            <div class="game-actions">
              <button class="play-button" data-play="${esc(g.id)}">▶ Jugar</button>
            </div>
          </div>
        </article>`).join('');

    gamesGrid.querySelectorAll('[data-play]').forEach(btn => btn.addEventListener('click', () => playGame(btn.dataset.play)));
  }

  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    render(games.filter(g => `${g.title} ${g.description || ''}`.toLowerCase().includes(q)));
  });

  loadGames();
})();
