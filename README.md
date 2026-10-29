# Bosompem Pro v3 — Image + Push Upgrade

This package contains the upgraded static app and an optional Node.js Web Push server.

## Image generation
1. Host the app over HTTPS (GitHub Pages is fine for the frontend).
2. Open Settings and add your Gemini API key.
3. Open Vision Studio, write a prompt, choose an aspect ratio and size, then select **Generate image**.
4. Save the generated image locally. Availability and cost depend on your Gemini API project and supported image model access.

The app tries `gemini-3.1-flash-image`, then `gemini-2.5-flash-image`. It sends the API key in the `x-goog-api-key` header, not in the URL. As with any static frontend, a key entered into the browser remains accessible to that browser's JavaScript and should be restricted in Google AI Studio/Cloud.

## Remote push notifications
The service worker can receive Web Push, but GitHub Pages cannot send notifications by itself. The included `push-server/` service receives subscriptions and sends push messages.

1. Deploy `push-server/` to a Node.js host with HTTPS and persistent disk storage.
2. Run `npm install` and `npm run vapid` in `push-server/` to generate VAPID keys.
3. Configure the environment variables described in `push-server/README.md`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_ADMIN_TOKEN`, and `ALLOWED_ORIGINS`.
4. Keep the private key and admin token on the server. Never commit them or put them in frontend source code.
5. In the app Settings → Notifications, enter the HTTPS server URL and VAPID public key, then tap **Enable remote push** on every device and grant notification permission.
6. Use **Send test push** only as the owner/admin, entering the admin token temporarily. For production, prefer triggering `/api/send` from a trusted server or scheduler and remove the public UI admin-token field if other people can use the app.

`ALLOWED_ORIGINS` must include the exact frontend origin, for example `https://nanabosompem.github.io` (origin only; no `/Bosompem/` path). Add localhost only for local development. The subscription store contains sensitive push endpoints; use persistent private storage and limit access.

## Validation and limitations
Static checks passed for JavaScript syntax, service-worker syntax, JSON manifest validity, unique HTML IDs, inline handler references, and icon dimensions. Live image generation and remote delivery were not exercised because they require your API key, deployed push server, VAPID keys, and device permission. No production site, branch, or deployment was changed.
