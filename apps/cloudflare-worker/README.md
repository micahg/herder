# Deploy

First, setup the required secrets:
```sh
npx wrangler secret put WHATSAPP_VERIFY_TOKEN --cwd apps/cloudflare-worker
npx wrangler secret put WHATSAPP_APP_SECRET --cwd apps/cloudflare-worker
```

`WHATSAPP_APP_SECRET` is the **App Secret** from your Meta app dashboard (Settings → Basic). It is used to validate `X-Hub-Signature-256` on incoming webhook payloads. `POST /webhooks` currently only validates the signature and acknowledges the request with `200`; missing or invalid signatures are rejected with `401`.

Then, deploy:
```sh
npm run deploy --workspace @herder/cloudflare-worker
```
