# InfiniDrive Backend

Cloudflare Worker backend for InfiniDrive cloud storage platform.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create D1 database:
```bash
npm run db:create
```

3. Update `wrangler.toml` with the database_id from step 2.

4. Run migrations:
```bash
npm run db:migrate
```

5. Set JWT secret:
```bash
wrangler secret put JWT_SECRET
```

6. Run locally:
```bash
npm run dev
```

7. Deploy:
```bash
npm run deploy
```

## Environment Variables

- `JWT_SECRET` - Secret key for JWT signing (set via wrangler secret)
- `TELEGRAM_API_URL` - Telegram Bot API base URL (default: https://api.telegram.org/bot)
