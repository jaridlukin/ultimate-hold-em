# Share hand — email

**Send** emails a hand summary via **Gmail SMTP** (same pattern as vegas-hotels). **Copy text** copies the summary to the clipboard.

## Why GitHub Pages opened the email app

`https://jaridlukin.github.io/ultimate-hold-em/` is **static**. It cannot run Python or talk to Gmail SMTP directly.

Silent SMTP requires a public **HTTPS** backend that runs `serve.py`’s `POST /api/send-email`. Set that URL in `js/email-config.js` as `apiUrl`.

## Local (same machine)

```bash
python serve.py
```

Open **http://127.0.0.1:8765/** — leave `apiUrl` empty so the page calls same-origin `/api/send-email`.

## Production (GitHub Pages)

1. Keep `python serve.py` running (with `config.txt` Gmail credentials).
2. Expose it on HTTPS (Cloudflare tunnel example):

```powershell
npx --yes cloudflared tunnel --url http://127.0.0.1:8765
```

3. Put the printed `https://….trycloudflare.com` URL into `js/email-config.js`:

```js
window.UTHEmailConfig = {
  apiUrl: "https://YOUR-TUNNEL.trycloudflare.com",
};
```

4. Deploy Pages (commit/push). Share on github.io will POST to that API over HTTPS (no mail app).

**Note:** Quick tunnels die when the process stops or the URL rotates. For a permanent URL, deploy `serve.py` to a small host (Render/Fly/VPS) with env `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD`, then set `apiUrl` to that host.

## Credentials

```text
copy config.example.txt config.txt
```

```text
GMAIL_ADDRESS: your-email@gmail.com
GMAIL_APP_PASSWORD: xxxx xxxx xxxx xxxx
```

Use a [Gmail App Password](https://myaccount.google.com/apppasswords). Never commit `config.txt`.

Check: `GET /api/email-status` → `{ "configured": true, "transport": "gmail-smtp" }`.
