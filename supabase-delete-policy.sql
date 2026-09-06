-- FLASHVAULT: borrado seguro para el administrador
-- Reemplaza UUID_ADMIN por el UID REAL de tu cuenta de Supabase.
-- Ejecuta estas sentencias en Supabase > SQL Editor.

alter table public.games enable row level security;

drop policy if exists "Admin can delete games" on public.games;
create policy "Admin can delete games"
  on public.games for delete
  to authenticated
  using (auth.uid() = 'UUID_ADMIN'::uuid);

-- La cuenta administradora también controla las inserciones/actualizaciones.
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

-- BORRAR LOS 3 JUEGOS ACTUALES:
-- Descomenta y ejecuta SOLO este bloque una vez para quitarlos de la biblioteca.
-- Las mayúsculas/minúsculas no importan.
--
-- delete from public.games
-- where lower(title) in (
--   'bart simpson saw game',
--   'obama saw game',
--   'fernanfloo saw game'
-- );
