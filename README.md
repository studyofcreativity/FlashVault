# FlashVault

Biblioteca web de juegos Flash (.swf) con **Ruffle + Supabase**, preparada para publicar en GitHub Pages.

## 1. Configura Supabase

Crea un proyecto en Supabase y abre **SQL Editor**. Ejecuta todo el contenido de `supabase.sql`.

Luego ve a **Authentication > Users** y crea tu cuenta de administrador con correo y contraseña. Copia el UUID de tu usuario y sigue el paso marcado en `supabase.sql` para convertirlo en administrador.

El SQL incluido crea automáticamente los buckets `flash-games` y `flash-covers` y sus políticas. No los crees manualmente antes de ejecutar el SQL; solo hazlo si Supabase muestra un error explícito al crear los buckets.

## 2. Configura la página

`config.js` ya viene preparado para el proyecto de Supabase de FlashVault. Solo debes cambiar `EXTRA_ADMIN_KEY` por una clave larga que inventes tú.

Si vuelves a crear el proyecto de Supabase, sustituye también `SUPABASE_URL` y `SUPABASE_ANON_KEY` por los nuevos valores.

**Nunca** pongas la `service_role` key en `config.js` ni la subas a GitHub.

La clave extra es solamente una segunda barrera en la interfaz. La autorización real para publicar la hace Supabase Auth + RLS.

## 3. GitHub

Sube `index.html`, `style.css`, `app.js` y `config.js` a tu repositorio.

En GitHub: **Settings > Pages > Deploy from a branch** y selecciona la rama principal y la carpeta `/root`.

## 4. Uso

Los visitantes solo ven juegos que estén con `published = true`.

Tú entras en **Panel privado**, inicias sesión y publicas:

- nombre
- descripción
- portada
- archivo `.swf`

Al publicar, el SWF queda almacenado en Supabase Storage y FlashVault lo carga con Ruffle sin pedir al visitante que exporte el juego.

## Nota sobre seguridad

GitHub Pages es estático, por lo que todo JavaScript enviado al navegador es visible. No existe una "clave super secreta" segura dentro del HTML/JS. Por eso este proyecto usa el modelo correcto: el navegador posee solamente la clave pública/publishable de Supabase y RLS impide insertar juegos a quien no sea tu usuario administrador.
