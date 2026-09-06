-- FlashVault: migración multifuncional SWF + ZIP/HTML/loader.
-- Ejecuta esto UNA SOLA VEZ en Supabase > SQL Editor.

alter table public.games
  alter column swf_url drop not null;

alter table public.games
  add column if not exists game_type text not null default 'single_swf',
  add column if not exists storage_prefix text,
  add column if not exists main_html_path text,
  add column if not exists loader_path text,
  add column if not exists main_swf_path text,
  add column if not exists flashvars jsonb;

alter table public.games
  drop constraint if exists games_game_type_check;

alter table public.games
  add constraint games_game_type_check check (game_type in ('single_swf','multi_resource'));

update public.games set game_type = 'single_swf' where game_type is null;

-- Los juegos antiguos conservan su swf_url sin cambios. Los nuevos paquetes
-- pueden guardar todos sus recursos en flash-games.
update storage.buckets
set public = true,
    file_size_limit = 524288000,
    allowed_mime_types = null
where id = 'flash-games';

create index if not exists games_game_type_idx on public.games (game_type);
create index if not exists games_created_at_idx on public.games (created_at desc);
