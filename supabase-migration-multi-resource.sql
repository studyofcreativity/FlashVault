-- FLASHVAULT: soporte para juegos Flash de un archivo y paquetes con múltiples recursos.
-- Ejecuta este archivo DESPUÉS de haber ejecutado supabase.sql.

alter table public.games
  add column if not exists game_type text not null default 'single'
    check (game_type in ('single','package'));

alter table public.games
  add column if not exists package_path text;

-- El bucket ahora permite los tipos habituales que puede contener un paquete Flash.
update storage.buckets
set allowed_mime_types = array[
  'application/x-shockwave-flash', 'application/octet-stream',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/webm',
  'application/xml', 'application/json', 'text/plain', 'text/css', 'text/javascript', 'text/html'
],
file_size_limit = 104857600
where id = 'flash-games';

create index if not exists games_game_type_idx on public.games (game_type);
