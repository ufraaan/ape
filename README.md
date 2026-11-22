# ape

A small pastebin on Cloudflare Workers and D1. No accounts, no passwords. Each paste gets an
opaque link, an expiry (1 hour, 1 day, or 7 days), and a one-time deletion token.

- `GET /` compose form
- `POST /pastes` create (64 KiB of UTF-8 text, hard limit)
- `GET /p/:id` rendered paste
- `GET /p/:id/raw` exact bytes, `text/plain; charset=utf-8`
- `POST /p/:id/delete` delete with the token
- `GET /abuse` abuse reporting instructions

Expired pastes are hidden on read immediately and deleted by an hourly cron. Paste responses are
`no-store` and `noindex`; the HTML is served with a strict CSP.

## Local development

No secrets are needed. Turnstile and the abuse mailbox are off when unset.

```sh
npm ci
npx wrangler d1 migrations apply ape --local
npm run dev
```

Open <http://localhost:8787>. If port 8787 is taken:

```sh
npm run dev -- --port 8799
```

`npm run dev` includes `--test-scheduled`, which exposes the local cron hook used by the smoke
test. Local D1 state lives in `.wrangler/state` and is gitignored.

### Smoke test

With `npm run dev` running in another terminal:

```sh
npm run smoke
# if you changed the port:
SMOKE_BASE_URL=http://127.0.0.1:8799 npm run smoke
# also assert the abuse mailbox if dev was started with one:
#   npm run dev -- --var ABUSE_EMAIL:abuse@example.com
SMOKE_ABUSE_EMAIL=abuse@example.com npm run smoke
```

The script exercises the real Worker and local D1: assets and CSP, create, canonical link,
independent view/raw reads with exact bytes, UTF-8 limit and 413, expiry and scheduled cleanup,
malformed/wrong/successful delete, token leakage, XSS escaping, abuse page, and the create rate
limiter. It writes to local D1 only (it creates pastes, forces one to expire, and deletes one).
The rate-limiter probe at the end uses the whole 10-per-minute window, so wait a minute before
running the smoke test again.

### Other checks

```sh
npm run typecheck
npm run build   # wrangler deploy --dry-run, writes dist/
```

## Deploy on Workers Free

The app fits the Workers Free plan (100,000 requests/day, 10 ms CPU per request) and D1 Free
(5 million row reads/day, 100,000 row writes/day, 5 GB stored).

```sh
npx wrangler login
npx wrangler d1 create ape
```

Copy the `database_id` from the output into `wrangler.jsonc`, replacing the empty string, then:

```sh
npx wrangler d1 migrations apply ape --remote
npx wrangler deploy
```

Wrangler prints the `https://ape.<your-subdomain>.workers.dev` URL. The cron trigger and rate
limiting binding deploy with the Worker.

Re-deploy after future schema changes with:

```sh
npx wrangler d1 migrations apply ape --remote
npx wrangler deploy
```

### Turnstile (optional locally, required for public use)

Without both keys the app runs with no bot check. For a public site, create a Turnstile widget
for your hostname, then set the site key in the `vars` block of `wrangler.jsonc` and store the
secret:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler deploy
```

Also set `ABUSE_EMAIL` in `wrangler.jsonc` so `/abuse` shows a contact address. Enabling Turnstile
widens the CSP only for `https://challenges.cloudflare.com`.

To try Turnstile locally, create `.dev.vars` (gitignored) with Cloudflare's always-pass test keys:

```sh
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
ABUSE_EMAIL=abuse@example.com
```

Setting only one of the two Turnstile values is treated as a misconfiguration and returns 503.

### Create rate limiting

`wrangler.jsonc` binds `CREATE_RATE_LIMIT` (10 creates per 60 seconds, keyed by client IP). It uses
the Workers Rate Limiting binding, which Cloudflare's docs do not gate to a paid plan; it is
emulated by `wrangler dev`. Counts are approximate and local to each Cloudflare location, so this
is abuse friction, not a precise quota. `namespace_id` is shared across your account, so change it
if another Worker already uses `1001`. If your account rejects the binding on deploy, delete the
`ratelimits` entry: the route treats the binding as optional and skips limiting when absent.

### Expiry cleanup

The `17 * * * *` cron calls the Worker's scheduled handler, which deletes expired rows in batches
of 50. Workers Free allows up to 5 cron triggers. Reads already hide expired rows, so cleanup is
housekeeping rather than a security boundary.

## Operating pastes

There is no public admin endpoint. Operators take a paste down with the paste ID (the segment
after `/p/`):

```sh
npx wrangler d1 execute ape --remote --command "DELETE FROM pastes WHERE id = '<paste-id>'"
```

To purge every currently expired row early:

```sh
npx wrangler d1 execute ape --remote --command "DELETE FROM pastes WHERE expires_at <= unixepoch()"
```

Users delete their own paste with the token shown once after creation. Deletion is permanent;
there is no recovery.

## Notes

- The deletion token is stored only as a SHA-256 hash. It appears once in the create response and
  is never rendered by view, raw, or error responses.
- The create success page is an HTML response containing the token, so refreshing it re-submits
  the form and creates another paste.
- Raw responses are served as `text/plain` with `nosniff`, so pasted HTML cannot execute.
- No analytics, cookies, or external assets are used. Turnstile is the only third-party script,
  and only when enabled.
