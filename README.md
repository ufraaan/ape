# ape

a small pastebin for sharing plain text, built on [cloudflare workers](https://www.cloudflare.com/products/workers/) and a sqlite-backed [durable object](https://developers.cloudflare.com/durable-objects/).

- share up to 64 kib of text without an account.
- copy an unlisted link at `/<id>` or open the raw text at `/<id>/raw`.
- choose an expiry of 1 hour, 1 day, or 7 days. pastes are removed automatically.

## deployments

install dependencies with bun 1.4.5 using `bun install --frozen-lockfile`. scripts and wrangler run on node 26.

pushes to `main` run type checking, tests, and a build in github actions, then deploy to [ape.ufraan.dev](https://ape.ufraan.dev/). pull requests run the same checks without deploying. the workflow also supports manual runs from `main`.

deployment uses the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. to roll back a code change, revert its commit on `main`; the next successful workflow deploys the revert. durable object data is preserved.
