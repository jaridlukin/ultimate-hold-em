/**
 * Optional share-email API override.
 *
 * Silent Send uses the same Gmail SMTP backend as vegas-hotels via serve.py
 * (POST /api/send-email). Leave apiUrl empty to call same-origin /api/send-email
 * when you run: python serve.py and open http://127.0.0.1:8765/
 *
 * On GitHub Pages (no backend), Send uses mailto: unless you set apiUrl.
 * Do not use python -m http.server — it has no /api. See SHARE_EMAIL.md.
 */
window.UTHEmailConfig = {
  // Example remote backend: "https://your-host.example.com"
  apiUrl: "",
};
