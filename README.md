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


### Ruffle Nightly

FlashVault usa el canal oficial `nightly` de Ruffle mediante UNPKG. Esto hace que el reproductor web se actualice automáticamente a la nightly publicada más reciente. Ruffle indica que las nightlies son builds diarios con correcciones y mejoras antes de llegar a las versiones estables.

## Diagnóstico privado de recursos

FlashVault incluye un diagnóstico que muestra las URL que el reproductor consigue observar durante la ejecución del juego, junto con estado, tipo, duración y errores. El diagnóstico está desactivado para visitantes normales y solo se muestra cuando la sesión de Supabase pertenece al UID configurado en `ADMIN_USER_ID`.

En `config.js` añade el UID exacto de tu cuenta administradora:

```js
window.FLASHVAULT_CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-PUBLISHABLE-KEY',
  EXTRA_ADMIN_KEY: 'TU-CLAVE-EXTRA',
  ADMIN_USER_ID: 'EL-UID-DE-TU-CUENTA'
};
```

El UID no sustituye a Supabase Auth ni a las políticas RLS. La comprobación evita que el panel de diagnóstico aparezca para otras cuentas, pero cualquier dato enviado al navegador no debe considerarse un secreto criptográfico.
