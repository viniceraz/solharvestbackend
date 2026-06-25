# SolHarvest — Backend (authoritative game server)

Node.js + Express + PostgreSQL. All game logic lives here so the client can't cheat.

## Run locally (no database needed)

```bash
cd server
npm install
npm run dev        # or: npm start
```

With no `DATABASE_URL`, the server boots an **in-process Postgres (PGlite, WASM)** and
runs the real migration automatically — so you can develop without installing Postgres.
Data resets on restart.

Health check: `GET http://localhost:3001/api/health`

Verify the auth flow end-to-end (generates a keypair, signs the nonce, connects, calls /me):

```bash
node scripts/test-auth.js
```

## Connect Supabase (or any Postgres) — do this when ready

1. Create a Supabase project → **Project Settings → Database → Connection string (URI)**.
2. Copy `.env.example` to `.env` and set:
   ```
   DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
   JWT_SECRET=<long random string>
   CORS_ORIGIN=http://localhost:5173
   ADMIN_WALLETS=<your phantom wallet address>
   ```
3. Run the schema once on Supabase (either is fine):
   - Paste `migrations/001_initial_schema.sql` into the Supabase **SQL Editor** and run it, **or**
   - Just start the server with `DATABASE_URL` set — it runs the migration on boot (idempotent).
4. `npm start`. The exact same code now talks to Supabase instead of PGlite.

> The migration SQL is plain Postgres and unchanged between PGlite and Supabase.

## Auth flow (wallet signature)

1. `GET /api/auth/nonce?wallet=<address>` → `{ nonce, message }`
2. Wallet signs `message` (`Sign this message to login to SolHarvest.\nNonce: <n>`)
3. `POST /api/auth/connect { wallet, signature, nonce }` → verifies via tweetnacl, returns `{ token, user }`
4. Send `Authorization: Bearer <token>` on every other request. `GET /api/auth/me` returns the current user.
5. Wallets listed in `ADMIN_WALLETS` get `role: 'admin'` in their JWT.

## Endpoints

| Status | Route |
|--------|-------|
| ✅ | `GET /api/health` |
| ✅ | `GET /api/auth/nonce`, `POST /api/auth/connect`, `GET /api/auth/me` |
| ⏳ | `bank`, `shop`, `inventory`, `farm`, `ranch`, `game`, `admin` (built next) |

## Layout

```
src/
├── index.js            Express app + route mounting + game-loop bootstrap
├── config/             env, constants (economy source of truth), database (pg | PGlite)
├── middleware/         auth (JWT), rateLimit, errorHandler
├── routes/             auth (+ bank/shop/farm/ranch/game/admin as built)
├── services/           game logic (gameLoop, farm, ranch, economy, weather, rarity)
├── models/queries.js   every SQL statement as a named function
└── utils/              solana (sig verify), helpers, serialize
migrations/001_initial_schema.sql   full schema (Supabase-ready)
```

## Environment variables

All config (incl. Solana network) is env-driven — see [`.env.example`](.env.example).

| Var | Description |
|-----|-------------|
| `DATABASE_URL` | Postgres URL (empty → in-process PGlite fallback) |
| `JWT_SECRET` | secret for signing auth JWTs |
| `PORT` | HTTP port (default 3001) |
| `CORS_ORIGIN` | allowed frontend origin (your Vercel URL in prod) |
| `NODE_ENV` | `development` / `production` |
| `ADMIN_WALLETS` | comma-separated wallets granted the admin role |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `SOLANA_NETWORK` | `devnet` / `mainnet-beta` |
| `PROGRAM_ID` | deployed Anchor program id |
| `HARVEST_MINT` | $HARVEST SPL mint address |
| `ADMIN_PRIVATE_KEY` | base58 secret of the vault authority (signs withdrawals) — prod |
| `ADMIN_KEYPAIR_PATH` | alt to the above: path to a keypair JSON array — local dev |
| `TOKEN_TO_HC_RATE` | $HARVEST per 1 HC (default 1000) |

## Migrations

Schema lives in `migrations/001_initial_schema.sql` and runs **automatically on boot**
(idempotent `CREATE TABLE IF NOT EXISTS`). To run it manually: `npm run migrate`.

## Deploy (Railway)

`railway.json` + `Procfile` start `node src/index.js` and health-check `/api/health`.
Add the **Railway Postgres** plugin (or point `DATABASE_URL` at Supabase), set the env
vars above in the Railway dashboard (never commit secrets), and deploy. The frontend
stays on Vercel with `VITE_API_URL` pointing at the Railway URL, and the backend's
`CORS_ORIGIN` must equal the Vercel domain. Full guide: [../MAINNET_DEPLOY.md](../MAINNET_DEPLOY.md).
