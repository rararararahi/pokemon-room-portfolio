# DEV NOTES

## Local run
- Install deps: `npm install`
- Start client: `npm run dev`
- Start full app with API routes: `vercel dev`
- Game scenes:
  - Main room key: `room`
  - Trophy room key: `trophy`

## Vercel env vars
Set these in Vercel Project Settings -> Environment Variables:
- `STRIPE_SECRET_KEY` (optional but recommended for line-item fallback lookup)
- `STRIPE_WEBHOOK_SECRET` (required to verify webhook signatures)
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (preferred storage)

Fallback behavior:
- If KV is unavailable, API attempts `@vercel/postgres` when configured.
- If neither KV nor Postgres is available, API uses in-memory dev storage with warnings.

## Stripe webhook setup
- Endpoint URL (prod): `https://<your-domain>/api/webhook/stripe`
- Endpoint URL (local, via tunnel): `https://<your-tunnel>/api/webhook/stripe`
- Subscribe at minimum to:
  - `checkout.session.completed`
  - `payment_intent.succeeded`

## Payment link mapping
- File: `public/data/payment_links.json`
- Map static payment link URLs to `beatId`/`beatName` when metadata is not present.
- If you generate Checkout Sessions yourself, include metadata (`beatId`, `beatName`) directly.

## Local purchase testing
- Dev-only endpoint (disabled in production): `POST /api/dev/addPurchase`
- Example request body:
```json
{
  "beatId": "beat01",
  "beatName": "InTheClub",
  "buyerName": "Local Tester",
  "buyerEmail": "tester@example.com"
}
```
- Verify trophies by entering the trophy room and waiting for state refresh (auto-polls ~10s).

## Test plan
1. Desktop controls:
- Arrow keys move, Shift runs, `A`/Space interacts, `B`/Esc backs out.
- Open/close shop and TV; movement resumes without drift.

2. Mobile controls:
- Hold D-pad to move, tap A to interact, hold A to run.
- B exits dialog/shop/tv.
- No drift after closing overlays.

3. Room transitions:
- Walk into right-wall door in main room -> trophy room.
- Walk into left-wall door in trophy room -> main room.
- Repeat several times; movement remains responsive.

4. Trophy state:
- Call `POST /api/dev/addPurchase`.
- Enter trophy room and confirm trophy appears on earliest empty pillar.
- Press A near trophy to see `TROPHY / BEAT / BY` dialog.

5. Email capture after 60s shop open:
- Open computer shop and keep it open for 60 seconds continuously.
- Submit Name + Email.
- Confirm success message appears, form closes, shop remains open, controls resume cleanly.
