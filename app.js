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

      if (typeof api.load === 'function') await api.load({ url: game.swf_url });
      else await player.load({ url: game.swf_url });

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
    const { data, error } = await sb
      .from('games')
      .select('id,title,description,swf_url,cover_url,owner_id,created_at')
      .eq('published', true)
      .order('created_at', { ascending: false });

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

  $('publishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('gameTitle').value.trim();
    const description = $('gameDescription').value.trim();
    const cover = $('coverFile').files[0];
    const swf = $('swfFile').files[0];
    $('publishMessage').textContent = 'Subiendo…';

    try {
      const user = await currentUser();
      if (!user || !isConfiguredAdmin(user)) throw new Error('Tu sesión administrativa no está autorizada.');
      if (!swf || !swf.name.toLowerCase().endsWith('.swf')) throw new Error('El archivo del juego debe ser .swf');
      if (!cover || !cover.type.startsWith('image/')) throw new Error('La portada debe ser una imagen.');

      const slug = `${crypto.randomUUID()}-${safeName(title)}`;
      const coverUrlValue = await uploadFile('flash-covers', `${slug}.${ext(cover.name)}`, cover, cover.type);
      const swfUrlValue = await uploadFile('flash-games', `${slug}.swf`, swf, 'application/x-shockwave-flash');
      const { error } = await sb.from('games').insert({
        title, description, cover_url: coverUrlValue, swf_url: swfUrlValue,
        published: true, owner_id: user.id
      });
      if (error) throw error;

      $('publishMessage').textContent = '✓ Juego publicado correctamente.';
      $('publishForm').reset();
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
