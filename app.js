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
      if (activeRuffleApi) {
        try { activeRuffleApi.exitFullscreen?.(); } catch (_) {}
        try { activeRuffleApi.suspend?.(); } catch (_) {}
        try { activeRuffleApi.volume = 0; } catch (_) {}
      }
      if (activePlayer) {
        try { activePlayer.pause?.(); } catch (_) {}
        try { activePlayer.volume = 0; } catch (_) {}
        activePlayer.remove();
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
      if (!window.RufflePlayer) {
        throw new Error('Ruffle todavía no está listo. Recarga la página e inténtalo otra vez.');
      }

      const factory = window.RufflePlayer.newest();
      const player = factory.createPlayer();
      activePlayer = player;

      $('ruffleHost').appendChild(player);

      const api = typeof player.ruffle === 'function' ? player.ruffle() : player;
      activeRuffleApi = api;

      player.config = {
        allowNetworking: 'all',
        allowFullscreen: true,
        allowScriptAccess: true,
        compatibilityRules: true,
        autoplay: 'auto',
        upgradeToHttps: true,
        quality: 'high',
        scale: 'showAll',
        wmode: 'opaque',
        splashScreen: false,
        showSwfDownload: false,
        contextMenu: true
      };

      const fullscreenButton = $('fullscreenBtn');
      fullscreenButton.disabled = false;
      fullscreenButton.onclick = () => {
        try {
          if (typeof api.requestFullscreen === 'function') api.requestFullscreen();
          else if (typeof player.enterFullscreen === 'function') player.enterFullscreen();
        } catch (err) {
          $('playerError').textContent = 'No se pudo activar pantalla completa: ' + (err.message || err);
          $('playerError').classList.remove('hidden');
        }
      };

      if (typeof api.setFullscreen === 'function' || typeof api.requestFullscreen === 'function') {
        const onFullscreenChange = () => {
          fullscreenButton.textContent = api.isFullscreen ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        player.__flashVaultFullscreenCleanup = () => document.removeEventListener('fullscreenchange', onFullscreenChange);
      }

      // For multi-resource packages, tell the compatibility layer and Ruffle
      // where the preserved package tree lives. This lets old SWFs request
      // files using their original relative/absolute paths.
      if (game.game_type === 'package' && game.package_path) {
        const packageRoot = sb.storage.from('flash-games').getPublicUrl(game.package_path).data.publicUrl;
        window.FLASHVAULT_PACKAGE_ROOT = packageRoot.endsWith('/') ? packageRoot : packageRoot + '/';
        player.config = { ...player.config, base: window.FLASHVAULT_PACKAGE_ROOT };
      } else {
        window.FLASHVAULT_PACKAGE_ROOT = null;
      }

      if (typeof api.load === 'function') {
        await api.load({
          url: game.swf_url,
          ...(game.game_type === 'package' && game.package_path ? { base: window.FLASHVAULT_PACKAGE_ROOT } : {})
        });
      } else {
        await player.load({
          url: game.swf_url,
          ...(game.game_type === 'package' && game.package_path ? { base: window.FLASHVAULT_PACKAGE_ROOT } : {})
        });
      }

    } catch (err) {
      $('playerError').textContent = err.message || 'No se pudo iniciar el juego.';
      $('playerError').classList.remove('hidden');
    }
  }

  $('fullscreenBtn').addEventListener('click', () => {
    if (!activeRuffleApi) return;
    try {
      if (typeof activeRuffleApi.requestFullscreen === 'function') activeRuffleApi.requestFullscreen();
      else activePlayer?.enterFullscreen?.();
    } catch (_) {}
  });

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

    gamesGrid.querySelectorAll('[data-play]').forEach(btn => {
      btn.addEventListener('click', () => playGame(btn.dataset.play));
    });

    gamesGrid.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteGame(btn.dataset.delete));
    });
  }

  async function loadGames() {
    // Intentamos primero el esquema nuevo. Si la migración aún no se ejecutó,
    // usamos automáticamente el esquema antiguo para que la biblioteca siga funcionando.
    let result = await sb
      .from('games')
      .select('id,title,description,swf_url,cover_url,owner_id,created_at,game_type,package_path')
      .eq('published', true)
      .order('created_at', { ascending: false });

    let data = result.data;
    let error = result.error;

    if (error && /game_type|package_path|column .* does not exist/i.test(error.message || '')) {
      result = await sb
        .from('games')
        .select('id,title,description,swf_url,cover_url,owner_id,created_at')
        .eq('published', true)
        .order('created_at', { ascending: false });
      data = (result.data || []).map(g => ({ ...g, game_type: 'single', package_path: null }));
      error = result.error;
    }

    if (error) {
      status.textContent = 'No se pudo cargar la biblioteca: ' + error.message;
      return;
    }

    games = data || [];
    status.textContent = `${games.length} juego${games.length === 1 ? '' : 's'} publicado${games.length === 1 ? '' : 's'}.`;
    render(games);
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
      if (!$('publishForm').classList.contains('hidden')) { /* conservar selección si ya está editando */ } else { showUploadTypeChooser(); }
      $('signedInAs').textContent = `Sesión iniciada como ${user.email || user.id}`;
      $('diagnosticsStatus').textContent = '🔒 Acceso administrativo activo.';
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

    const { data, error } = await sb.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value
    });

    if (error) {
      clearAdminUnlocked();
      $('loginMessage').textContent = error.message;
      return;
    }

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

  async function uploadFile(bucket, path, file, contentType) {
    const { error } = await sb.storage.from(bucket).upload(path, file, {
      cacheControl: '31536000', upsert: false, contentType
    });
    if (error) throw error;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  let selectedUploadType = null;

  function showUploadTypeChooser() {
    selectedUploadType = null;
    $('uploadTypeChooser').classList.remove('hidden');
    $('publishForm').classList.add('hidden');
    $('publishForm').reset();
    $('publishMessage').textContent = '';
  }

  function selectUploadType(type) {
    selectedUploadType = type;
    $('uploadTypeChooser').classList.add('hidden');
    $('publishForm').classList.remove('hidden');
    $('singleSwfField').classList.toggle('hidden', type !== 'single');
    $('packageZipField').classList.toggle('hidden', type !== 'package');
    $('packageHint').classList.toggle('hidden', type !== 'package');
    $('swfFile').required = type === 'single';
    $('packageFile').required = type === 'package';
    $('selectedUploadType').textContent = type === 'single'
      ? '◈ Juego Flash de un solo archivo'
      : '▦ Juego Flash con múltiples recursos';
    $('publishMessage').textContent = '';
  }

  document.querySelectorAll('[data-upload-type]').forEach(btn => {
    btn.addEventListener('click', () => selectUploadType(btn.dataset.uploadType));
  });
  $('changeUploadType').addEventListener('click', showUploadTypeChooser);

  async function uploadPackage(slug, zipFile) {
    if (!window.JSZip) throw new Error('No se pudo cargar el lector ZIP. Recarga la página e inténtalo de nuevo.');
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (!entries.length) throw new Error('El ZIP está vacío.');

    const normalized = entries.map(entry => ({
      entry,
      path: entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
    })).filter(x => x.path && !x.path.includes('../'));

    const swfs = normalized.filter(x => x.path.toLowerCase().endsWith('.swf'));
    if (!swfs.length) throw new Error('El ZIP no contiene ningún archivo .swf.');

    // Prefer a SWF whose name looks like the main game; otherwise use the largest SWF.
    const main = [...swfs].sort((a, b) => {
      const score = (x) => {
        const n = x.path.toLowerCase().split('/').pop();
        let v = 0;
        if (/^(game|main|index|play|start)[-_ ]?/.test(n)) v += 100;
        if (/loader|preloader|loading/.test(n)) v -= 80;
        return v;
      };
      return score(b) - score(a);
    })[0];

    const root = `${slug}/`;
    let mainUrl = null;
    let uploaded = 0;

    for (const item of normalized) {
      const blob = await item.entry.async('blob');
      const contentType = guessContentType(item.path);
      const storagePath = `${root}${item.path}`;
      await uploadFile('flash-games', storagePath, blob, contentType);
      uploaded++;
      if (item === main) {
        mainUrl = sb.storage.from('flash-games').getPublicUrl(storagePath).data.publicUrl;
      }
    }

    if (!mainUrl) throw new Error('No se pudo determinar el SWF principal.');
    return { mainUrl, packagePath: root, fileCount: uploaded, mainPath: `${root}${main.path}` };
  }

  function guessContentType(path) {
    const e = ext(path);
    const map = {
      swf: 'application/x-shockwave-flash',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
      xml: 'application/xml', json: 'application/json', txt: 'text/plain', css: 'text/css', js: 'text/javascript',
      html: 'text/html', htm: 'text/html', svg: 'image/svg+xml',
      dat: 'application/octet-stream', bin: 'application/octet-stream'
    };
    return map[e] || 'application/octet-stream';
  }

  $('publishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('gameTitle').value.trim();
    const description = $('gameDescription').value.trim();
    const cover = $('coverFile').files[0];
    const swf = $('swfFile').files[0];
    const packageFile = $('packageFile').files[0];
    $('publishMessage').textContent = 'Subiendo…';

    try {
      const user = await currentUser();
      if (!user || !isConfiguredAdmin(user)) throw new Error('Tu sesión administrativa no está autorizada.');
      if (!selectedUploadType) throw new Error('Selecciona primero el tipo de juego.');
      if (!cover || !cover.type.startsWith('image/')) throw new Error('La portada debe ser una imagen.');

      const slug = `${crypto.randomUUID()}-${safeName(title)}`;
      const coverUrlValue = await uploadFile('flash-covers', `${slug}.${ext(cover.name)}`, cover, cover.type);
      let swfUrlValue;
      let packagePath = null;
      let gameType = 'single';

      if (selectedUploadType === 'single') {
        if (!swf || !swf.name.toLowerCase().endsWith('.swf')) throw new Error('El archivo del juego debe ser .swf');
        swfUrlValue = await uploadFile('flash-games', `${slug}.swf`, swf, 'application/x-shockwave-flash');
      } else {
        if (!packageFile || !packageFile.name.toLowerCase().endsWith('.zip')) throw new Error('El paquete debe ser un archivo .zip');
        gameType = 'package';
        const result = await uploadPackage(slug, packageFile);
        swfUrlValue = result.mainUrl;
        packagePath = result.packagePath;
        $('publishMessage').textContent = `Subidos ${result.fileCount} recursos. Publicando…`;
      }

      const newRow = {
        title, description, cover_url: coverUrlValue, swf_url: swfUrlValue,
        published: true, owner_id: user.id, game_type: gameType, package_path: packagePath
      };
      let { error } = await sb.from('games').insert(newRow);

      // Compatibilidad con bases antiguas: un juego de archivo único puede seguir
      // publicándose mientras la migración todavía no se haya ejecutado.
      if (error && gameType === 'single' && /game_type|package_path|column .* does not exist/i.test(error.message || '')) {
        ({ error } = await sb.from('games').insert({
          title, description, cover_url: coverUrlValue, swf_url: swfUrlValue,
          published: true, owner_id: user.id
        }));
      }

      if (error) {
        if (gameType === 'package' && /game_type|package_path|column .* does not exist/i.test(error.message || '')) {
          throw new Error('Tu Supabase todavía usa el esquema antiguo. Ejecuta supabase-migration-multi-resource.sql en SQL Editor y vuelve a intentarlo.');
        }
        throw error;
      }

      $('publishMessage').textContent = '✓ Juego publicado correctamente.';
      $('publishForm').reset();
      showUploadTypeChooser();
      await loadGames();
    } catch (err) {
      console.error(err);
      $('publishMessage').textContent = `Error: ${err.message || 'No se pudo publicar.'}`;
    }
  });

  function safeName(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || 'juego';
  }

  function ext(name) {
    const p = name.split('.');
    return p.length > 1 ? p.pop().toLowerCase() : 'jpg';
  }

  sb.auth.onAuthStateChange(async () => {
    await refreshAdmin();
  });

  refreshAdmin();
  loadGames();
})();
