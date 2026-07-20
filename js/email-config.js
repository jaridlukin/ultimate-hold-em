/**
 * Optional share-email API override.
 *
 * Silent Send uses the same Gmail SMTP backend as vegas-hotels via serve.py
 * (POST /api/send-email). Leave apiUrl empty to call same-origin /api/send-email
 * when you run: python serve.py
 *
 * On GitHub Pages (no backend), Send falls back to mailto:.
 * See SHARE_EMAIL.md.
 */
window.UTHEmailConfig = {
  // Example remote backend: "https://your-host.example.com"
  apiUrl: "",
};
