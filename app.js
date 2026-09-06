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
  let adminSessionUnlocked = false;
  let currentAdminUserId = null;

  const ADMIN_UNLOCK_SESSION = 'flashvault_admin_unlocked';

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

  function closeAdminModal() {
    $('adminModal').classList.remove('open');
    $('adminModal').setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', async () => {
      if (el.dataset.close === 'player') await closePlayerModal();
      else closeAdminModal();
    });
  });

  $('adminOpen').onclick = () => openModal('adminModal');
  $('heroAdmin').onclick = () => openModal('adminModal');

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      if ($('playerModal').classList.contains('open')) await closePlayerModal();
      if ($('adminModal').classList.contains('open')) closeAdminModal();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeRuffleApi) {
      try { activeRuffleApi.suspend?.(); } catch (_) {}
    }
  });

  function isConfiguredAdmin(user) {
    if (!user || !adminSessionUnlocked) return false;
    const expectedId = String(cfg.ADMIN_USER_ID || '').trim();
    const hasRealAdminId = expectedId && !expectedId.startsWith('PEGA-AQUI') &&
      !['TU-UID', '(tu-uid)', '(TU-UID-DE-SUPABASE)'].includes(expectedId);
    return !hasRealAdminId || user.id === expectedId;
  }

  function markAdminUnlocked() {
    sessionStorage.setItem(ADMIN_UNLOCK_SESSION, '1');
    adminSessionUnlocked = true;
  }

  function clearAdminUnlocked() {
    sessionStorage.removeItem(ADMIN_UNLOCK_SESSION);
    adminSessionUnlocked = false;
  }

  async function currentUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user || null;
  }

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

  function parseFlashVarsFromHtml(htmlText) {
    const vars = {};
    const decode = (value) => {
      try { return decodeURIComponent(String(value).replace(/\+/g, ' ')); }
      catch (_) { return String(value); }
    };
    const addPairs = (raw) => {
      if (!raw) return;
      for (const part of String(raw).split(/[&;]/)) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const key = decode(part.slice(0, i)).trim();
        let value = decode(part.slice(i + 1));
        if (!key) continue;
        if (value === "'+numIsFirefox+'") value = /firefox/i.test(navigator.userAgent) ? '1' : '0';
        vars[key] = value;
      }
    };

    // Standard HTML attributes / <param>.
    for (const m of htmlText.matchAll(/(?:flashvars|FlashVars)\s*=\s*["']([^"']*)["']/ig)) addPairs(m[1]);
    for (const m of htmlText.matchAll(/<param[^>]+name=["']flashvars["'][^>]+value=["']([^"']*)["'][^>]*>/ig)) addPairs(m[1]);

    // JavaScript assignments commonly found in archived Inkagames pages.
    const jsPatterns = [
      /(?:flashvars|FlashVars)\s*[:=]\s*["']([^"']*)["']/g,
      /(?:vars|params|parameters)\s*[:=]\s*["']([^"']*(?:NombreSWF|nameSWF|SWF)[^"']*)["']/gi,
    ];
    for (const re of jsPatterns) for (const m of htmlText.matchAll(re)) addPairs(m[1]);

    // Some archives keep the values in an encoded query string.
    for (const m of htmlText.matchAll(/(?:\?|&)([A-Za-z_][\w]*)=([^&"'\s<>]+)/g)) {
      const k = decode(m[1]).trim();
      if (/^(NombreSWF|nameSWF|SWF|swf|movie|path|game|gameName|loader)$/i.test(k)) vars[k] = decode(m[2]);
    }
    return vars;
  }

  function findSwfRefs(htmlText) {
    const refs = [];
    for (const m of htmlText.matchAll(/(?:src|movie|value|data)\s*=\s*["']([^"']+\.swf(?:\?[^"']*)?)["']/ig)) refs.push(m[1]);
    for (const m of htmlText.matchAll(/https?:[^\s"']+\.swf(?:\?[^\s"']*)?/ig)) refs.push(m[0]);
    return [...new Set(refs)];
  }

  function packageEntryMatch(entries, ref) {
    if (!ref) return null;
    const clean = normalizePackagePath(String(ref).split('?')[0]);
    const low = clean.toLowerCase();
    return entries.find(e => e.path.toLowerCase() === low)
      || entries.find(e => e.path.toLowerCase().endsWith('/' + low))
      || null;
  }

  function chooseMainHtml(entries) {
    const ink = entries.filter(e => /\.html?$/i.test(e.path) && /(^|\/)www\.inkagames\.(com|info)\//i.test(e.path));
    const all = entries.filter(e => /\.html?$/i.test(e.path));
    return [...(ink.length ? ink : all)].sort((a,b) => b.size - a.size)[0] || null;
  }

  function analyzePackageEntries(entries, htmlText) {
    const flashvars = parseFlashVarsFromHtml(htmlText);
    const refs = findSwfRefs(htmlText);
    const loaderRef = refs.find(r => /(?:loader\/|load[_-]?game|loader).*\.swf/i.test(r)) || 'loader/load_game_ink_v2.swf';
    let loader = packageEntryMatch(entries, loaderRef);
    if (!loader) loader = entries.find(e => /(^|\/)loader\/.*\.swf$/i.test(e.path)) || entries.find(e => /load[_-]?game.*\.swf$/i.test(e.path));

    const mainName = flashvars.NombreSWF || flashvars.nameSWF || flashvars.SWF || flashvars.swf || flashvars.movie || '';
    let mainSwf = packageEntryMatch(entries, mainName);
    if (!mainSwf) {
      const swfs = entries.filter(e => /\.swf$/i.test(e.path) && (!loader || e.path !== loader.path));
      // Prefer an SWF referenced by the HTML, then the largest remaining SWF.
      mainSwf = swfs.find(e => refs.some(r => normalizePackagePath(r).toLowerCase().endsWith('/' + e.path.toLowerCase()) || normalizePackagePath(r).toLowerCase() === e.path.toLowerCase()))
        || [...swfs].sort((a,b) => b.size - a.size)[0] || null;
    }

    return { flashvars, refs, loader, mainSwf, loaderRef, mainName: mainSwf?.path.split('/').pop() || mainName || '' };
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
      const esc = domain.replace(/\./g, '\\.');
      rules.push([new RegExp('^https?:\\/\\/(?:www\\.)?' + esc + '\\/.*\\.(?:php|cgi|asp|aspx)(?:\\?.*)?$', 'i'), 'data:text/plain,']);
      rules.push([new RegExp('^\\/\\/(?:www\\.)?' + esc + '\\/.*\\.(?:php|cgi|asp|aspx)(?:\\?.*)?$', 'i'), 'data:text/plain,']);
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
        const htmlUrl = publicPackageUrl(game.storage_prefix, game.main_html_path);
        const htmlResp = await fetch(htmlUrl, { cache: 'no-store' });
        if (!htmlResp.ok) throw new Error('No se pudo leer el HTML principal del paquete (' + htmlResp.status + ').');
        const htmlText = await htmlResp.text();

        const entries = []; // DB metadata is enough; no need to download the entire ZIP again.
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

        // The HTML is the original entry point/manifest; the actual Flash execution
        // is performed by Ruffle on the same loader SWF used by that HTML.
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

        // Keep the page's exact HTML available for diagnostics/debugging without
        // executing its legacy <object>/<embed> plugin itself.
        player.setAttribute('data-flashvault-entry-html', htmlUrl);
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
      .select('id,title,description,swf_url,cover_url,owner_id,created_at,game_type,storage_prefix,main_html_path,loader_path,main_swf_path,flashvars')
      .eq('published', true)
      .order('created_at', { ascending: false });

    // Backwards compatibility: if the database hasn't received the migration,
    // fall back to the original schema so old games keep loading.
    if (result.error && /column .* does not exist/i.test(result.error.message || '')) {
      result = await sb.from('games')
        .select('id,title,description,swf_url,cover_url,owner_id,created_at')
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

    gamesGrid.innerHTML = list.map(g => {
      const canDelete = adminSessionUnlocked && currentAdminUserId && g.owner_id === currentAdminUserId;
      return `
        <article class="game-card">
          <img class="cover" src="${esc(g.cover_url)}" alt="Portada de ${esc(g.title)}" loading="lazy">
          <div class="game-body">
            <h3>${esc(g.title)}</h3>
            <p>${esc(g.description || 'Sin descripción.')}</p>
            <div class="game-actions">
              <button class="play-button" data-play="${esc(g.id)}">▶ Jugar</button>
              ${canDelete ? `<button class="delete-button" data-delete="${esc(g.id)}">🗑 Eliminar</button>` : ''}
            </div>
          </div>
        </article>`;
    }).join('');

    gamesGrid.querySelectorAll('[data-play]').forEach(btn => btn.addEventListener('click', () => playGame(btn.dataset.play)));
    gamesGrid.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteGame(btn.dataset.delete)));
  }

  async function deleteGame(id) {
    const game = games.find(x => x.id === id);
    if (!game) return;

    const user = await currentUser();
    if (!isConfiguredAdmin(user) || game.owner_id !== user.id) {
      alert('No tienes permiso para eliminar este juego.');
      return;
    }
    if (!confirm(`¿Eliminar "${game.title}" de FlashVault?`)) return;

    try {
      const { error } = await sb.from('games').delete().eq('id', game.id).eq('owner_id', user.id);
      if (error) throw error;
      if (activeGameId === game.id) await closePlayerModal();
      await loadGames();
    } catch (err) {
      alert('No se pudo eliminar el juego: ' + (err.message || err));
    }
  }

  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    render(games.filter(g => `${g.title} ${g.description || ''}`.toLowerCase().includes(q)));
  });

  async function refreshAdmin() {
    adminSessionUnlocked = sessionStorage.getItem(ADMIN_UNLOCK_SESSION) === '1';
    const user = await currentUser();
    currentAdminUserId = user?.id || null;

    if (user && isConfiguredAdmin(user)) {
      $('adminLoginView').classList.add('hidden');
      $('adminPublishView').classList.remove('hidden');
      $('signedInAs').textContent = `Sesión iniciada como ${user.email || user.id}`;
      $('diagnosticsStatus').textContent = '🔒 Diagnóstico privado activo para esta cuenta.';
    } else {
      $('adminLoginView').classList.remove('hidden');
      $('adminPublishView').classList.add('hidden');
      $('diagnosticsStatus').textContent = '';
      currentAdminUserId = null;
    }
    render(games);
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginMessage').textContent = 'Entrando…';
    if (cfg.EXTRA_ADMIN_KEY && $('extraKey').value !== cfg.EXTRA_ADMIN_KEY) {
      clearAdminUnlocked();
      $('loginMessage').textContent = 'La clave extra no coincide.';
      return;
    }
    const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (error) { clearAdminUnlocked(); $('loginMessage').textContent = error.message; return; }
    markAdminUnlocked();
    if (!isConfiguredAdmin(data.user)) {
      clearAdminUnlocked();
      await sb.auth.signOut();
      $('loginMessage').textContent = 'La cuenta inició sesión, pero no está autorizada para FlashVault.';
      return;
    }
    $('loginMessage').textContent = 'Listo.';
    await refreshAdmin();
  });

  $('logoutBtn').onclick = async () => {
    clearAdminUnlocked();
    await sb.auth.signOut();
    await refreshAdmin();
  };

  function safeName(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || 'juego';
  }
  function ext(name) {
    const p = name.split('.');
    return p.length > 1 ? p.pop().toLowerCase() : 'jpg';
  }

  async function uploadFile(bucket, path, file, contentType, options = {}) {
    const { error } = await sb.storage.from(bucket).upload(path, file, {
      cacheControl: '31536000', upsert: options.upsert ?? false, contentType
    });
    if (error) throw error;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  function getUploadType() {
    return document.querySelector('input[name="flashUploadType"]:checked')?.value || 'single';
  }

  function syncUploadType() {
    const type = getUploadType();
    $('singleUploadPanel').classList.toggle('hidden', type !== 'single');
    $('multiUploadPanel').classList.toggle('hidden', type !== 'multi');
    $('gameTitle').required = type === 'single';
    $('coverFile').required = type === 'single';
    $('swfFile').required = type === 'single';
    $('multiGameTitle').required = type === 'multi';
    $('multiCoverFile').required = type === 'multi';
    $('packageFile').required = type === 'multi';
  }
  document.querySelectorAll('input[name="flashUploadType"]').forEach(r => r.addEventListener('change', syncUploadType));
  syncUploadType();

  $('publishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('publishMessage').textContent = 'Comprobando…';

    try {
      const user = await currentUser();
      if (!user || !isConfiguredAdmin(user)) throw new Error('Tu sesión administrativa no está autorizada.');

      const uploadType = getUploadType();
      const title = (uploadType === 'single' ? $('gameTitle').value : $('multiGameTitle').value).trim();
      const description = (uploadType === 'single' ? $('gameDescription').value : $('multiGameDescription').value).trim();
      const cover = uploadType === 'single' ? $('coverFile').files[0] : $('multiCoverFile').files[0];
      if (!title) throw new Error('Escribe el nombre del juego.');
      if (!cover || !cover.type.startsWith('image/')) throw new Error('La portada debe ser una imagen.');

      const slug = `${crypto.randomUUID()}-${safeName(title)}`;
      const coverUrlValue = await uploadFile('flash-covers', `${slug}.${ext(cover.name)}`, cover, cover.type);

      if (uploadType === 'single') {
        const swf = $('swfFile').files[0];
        if (!swf || !swf.name.toLowerCase().endsWith('.swf')) throw new Error('Selecciona un archivo .swf.');
        const swfUrlValue = await uploadFile('flash-games', `${slug}.swf`, swf, 'application/x-shockwave-flash');
        const { error } = await sb.from('games').insert({
          title, description, cover_url: coverUrlValue, swf_url: swfUrlValue,
          game_type: 'single_swf', published: true, owner_id: user.id
        });
        if (error) throw error;
      } else {
        if (!window.JSZip) throw new Error('No se pudo cargar el lector de ZIP.');
        const packageFile = $('packageFile').files[0];
        if (!packageFile || !packageFile.name.toLowerCase().endsWith('.zip')) throw new Error('Selecciona un archivo .zip.');

        $('publishMessage').textContent = 'Leyendo ZIP…';
        const zip = await JSZip.loadAsync(packageFile);
        const entries = [];
        for (const raw of Object.keys(zip.files)) {
          const item = zip.files[raw];
          if (item.dir) continue;
          const path = normalizePackagePath(raw);
          if (!path) continue;
          const blob = await item.async('blob');
          entries.push({ path, size: blob.size, blob });
        }
        if (!entries.length) throw new Error('El ZIP está vacío.');

        const mainHtml = chooseMainHtml(entries);
        if (!mainHtml) throw new Error('No se encontró un HTML de Inkagames en el ZIP.');
        const htmlText = await mainHtml.blob.text();
        const analysis = analyzePackageEntries(entries, htmlText);
        if (!analysis.loader) throw new Error('No se encontró el loader SWF del juego.');
        if (!analysis.mainSwf) throw new Error('No se encontró el SWF principal del juego.');

        const prefix = `${slug}/`;
        let done = 0;
        for (const entry of entries) {
          const lower = entry.path.toLowerCase();
          const mime = lower.endsWith('.swf') ? 'application/x-shockwave-flash'
            : lower.endsWith('.html') || lower.endsWith('.htm') ? 'text/html'
            : lower.endsWith('.js') ? 'application/javascript'
            : lower.endsWith('.css') ? 'text/css'
            : lower.endsWith('.json') ? 'application/json'
            : lower.endsWith('.xml') ? 'application/xml'
            : lower.endsWith('.png') ? 'image/png'
            : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg'
            : lower.endsWith('.gif') ? 'image/gif'
            : lower.endsWith('.webp') ? 'image/webp'
            : lower.endsWith('.mp3') ? 'audio/mpeg'
            : lower.endsWith('.wav') ? 'audio/wav'
            : lower.endsWith('.ogg') ? 'audio/ogg'
            : 'application/octet-stream';
          await uploadFile('flash-games', prefix + entry.path, entry.blob, mime, { upsert: false });
          done++;
          $('publishMessage').textContent = `Subiendo recursos… ${done}/${entries.length}`;
        }

        const { error } = await sb.from('games').insert({
          title, description, cover_url: coverUrlValue, swf_url: null,
          game_type: 'multi_resource', storage_prefix: prefix,
          main_html_path: mainHtml.path, loader_path: analysis.loader.path,
          main_swf_path: analysis.mainSwf.path, flashvars: analysis.flashvars,
          published: true, owner_id: user.id
        });
        if (error) throw error;
      }

      $('publishMessage').textContent = '✓ Juego publicado correctamente.';
      $('publishForm').reset();
      document.querySelector('input[name="flashUploadType"][value="single"]').checked = true;
      syncUploadType();
      await loadGames();
    } catch (err) {
      console.error(err);
      $('publishMessage').textContent = `Error: ${err.message || 'No se pudo publicar.'}`;
    }
  });

  sb.auth.onAuthStateChange(async () => {
    await refreshAdmin();
  });

  refreshAdmin();
  loadGames();
})();
