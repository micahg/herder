# Deploy

First, setup the verify token:
```sh
npx wrangler secret put WHATSAPP_VERIFY_TOKEN --cwd apps/cloudflare-worker
```

Then, deploy:
```sh
npm run deploy --workspace @herder/cloudflare-worker
```
