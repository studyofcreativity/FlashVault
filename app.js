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

  // Reconstruye la URL "original" (http://www.dominio/...) a partir de la ruta
  // guardada en el paquete (ej. "www.inkagames.com/loader/x.swf"). Se la
  // pasamos a Ruffle como identidad del SWF (loaderInfo.url) para que el
  // candado de dominio anti-piratería del juego la vea como una URL de
  // Inkagames válida, aunque los bytes reales se descarguen del storage
  // gracias a las urlRewriteRules. Esto es lo mismo que hace Flashpoint con
  // su truco de hosts/DNS.
  function originalPackageUrl(path) {
    return 'http://' + normalizePackagePath(path);
  }

  function makeRuffleRewriteRules(prefix) {
    const base = publicPackageUrl(prefix);
    const domains = ['inkagames.com', 'inkagames.info', 'patajuegos.com', 'uploads.ungrounded.net'];
    const rules = [];

    // Muchos juegos de este motor (Inkagames) llaman a scripts de servidor que
    // ya no existen (idioma.php, save_terrain_data.php, fast_testing.php...).
    // Como son .php/.cgi/.asp nunca los vamos a poder subir como archivo estático:
    // si dejamos que caigan en la reescritura normal, terminan pidiendo un
    // archivo que no existe en el storage (404) y el juego se queda esperando
    // esa respuesta para siempre -> pantalla negra tras el 100%.
    // Por eso van ANTES de las reglas normales y responden al instante con un
    // cuerpo vacío (data: URI, no toca la red) en vez de esperar un 404.
    for (const domain of domains) {
      const escd = domain.replace(/\./g, '\\.');
      rules.push([new RegExp('^https?:\\/\\/(?:www\\.)?' + escd + '\\/.*\\.(?:php|cgi|asp|aspx)(?:\\?.*)?$', 'i'), 'data:text/plain,']);
      rules.push([new RegExp('^\\/\\/(?:www\\.)?' + escd + '\\/.*\\.(?:php|cgi|asp|aspx)(?:\\?.*)?$', 'i'), 'data:text/plain,']);
    }

    for (const domain of domains) {
      rules.push([new RegExp('^https?:\\/\\/(?:www\\.)?' + domain.replace(/\./g, '\\.') + '\\/(.*)$', 'i'), base + '/www.' + domain + '/$1']);
    }
    // Also catch protocol-relative URLs from archived HTML/SWF code.
    for (const domain of domains) {
      rules.push([new RegExp('^\\/\\/(?:www\\.)?' + domain.replace(/\./g, '\\.') + '\\/(.*)$', 'i'), base + '/www.' + domain + '/$1']);
    }
    return rules;
  }

  function commonRuffleOptions() {
    return {
      allowNetworking: 'all',
      allowFullscreen: true,
      allowScriptAccess: true,
      compatibilityRules: true,
      autoplay: 'on',
      playerRuntime: 'flashPlayer',
      preferredRenderer: 'canvas',
      upgradeToHttps: true,
      quality: 'high',
      scale: 'showAll',
      forceScale: false,
      wmode: 'opaque',
      splashScreen: false,
      showSwfDownload: false,
      contextMenu: 'on',
      logLevel: 'debug',
    };
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
      const common = commonRuffleOptions();

      if (game.game_type === 'multi_resource' && game.storage_prefix && game.main_html_path && game.loader_path) {
        const flashvars = game.flashvars && typeof game.flashvars === 'object' ? game.flashvars : {};
        const mainName = game.main_swf_path ? game.main_swf_path.split('/').pop() : (flashvars.NombreSWF || flashvars.nameSWF || '');
        if (!mainName) throw new Error('No hay SWF principal configurado para este paquete.');

        // OJO: usamos la URL ORIGINAL (dominio de Inkagames), no la de Supabase,
        // como "url"/"base" que ve Ruffle. Así el juego cree que sigue en su
        // dominio de siempre (pasa el candado anti-piratería) mientras
        // urlRewriteRules redirige la descarga real hacia el storage.
        const loaderUrl = originalPackageUrl(game.loader_path);
        const loaderBase = originalPackageUrl(dirname(game.loader_path));
        const parameters = { ...flashvars, NombreSWF: mainName };

        const rewriteRules = makeRuffleRewriteRules(game.storage_prefix);
        const options = {
          ...common,
          url: loaderUrl,
          base: loaderBase,
          parameters,
          urlRewriteRules: rewriteRules
        };

        if (typeof api.load === 'function') await api.load(options);
        else await player.load(options);

        // Archived Inkagames loaders can finish their own loading screen while
        // failing to render the game movie. Keep a safe manual fallback to the
        // detected main SWF, using the same FlashVars and URL rewriting rules.
        const fallback = document.createElement('button');
        fallback.type = 'button';
        fallback.className = 'ghost player-fallback';
        fallback.textContent = 'Cargar SWF principal directamente';
        fallback.onclick = async () => {
          const mainUrl = originalPackageUrl(game.main_swf_path);
          const directOptions = { ...common, url: mainUrl, base: originalPackageUrl(dirname(game.main_swf_path)), parameters, urlRewriteRules: rewriteRules };
          fallback.disabled = true;
          fallback.textContent = 'Cargando SWF principal…';
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
      } else if (game.swf_url) {
        const options = { ...common, url: game.swf_url };
        if (typeof api.load === 'function') await api.load(options);
        else await player.load(options);
      } else {
        throw new Error('Este juego no tiene una fuente reproducible.');
      }
    } catch (err) {
      console.error(err);
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
