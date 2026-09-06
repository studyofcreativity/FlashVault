-- FLASHVAULT: migración para soportar juegos Flash de un archivo y juegos con múltiples recursos.
-- EJECUTA ESTE ARCHIVO UNA SOLA VEZ en Supabase > SQL Editor.
-- No borra ni modifica los juegos existentes.

alter table public.games
  add column if not exists game_type text not null default 'single';

alter table public.games
  add column if not exists package_path text;

-- Normaliza cualquier valor existente antes de agregar la restricción.
update public.games
set game_type = 'single'
where game_type is null or game_type not in ('single','package');

alter table public.games
  drop constraint if exists games_game_type_check;

alter table public.games
  add constraint games_game_type_check
  check (game_type in ('single','package'));

-- Permite que el bucket almacene los recursos habituales de un paquete Flash.
update storage.buckets
set allowed_mime_types = array[
  'application/x-shockwave-flash', 'application/octet-stream',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/webm',
  'application/xml', 'application/json', 'text/plain', 'text/css',
  'text/javascript', 'text/html'
],
file_size_limit = 104857600
where id = 'flash-games';

create index if not exists games_game_type_idx on public.games (game_type);

-- Comprobación rápida: debería devolver game_type y package_path.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'games'
  and column_name in ('game_type','package_path')
order by column_name;
