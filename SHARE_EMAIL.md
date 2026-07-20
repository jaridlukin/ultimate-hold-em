# Share hand — email

**Send** works out of the box: it opens your email app via a `mailto:` link with the recipient, subject, and hand summary. No account or secrets required. **Copy text** still copies the summary to the clipboard.

## Optional: EmailJS (silent send)

If you want Send to deliver mail from the browser without opening a mail client, configure [EmailJS](https://www.emailjs.com/):

1. Create an EmailJS account and add an email service (note the **Service ID**).
2. Create a template with `{{to_email}}`, `{{subject}}`, and `{{message}}`. Set the template **To** field to `{{to_email}}`.
3. Copy your **Public Key** from Account → API Keys.
4. Edit `js/email-config.js`:

```js
window.UTHEmailConfig = {
  serviceId: "service_xxxxx",
  templateId: "template_xxxxx",
  publicKey: "xxxxxxxx",
};
```

When all three fields are non-empty, Send uses EmailJS. Otherwise it uses `mailto:`.

Commit and push so GitHub Pages picks up the change. Bump the `email-config.js` cache-bust query in `index.html` if browsers keep an old config.
