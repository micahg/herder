# Deploy

First, setup the verify token:
```sh
npx wrangler secret put WHATSAPP_VERIFY_TOKEN --cwd apps/cloudflare-worker
```

Then, the secret:
```sh
npx wrangler secret put WHATSAPP_APP_SECRET --cwd apps/cloudflare-worker
```

Navigate to business.facebook.com, select your business, its settings, system users. Create a user if one doesn't exist and generate a token with `whatsapp_business_messaging`.

Also, don't forget to assign assets to the app - specifically the whatsapp test account.

Then, add the WhatsApp Cloud API access token:
```sh
npx wrangler secret put WHATSAPP_ACCESS_TOKEN --cwd apps/cloudflare-worker
```

Then, add the OpenRouter API key:
```sh
npx wrangler secret put OPENROUTER_API_KEY --cwd apps/cloudflare-worker
```

Optional worker vars (configure in `wrangler.jsonc` vars or `.dev.vars`):
- `OPENROUTER_MODEL` (default: `openrouter/auto`)
- `OPENROUTER_SYSTEM_PROMPT`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_TITLE`

Then, deploy:
```sh
npm run deploy --workspace @herder/cloudflare-worker
```
