# FlashVault

FlashVault supports two Flash game types:
- Single-file SWF games
- Multi-resource Flashpoint-style packages (ZIP)

Multi-resource packages preserve the original host/folder structure. Flashpoint archives that contain a `content/` wrapper are normalized automatically so legacy URLs such as `www.inkagames.com/...` map correctly inside Supabase Storage.

Ruffle `urlRewriteRules` are used for SWF-internal network requests; browser `fetch` interception alone cannot rewrite requests made internally by Ruffle.

Run `supabase-migration-multi-resource.sql` once if the new columns do not yet exist.
