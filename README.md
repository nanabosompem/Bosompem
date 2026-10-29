# Bosompem Web Push server

This small Node.js service receives Web Push subscriptions and sends notifications using VAPID. The browser receives push through `sw.js`; GitHub Pages alone cannot send push messages because it has no server-side secret or scheduler.

## 1. Generate VAPID keys

```sh
npm install
npm run vapid
```

Copy the public and private key output into the hosting provider's environment variables. **Keep `VAPID_PRIVATE_KEY` and `PUSH_ADMIN_TOKEN` secret.** Never commit real values to Git.

## 2. Configure and run

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a mailto address), `PUSH_ADMIN_TOKEN` (at least 24 characters), and `ALLOWED_ORIGINS` (comma-separated exact origins of the hosted app; no paths). Then run:

```sh
npm start
```

Use a host with HTTPS and persistent storage for `subscriptions.json`. This server stores subscription endpoints and keys, which are sensitive capability URLs; restrict access to the file and back it up securely. The in-memory rate limiter is a basic safeguard, not a substitute for production identity/rate limiting. For a multi-user production service, add authentication and a managed database.

## 3. Configure Bosompem

In Settings → Notifications, enter the public server URL and the VAPID public key, then tap **Enable remote push** on each device. Grant notification permission. Keep the private key server-side only.

## 4. Send a notification

Send requests from a trusted admin environment only (not a public webpage):

```sh
curl -X POST "$PUSH_SERVER_URL/api/send" \
  -H "Authorization: Bearer $PUSH_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Bosompem","body":"Your scheduled update is ready.","url":"./","tag":"daily-update"}'
```

The app's **Send test push** control is for owner testing: enter the admin token temporarily. Do not expose this token to untrusted users. For production, remove the admin-token field from the public UI and trigger `/api/send` from a trusted scheduler or authenticated backend workflow.

## API

- `GET /health` — health check.
- `GET /api/config` — returns only the VAPID public key.
- `POST /api/subscribe` — `{ "subscription": PushSubscription.toJSON(), "origin": "https://..." }`.
- `POST /api/unsubscribe` — `{ "endpoint": "https://..." }`.
- `POST /api/send` — admin Bearer token and `{ "title", "body", "url", "tag" }`; sends to all registered subscriptions and prunes expired (404/410) endpoints.

Only allow the exact production app origin in `ALLOWED_ORIGINS`. CORS is not authentication; the send route is protected by the admin token.
