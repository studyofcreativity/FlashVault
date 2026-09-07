# FlashVault

Biblioteca web de juegos Flash (.swf) con **Ruffle + Supabase**, preparada para publicar en GitHub Pages.

Este sitio es **solo de lectura y juego**: los visitantes ven la biblioteca y juegan, pero no hay ningún panel de inicio de sesión ni de publicación aquí. Publicar, editar y eliminar juegos se hace aparte, con la herramienta privada `admin.html` (no se sube a este sitio público).

## 1. Configura Supabase

Crea un proyecto en Supabase y abre **SQL Editor**. Ejecuta todo el contenido de `supabase.sql`.

El SQL incluido crea automáticamente los buckets `flash-games` y `flash-covers` y sus políticas.

## 2. Configura la página

`config.js` ya viene preparado con `SUPABASE_URL` y `SUPABASE_ANON_KEY` (la clave pública/publishable, segura para el navegador). Si vuelves a crear el proyecto de Supabase, sustitúyelos por los nuevos valores.

**Nunca** pongas la `service_role` key aquí ni la subas a GitHub. Esa clave solo se usa en tu herramienta privada `admin.html`, que guardas para ti y nunca subes a un repositorio ni a un sitio público.

## 3. GitHub

Sube `index.html`, `style.css`, `app.js`, `config.js` y `ruffle-compat.js` a tu repositorio.

En GitHub: **Settings > Pages > Deploy from a branch** y selecciona la rama principal y la carpeta `/root`.

## 4. Uso

Los visitantes solo ven juegos que estén con `published = true`. Para publicar, editar o borrar juegos usa `admin.html` por separado.

## Nota sobre seguridad

GitHub Pages es estático, por lo que todo JavaScript enviado al navegador es visible. El sitio público solo posee la clave pública/publishable de Supabase, que únicamente permite lectura de juegos publicados (según las políticas RLS de `supabase.sql`). Toda la gestión (subir, editar, borrar) ocurre en `admin.html`, que usa la clave `service_role` y por eso debes mantenerlo siempre privado.

### Ruffle Nightly

FlashVault usa el canal oficial `nightly` de Ruffle mediante UNPKG. Esto hace que el reproductor web se actualice automáticamente a la nightly publicada más reciente.

## Subida multifuncional

FlashVault admite dos tipos de publicaciones: un SWF único y un paquete ZIP de múltiples recursos (ambos se publican desde `admin.html`). En paquetes de Flashpoint/Inkagames, el sistema elimina el prefijo `content/`, busca los HTML dentro de `www.inkagames.com`/`www.inkagames.info`, elige el HTML de mayor tamaño, extrae sus FlashVars, localiza el loader y el SWF principal y sube todos los archivos conservando sus rutas. Durante la reproducción se ejecuta el loader con Ruffle y `urlRewriteRules` redirige los dominios antiguos hacia los recursos públicos del paquete. Los juegos antiguos que solo tienen `swf_url` continúan cargándose como SWF único.

### Migración

En una instalación existente ejecuta una sola vez `supabase-migration-multifunctional.sql` en Supabase > SQL Editor. No vuelvas a ejecutar `supabase.sql` sobre una instalación existente.
