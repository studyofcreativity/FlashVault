-- FlashVault: añade la URL de la página original para paquetes multi-recurso.
-- Ejecuta esto UNA SOLA VEZ en Supabase > SQL Editor (después de la migración
-- multifuncional). Es aditiva, no rompe juegos existentes.

alter table public.games
  add column if not exists origin_url text;

-- Se usa para "engañar" al SWF/loader haciéndole creer que sigue en su
-- página original (ej. http://www.inkagames.com/flash_games/juego.html),
-- pasando así el candado anti-piratería, mientras los bytes reales se
-- descargan de nuestro storage vía urlRewriteRules.
