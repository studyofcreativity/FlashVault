(() => {
  // FlashVault compatibility layer. It intentionally does NOT patch fetch/XHR,
  // so Supabase REST/Storage responses remain untouched. Legacy game URLs are
  // handled by Ruffle's urlRewriteRules when a multi-resource package is played.
  window.FLASHVAULT_RUFFLE_COMPAT = { version: '2.0', patchesNetworkFetch: false };
})();
