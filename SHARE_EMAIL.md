# Share hand — EmailJS setup

The trainer is a static GitHub Pages app. **Share** sends mail from the browser via [EmailJS](https://www.emailjs.com/) (no backend).

## 1. Create an EmailJS account

1. Sign up at [https://www.emailjs.com/](https://www.emailjs.com/).
2. Add an **Email Service** (Gmail, Outlook, etc.) and note the **Service ID**.

## 2. Create an email template

Create a template with these template variables:

| Variable    | Use |
|-------------|-----|
| `{{to_email}}` | Recipient address (set the template **To** field to `{{to_email}}`) |
| `{{subject}}`  | Subject line |
| `{{message}}`  | Plain-text hand summary (body) |

Example body:

```
{{message}}
```

Subject in the EmailJS UI can be `{{subject}}` or a fixed title.

**Important:** Under template settings, allow the **To Email** to use `{{to_email}}` so recipients are not limited to your own address. Free plans may restrict this — check EmailJS docs for your plan.

## 3. Get your Public Key

Account → **API Keys** → **Public Key**.

## 4. Configure the app

Edit `js/email-config.js`:

```js
window.UTHEmailConfig = {
  serviceId: "service_xxxxx",
  templateId: "template_xxxxx",
  publicKey: "xxxxxxxx",
};
```

Commit and push so GitHub Pages picks up the change. Cache-bust on `email-config.js` in `index.html` if browsers keep an old empty config.

## 5. Test

1. Play a hand to showdown.
2. Click **Share**.
3. Enter a valid email and **Send**.
4. Or use **Copy text** if EmailJS is not configured yet.

If `serviceId`, `templateId`, or `publicKey` is empty, Send shows a message that EmailJS must be configured; Copy text still works.
