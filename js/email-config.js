/**
 * API base URL for share-email + leaderboard (serve.py).
 *
 * - Local (localhost / 127.0.0.1): ui.js ignores apiUrl and uses same-origin
 *   so `python serve.py` always works even when this points at a Pages tunnel.
 * - GitHub Pages: MUST set a public HTTPS URL that runs serve.py
 *   (/api/send-email and /api/leaderboard). See SHARE_EMAIL.md.
 */
window.UTHEmailConfig = {
  // Public HTTPS API for Pages (Cloudflare tunnel → local serve.py). Restart
  // tunnel if this URL stops working, then update and redeploy Pages.
  // Ignored when the page is opened on localhost / 127.0.0.1.
  apiUrl: "https://generates-pmc-senior-sophisticated.trycloudflare.com",
};
