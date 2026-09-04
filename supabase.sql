-- FLASHVAULT: esquema + seguridad
-- Ejecuta este archivo en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '',
  swf_url text not null,
  cover_url text not null,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.games enable row level security;

-- Lectura pública solo de juegos publicados.
drop policy if exists "Public can read published games" on public.games;
create policy "Public can read published games"
  on public.games for select
  to anon, authenticated
  using (published = true);

-- Solo TU cuenta autenticada puede crear/editar/borrar juegos.
-- PASO IMPORTANTE: reemplaza UUID_ADMIN con el UUID de tu usuario de Supabase.

drop policy if exists "Admin can insert games" on public.games;
create policy "Admin can insert games"
  on public.games for insert
  to authenticated
  with check (auth.uid() = 'UUID_ADMIN'::uuid and owner_id = auth.uid());

drop policy if exists "Admin can update games" on public.games;
create policy "Admin can update games"
  on public.games for update
  to authenticated
  using (auth.uid() = 'UUID_ADMIN'::uuid)
  with check (auth.uid() = 'UUID_ADMIN'::uuid and owner_id = auth.uid());

drop policy if exists "Admin can delete games" on public.games;
create policy "Admin can delete games"
  on public.games for delete
  to authenticated
  using (auth.uid() = 'UUID_ADMIN'::uuid);

-- Buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('flash-covers', 'flash-covers', true, 10485760, array['image/png','image/jpeg','image/webp']),
  ('flash-games', 'flash-games', true, 104857600, array['application/x-shockwave-flash','application/octet-stream'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Portadas: cualquiera puede leer.
drop policy if exists "Public can read flash covers" on storage.objects;
create policy "Public can read flash covers"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'flash-covers');

-- Solo tu UUID puede subir portadas.
drop policy if exists "Admin can upload flash covers" on storage.objects;
create policy "Admin can upload flash covers"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'flash-covers' and auth.uid() = 'UUID_ADMIN'::uuid);

-- Los juegos se pueden reproducir públicamente mediante URL del bucket.
drop policy if exists "Public can read flash games" on storage.objects;
create policy "Public can read flash games"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'flash-games');

-- Solo tu UUID puede subir juegos.
drop policy if exists "Admin can upload flash games" on storage.objects;
create policy "Admin can upload flash games"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'flash-games' and auth.uid() = 'UUID_ADMIN'::uuid);

-- Opcional: solo tú puedes borrar tus archivos de publicación.
drop policy if exists "Admin can delete flash files" on storage.objects;
create policy "Admin can delete flash files"
  on storage.objects for delete
  to authenticated
  using (auth.uid() = 'UUID_ADMIN'::uuid and bucket_id in ('flash-games','flash-covers'));

create index if not exists games_created_at_idx on public.games (created_at desc);
create index if not exists games_published_idx on public.games (published);
