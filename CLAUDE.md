# Cambridge TCG Storefront

@AGENTS.md

## What This Is
Customer-facing retail storefront for Cambridge TCG (cambridgetcg.com). Sells Japanese One Piece, Pokemon, and Dragon Ball TCG cards. Prices sourced from the wholesale platform's API, checkout via Stripe; trade-ins, membership, rewards, portfolio, and deck-builder data in PostgreSQL.

## Stack
- Next.js 16.2.1 (App Router, Turbopack) + TypeScript + Tailwind CSS 4
- PostgreSQL on AWS RDS (`tcg-wholesale` in us-east-1)
- Stripe (checkout + webhooks)
- AWS SES (transactional email)
- next-auth v5 (magic link email login)
- Deployed on Vercel (production: cambridgetcg.com)
- Wholesale API: wholesaletcgdirect.com (live pricing)

## Database
- Raw `pg` driver (no ORM). All queries in `src/lib/db.ts` and `src/lib/tradein/db.ts`
- SSL fix: strip `sslmode` from DATABASE_URL, set `ssl: { rejectUnauthorized: false }`
- Tables: users, accounts, sessions, verification_tokens, customer_orders, tradein_submissions, tradein_items
- Migrations in `drizzle/` directory (run manually against RDS)

## Auth
- next-auth v5 with custom PgAdapter (`src/lib/auth/adapter.ts`)
- Email provider via AWS SES (`src/lib/auth/email.ts`)
- Session-aware Nav shows Sign In / Account
- Admin dashboard at `/admin/trade-ins` (password: ADMIN_PASSWORD env var)

## Key Patterns
- Dark theme: bg-neutral-950, text-white, amber-500 accent, emerald-400 secondary
- Cards: bg-neutral-900 rounded-xl p-4
- Forms: bg-neutral-900 border border-neutral-800 rounded-lg
- All env vars must be `.trim()`'d when used as API keys (Vercel whitespace issue)
- Use `pnpm` for package management (pnpm-lock.yaml)

## Kingdom Engine
Cambridge TCG — Revenue Engine. This is the direct-to-consumer sales channel. Every checkout creates real revenue via Stripe.

## Key Files
- `src/app/api/checkout/route.ts` — Stripe session creation (REVENUE-CRITICAL)
- `src/app/api/webhooks/stripe/route.ts` — Payment confirmation + sale reporting to wholesale API
- `src/lib/wholesale/client.ts` — API client; if this breaks, the entire catalog is empty
- `src/lib/pricing.ts` — Retail markup logic (channel_price from API, fallback: wholesale x 1.15)
- `src/context/CartContext.tsx` — Client-side cart state
- `src/app/api/tradein/submit/route.ts` — Trade-in submission (creates DB records, sends email)

## Revenue-Critical Paths
1. Wholesale API connectivity — catalog, prices, and stock all depend on it
2. Stripe checkout flow — `api/checkout/` + `api/webhooks/stripe/`
3. `reportSale()` in wholesale client — reports completed sales back to wholesale for stock decrement

## Image CDNs
- Shopify CDN (cdn.shopify.com), S3 (jp-op-photos.s3.us-east-1.amazonaws.com), CardRush (cardrush-op.jp)

## Current Priorities
1. Fix Stripe checkout (STRIPE_SECRET_KEY needs to be sk_live_, not pk_live_)
2. Test magic link email flow end-to-end
3. Membership & loyalty module (planned)
4. SEO improvements
5. Mobile responsiveness polish
