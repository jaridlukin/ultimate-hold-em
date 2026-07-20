# Share hand — email

**Send** delivers a hand summary to the address you enter. **Copy text** always copies the summary to the clipboard.

## Default (no setup): mailto

On GitHub Pages, or anytime the share API is unreachable, Send opens your email app via a `mailto:` link (recipient, subject, and hand summary filled in). No account or secrets required.

## Silent send: Gmail SMTP (same as vegas-hotels)

Vegas Hotels and this trainer use the same Gmail App Password + `smtplib` setup.

### 1. Configure credentials

```text
# Copy this file to config.txt and fill in your values.
copy config.example.txt config.txt
```

Edit `config.txt`:

```text
GMAIL_ADDRESS: your-email@gmail.com
GMAIL_APP_PASSWORD: xxxx xxxx xxxx xxxx
```

Gmail App Password (not your normal password):

1. Go to https://myaccount.google.com/apppasswords
2. Enable 2-Factor Authentication if needed
3. Create an App Password for “Mail”
4. Paste the 16-character password into `config.txt`

`config.txt` is gitignored — never commit it.

### 2. Run the local server

```bash
python serve.py
```

Open http://127.0.0.1:8765/ — Share → Send posts to `/api/send-email`, which sends via `smtp.gmail.com:587` (STARTTLS), same as vegas-hotels.

Check status: `GET /api/email-status` → `{ "ok": true, "configured": true, "transport": "gmail-smtp" }`.

### Optional: remote API URL

If you host `serve.py` (or an equivalent `/api/send-email` endpoint) elsewhere, set in `js/email-config.js`:

```js
window.UTHEmailConfig = {
  apiUrl: "https://your-host.example.com",
};
```

Bump the `email-config.js` cache-bust query in `index.html` after changing it.
