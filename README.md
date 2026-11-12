# Bosompem Pro v4 — browser-first upgrade

This package is built from the latest files you supplied. It preserves the Living Constellation voice animation and existing feature screens while refreshing the visual system and repairing offline caching.

## Files
- `index.html`, `style.css`, `app.js`: browser app
- `manifest.json`, `sw.js`: installability, offline shell and push handling
- `icon-192.png`, `icon-512.png`: generated app icons
- `server.js`, `package.json`: optional Web Push sender

## Important notes
1. The Gemini API key is still entered in the browser app. A public frontend cannot keep that key secret. Do not use a key with unrestricted access or quotas you cannot afford. A server-side AI proxy is the next security step.
2. Image generation depends on the models and quota enabled for your Gemini API project. The UI cannot guarantee free generation.
3. Local reminder notifications work only while the browser/app can run its JavaScript. Delivery while the app is closed requires a deployed push server and a scheduler/worker that sends due reminders. The included server currently supports subscription storage and authenticated broadcast test sends; it does not yet schedule reminders automatically.
4. The push server requires Node.js 20+, `npm install`, VAPID keys, `PUSH_ADMIN_TOKEN` (at least 24 characters), and `ALLOWED_ORIGINS` set to your exact deployed website origin. Keep `VAPID_PRIVATE_KEY` and `PUSH_ADMIN_TOKEN` private.
5. Native Android controls and a true always-on wake word still require a native Android companion. A browser PWA cannot reliably listen in the background or control Wi-Fi, Bluetooth, flashlight or other apps.

## Phone-friendly deployment
Replace the matching files in your GitHub repository with the files from this folder. Upload both icon PNGs too. Keep file names exactly as shown. Commit the changes, then open your GitHub Pages site and refresh it. If an older version remains, close the installed PWA, clear the site's cached data in Chrome, and reopen it.

The push server is optional; the main PWA can be deployed without it. Do not upload `.env`, VAPID private keys, admin tokens, or `subscriptions.json` to the public GitHub repository.
