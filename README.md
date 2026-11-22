# ape

a small pastebin for sharing plain text, built on [cloudflare workers](https://www.cloudflare.com/products/workers/) and [d1](https://www.cloudflare.com/products/d1/).

- share up to 64 kib of text without an account.
- copy an unlisted link at `/<id>` or open the raw text at `/<id>/raw`.
- choose an expiry of 1 hour, 1 day, or 7 days. pastes are removed automatically.
