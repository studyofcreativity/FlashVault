// Copia este archivo a "config.js" y reemplaza estos valores con los de tu proyecto Supabase.
// Usa la publishable/anon key del navegador. NUNCA pongas service_role aquí.
window.FLASHVAULT_CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-PUBLISHABLE-KEY',
  // Esta clave solo añade una barrera visual en el panel.
  // La seguridad real la hace Supabase Auth + RLS.
  EXTRA_ADMIN_KEY: 'CAMBIA-ESTA-CLAVE-POR-UNA-MUY-LARGA-Y-UNICA'
};
