/**
 * Share-email API base URL (Gmail SMTP via serve.py, same as vegas-hotels).
 *
 * - Local: leave empty and open http://127.0.0.1:8765/ (python serve.py).
 * - GitHub Pages: MUST set a public HTTPS URL that runs serve.py /api/send-email
 *   (Pages cannot do SMTP itself). See SHARE_EMAIL.md.
 */
window.UTHEmailConfig = {
  // Public HTTPS share API (Cloudflare tunnel → local serve.py). Restart tunnel
  // if this URL stops working, then update and redeploy Pages.
  apiUrl: "https://generates-pmc-senior-sophisticated.trycloudflare.com",
};
