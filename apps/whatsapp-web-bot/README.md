# WhatsApp Web Bot

Node.js WhatsApp bot using `whatsapp-web.js` + OpenRouter.

This service exposes a small HTTP API for health and QR setup, and listens to incoming WhatsApp messages. Messages that start with the configured command prefix (default `!herder`) are forwarded to OpenRouter and replied to in chat.

## Requirements

- Node.js 18+
- npm
- A Chrome/Chromium runtime that Puppeteer can launch

Notes:
- The app can start without browser connectivity, but WhatsApp message handling will stay inactive until a browser runtime is available.
- In non-production, if `WA_WEB_ADMIN_SETUP_TOKEN` is missing, an ephemeral token is generated and logged at startup.

## Environment Variables

Use your shell/profile/secrets manager to provide env vars. Dotenv is not required.

Required in production:

- `WA_WEB_ADMIN_SETUP_TOKEN`: Bearer token for setup endpoint auth (`/setup/qr`)

Recommended for normal bot replies:

- `OPENROUTER_API_KEY`: API key used to generate replies

Optional:

- `PORT` (default: `3000`)
- `CHAT_PROTOCOL` (default: `whatsapp`)
- `WA_WEB_CLIENT_ID` (default: `herder`)
- `BOT_MENTION_PREFIX` (default: `!herder`)
- `OPENROUTER_MODEL` (default: `openrouter/auto`)
- `OPENROUTER_SYSTEM_PROMPT`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_TITLE`
- `PUPPETEER_EXECUTABLE_PATH` (absolute path to Chrome/Chromium binary)

Example:

```sh
export WA_WEB_ADMIN_SETUP_TOKEN='replace-with-long-random-token'
export OPENROUTER_API_KEY='or-...'
export PORT=3000
```

## Install

From repo root:

```sh
npm install
```

If Puppeteer browser download has issues in your environment, you can skip download and point to a local browser:

```sh
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

Then set:

```sh
export PUPPETEER_EXECUTABLE_PATH='/absolute/path/to/chrome-or-chromium'
```

## Run (Dev)

From repo root:

```sh
npm run dev --workspace @herder/whatsapp-web-bot
```

The service chooses `PORT` if available; if occupied, it will automatically use the next free port.

## Build and Start

```sh
npm run build --workspace @herder/whatsapp-web-bot
npm run start --workspace @herder/whatsapp-web-bot
```

## API Endpoints

### `GET /health`

Returns health + WhatsApp readiness:

```json
{
  "ok": true,
  "protocol": "whatsapp",
  "ready": false,
  "hasSetupCode": false,
  "hasQr": false
}
```

- `ready`: protocol runtime authenticated and connected
- `hasSetupCode`: setup token/code is currently available for pairing/auth
- `hasQr`: legacy alias for WhatsApp clients

### `GET /setup/qr`

Returns current pairing QR (when available).

Auth header required:

```http
Authorization: Bearer <WA_WEB_ADMIN_SETUP_TOKEN>
```

Example:

```sh
curl -H "Authorization: Bearer $WA_WEB_ADMIN_SETUP_TOKEN" http://localhost:3000/setup/qr
```

Response:

```json
{
  "ready": false,
  "qr": "..."
}
```

## WhatsApp Pairing Flow

1. Start the service.
2. Call `/setup/qr` with the setup token.
3. Scan the QR with WhatsApp on your phone.
4. Once paired, `/health` should report `ready: true`.

Session/auth files are stored under `apps/whatsapp-web-bot/.wwebjs_auth/` by `LocalAuth`.

## Message Behavior

- Ignores messages sent by the bot itself
- Ignores non-chat messages
- Only responds when text starts with command prefix (default: `!herder`)
- Prompt sent to OpenRouter is the text after the prefix

### Built-in Tooling

The OpenRouter request supports a generic channel tool interface:

- `list_channels`
- `get_current_channel`

The WhatsApp adapter currently overrides these with WhatsApp-specific tool names for compatibility:

- `list_whatsapp_group_chats`: "List the whatsapp group chats this user belongs to"
- `get_current_whatsapp_group_chat`: "Get the whatsapp group chat for the current message"

When the model chooses that tool, the bot returns group chat summaries in `{ id, name }` format from the authenticated WhatsApp account.

## Protocol Structure

Protocol implementations are now isolated under `src/protocols/`.

- `src/protocols/types.ts`: generic runtime and channel/tool interfaces
- `src/protocols/index.ts`: adapter registry/factory
- `src/protocols/whatsapp/`: WhatsApp runtime and setup routes

This layout is intended to make future protocol adapters (for example Teams/Discord/IRC) plug in behind the same generic interfaces.

## Troubleshooting

### `Error: ... LocalAuth export` / module export errors

This is an ESM/CJS interop issue. The runtime import path in `src/whatsapp.ts` already uses default-package destructuring.

### `Could not find Chrome` / browser launch issues

- Install Chrome/Chromium, or
- Set `PUPPETEER_EXECUTABLE_PATH` to a working browser binary path

If startup says WhatsApp connectivity is inactive, the API can still run but WhatsApp will not connect until browser runtime is fixed.

### `EADDRINUSE`

The app auto-selects the next free port. Check startup logs for the actual chosen port.

### Missing `OPENROUTER_API_KEY`

App can still start. Reply generation will fail when an incoming message actually triggers OpenRouter.

## Tests and Checks

```sh
npm run check --workspace @herder/whatsapp-web-bot
npm run test --workspace @herder/whatsapp-web-bot
```

## List Group Chats (Test Script)

You can run a one-off script that logs all WhatsApp group chats visible to the authenticated account.

From repo root:

```sh
npm run list-groups --workspace @herder/whatsapp-web-bot
```

Notes:
- The script reuses `LocalAuth` via `WA_WEB_CLIENT_ID` (same auth session behavior as the bot runtime).
- On first run (or when auth expires), it prints a QR in terminal for pairing.
- Output format is one line per group with name and WhatsApp chat id.
