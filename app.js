(() => {
  const cfg = window.FLASHVAULT_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('TU-PROYECTO')) {
    document.getElementById('status').textContent = 'Configura primero config.js con tu URL y publishable key de Supabase.';
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const gamesGrid = $('gamesGrid');
  const status = $('status');
  let games = [];
  let activeGameId = null;
  let activeGameTitle = '';
  let networkEntries = [];
  let adminAuthorized = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));

  function openModal(id) { $(id).classList.add('open'); $(id).setAttribute('aria-hidden','false'); }
  function closeModal(id) { $(id).classList.remove('open'); $(id).setAttribute('aria-hidden','true'); }

  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.close === 'player' ? 'playerModal' : 'adminModal')));
  $('adminOpen').onclick = () => openModal('adminModal');
  $('heroAdmin').onclick = () => openModal('adminModal');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal('playerModal'); closeModal('adminModal'); } });

  function coverUrl(path) {
    return sb.storage.from('flash-covers').getPublicUrl(path).data.publicUrl;
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
          <button class="play-button" data-play="${esc(g.id)}">▶ Jugar</button>
        </div>
      </article>`).join('');
    gamesGrid.querySelectorAll('[data-play]').forEach(btn => btn.addEventListener('click', () => playGame(btn.dataset.play)));
  }

  async function loadGames() {
    const { data, error } = await sb.from('games').select('id,title,description,swf_url,cover_url,created_at').eq('published', true).order('created_at', { ascending: false });
    if (error) { status.textContent = 'No se pudo cargar la biblioteca: ' + error.message; return; }
    games = data || [];
    status.textContent = `${games.length} juego${games.length === 1 ? '' : 's'} publicado${games.length === 1 ? '' : 's'}.`;
    render(games);
  }

  function isConfiguredAdmin(user) {
    const expectedId = String(cfg.ADMIN_USER_ID || '').trim();
    return !!(user && expectedId && !expectedId.startsWith('PEGA-AQUI') && user.id === expectedId);
  }

  function setDiagnosticsVisibility(visible) {
    adminAuthorized = !!visible;
    window.FLASHVAULT_RUFFLE_COMPAT?.setDiagnosticsEnabled?.(adminAuthorized);
    const panel = $('resourceDiagnostics');
    if (panel) panel.classList.toggle('hidden', !adminAuthorized);
    if (!adminAuthorized) {
      networkEntries = [];
      window.FLASHVAULT_RUFFLE_COMPAT?.clearNetworkLog?.();
    }
  }

  function updateResourceDiagnostics() {
    const list = $('resourceList');
    if (!list || !adminAuthorized) return;

    const entries = networkEntries;
    const okCount = entries.filter(x => x.ok).length;
    const failCount = entries.filter(x => !x.ok).length;
    const patchedCount = entries.filter(x => x.patched).length;
    $('resourceCount').textContent = `${entries.length} solicitud${entries.length === 1 ? '' : 'es'}`;
    $('resourceOkCount').textContent = `✓ ${okCount} correctas`;
    $('resourceFailCount').textContent = `✗ ${failCount} fallidas`;
    $('resourcePatchedCount').textContent = `🩹 ${patchedCount} parcheadas`;

    if (!entries.length) {
      list.innerHTML = '<div class="resource-empty">Todavía no se han registrado recursos.</div>';
      return;
    }

    list.innerHTML = entries.slice().reverse().map(entry => {
      const cls = entry.patched ? 'patched' : (entry.ok ? 'ok' : 'fail');
      const badge = entry.patched ? 'PARCHE' : (entry.ok ? `${entry.status ?? 'OK'}` : `${entry.status ?? 'ERROR'}`);
      const duration = entry.durationMs != null ? `${entry.durationMs} ms` : '—';
      const error = entry.error ? ` · ${entry.error}` : '';
      return `<div class="resource-row ${cls}" title="${esc(entry.url)}${esc(error)}">
        <span class="resource-badge">${esc(entry.type)}</span>
        <span class="resource-url">${esc(entry.url || '(URL desconocida)')}</span>
        <span class="resource-meta">${esc(badge)} · ${esc(duration)}</span>
      </div>`;
    }).join('');
  }

  function resetResourceDiagnostics(gameId, title) {
    activeGameId = gameId;
    activeGameTitle = title || 'Juego';
    networkEntries = [];
    window.FLASHVAULT_RUFFLE_COMPAT?.clearNetworkLog?.();
    updateResourceDiagnostics();
  }

  function resourceReportText() {
    const lines = [
      `FlashVault — diagnóstico de recursos`,
      `Juego: ${activeGameTitle || 'Desconocido'}`,
      `ID: ${activeGameId || 'Desconocido'}`,
      `Fecha: ${new Date().toISOString()}`,
      '',
      ...networkEntries.map((entry, index) => {
        const status = entry.patched ? 'PATCHED' : (entry.ok ? 'OK' : 'FAILED');
        const code = entry.status ?? '—';
        const error = entry.error ? ` | error=${entry.error}` : '';
        return `${index + 1}. [${status}] ${code} ${entry.method} ${entry.type} ${entry.url}${error}`;
      })
    ];
    return lines.join('\n');
  }

  $('clearResourceLog').addEventListener('click', () => {
    if (!adminAuthorized) return;
    resetResourceDiagnostics(activeGameId, activeGameTitle);
  });

  $('copyResourceLog').addEventListener('click', async () => {
    if (!adminAuthorized) return;
    try {
      await navigator.clipboard.writeText(resourceReportText());
      $('copyResourceLog').textContent = '✓ Copiado';
      setTimeout(() => $('copyResourceLog').textContent = 'Copiar informe', 1400);
    } catch (_) {
      $('copyResourceLog').textContent = 'No disponible';
      setTimeout(() => $('copyResourceLog').textContent = 'Copiar informe', 1400);
    }
  });

  $('downloadResourceLog').addEventListener('click', () => {
    if (!adminAuthorized) return;
    const payload = {
      app: 'FlashVault',
      gameId: activeGameId,
      gameTitle: activeGameTitle,
      exportedAt: new Date().toISOString(),
      resources: networkEntries
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flashvault-${safeName(activeGameTitle || 'juego')}-recursos.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  window.addEventListener('flashvault:resource', (event) => {
    if (!activeGameId || !adminAuthorized) return;
    const entry = event.detail;
    networkEntries.push(entry);
    updateResourceDiagnostics();
  });

  window.addEventListener('flashvault:resource-clear', () => {
    networkEntries = [];
    if (adminAuthorized) updateResourceDiagnostics();
  });

  async function playGame(id) {
    const game = games.find(x => x.id === id);
    if (!game) return;
    $('playerTitle').textContent = game.title;
    $('playerError').classList.add('hidden');
    $('ruffleHost').innerHTML = '';
    resetResourceDiagnostics(game.id, game.title);
    openModal('playerModal');
    try {
      if (!window.RufflePlayer) throw new Error('Ruffle todavía no está listo. Recarga la página e inténtalo otra vez.');
      const factory = window.RufflePlayer.newest();
      const player = factory.createPlayer();
      const api = player.ruffle ? player.ruffle() : player;
      api.config = {
        allowNetworking: 'all',
        allowFullscreen: true,
        compatibilityRules: true,
        allowScriptAccess: true,
        autoplay: 'auto',
        upgradeToHttps: true,
        wmode: 'opaque',
        quality: 'high',
        scale: 'showAll',
        letterbox: 'fullscreen',
        showSwfDownload: false,
        contextMenu: true,
        splashScreen: false
      };
      $('ruffleHost').appendChild(player);
      await api.load({ url: game.swf_url });
    } catch (err) {
      $('playerError').textContent = err.message || 'No se pudo iniciar el juego.';
      $('playerError').classList.remove('hidden');
    }
  }

  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    render(games.filter(g => `${g.title} ${g.description || ''}`.toLowerCase().includes(q)));
  });

  async function refreshAdmin() {
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user || null;
    const accountIsAdmin = isConfiguredAdmin(user);

    if (session && accountIsAdmin) {
      $('adminLoginView').classList.add('hidden');
      $('adminPublishView').classList.remove('hidden');
      $('signedInAs').textContent = `Sesión iniciada como ${user.email || user.id}`;
      setDiagnosticsVisibility(true);
    } else {
      $('adminLoginView').classList.remove('hidden');
      $('adminPublishView').classList.add('hidden');
      setDiagnosticsVisibility(false);
    }

    if (session && !accountIsAdmin) {
      $('loginMessage').textContent = 'Esta cuenta no está autorizada para el panel privado.';
    }
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginMessage').textContent = 'Entrando…';
    if (cfg.EXTRA_ADMIN_KEY && $('extraKey').value !== cfg.EXTRA_ADMIN_KEY) {
      $('loginMessage').textContent = 'La clave extra no coincide.';
      return;
    }
    const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (error) { $('loginMessage').textContent = error.message; return; }
    if (!isConfiguredAdmin(data.user)) {
      await sb.auth.signOut();
      $('loginMessage').textContent = 'La cuenta inició sesión, pero no está autorizada para FlashVault.';
      setDiagnosticsVisibility(false);
      return;
    }
    $('loginMessage').textContent = 'Listo.';
    await refreshAdmin();
  });

  $('logoutBtn').onclick = async () => { await sb.auth.signOut(); await refreshAdmin(); };

  async function uploadFile(bucket, path, file, contentType) {
    const { error } = await sb.storage.from(bucket).upload(path, file, { cacheControl: '31536000', upsert: false, contentType });
    if (error) throw error;
    if (bucket === 'flash-covers') return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  $('publishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('gameTitle').value.trim();
    const description = $('gameDescription').value.trim();
    const cover = $('coverFile').files[0];
    const swf = $('swfFile').files[0];
    $('publishMessage').textContent = 'Subiendo…';
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Tu sesión no está activa.');
      if (!isConfiguredAdmin(user)) throw new Error('Esta cuenta no está autorizada para publicar.');
      if (!swf || !swf.name.toLowerCase().endsWith('.swf')) throw new Error('El archivo del juego debe ser .swf');
      if (!cover || !cover.type.startsWith('image/')) throw new Error('La portada debe ser una imagen.');
      const slug = `${crypto.randomUUID()}-${safeName(title)}`;
      const coverUrlValue = await uploadFile('flash-covers', `${slug}.${ext(cover.name)}`, cover, cover.type);
      const swfUrlValue = await uploadFile('flash-games', `${slug}.swf`, swf, 'application/x-shockwave-flash');
      const { error } = await sb.from('games').insert({ title, description, cover_url: coverUrlValue, swf_url: swfUrlValue, published: true, owner_id: user.id });
      if (error) throw error;
      $('publishMessage').textContent = '✓ Juego publicado correctamente.';
      $('publishForm').reset();
      await loadGames();
    } catch (err) {
      console.error(err);
      $('publishMessage').textContent = `Error: ${err.message || 'No se pudo publicar.'}`;
    }
  });

  function safeName(text) { return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || 'juego'; }
  function ext(name) { const p = name.split('.'); return p.length > 1 ? p.pop().toLowerCase() : 'jpg'; }

  sb.auth.onAuthStateChange(() => refreshAdmin());
  refreshAdmin();
  loadGames();
})();
