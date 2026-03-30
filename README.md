# Bluesky + GitHub Org Domain Verification Extension

Chrome extension that verifies:
- Bluesky domain handles by querying `_atproto.<domain>` TXT records and checking for `did=`
- GitHub organization domains by querying `_gh-<org>-o.<domain>` TXT records and checking if any TXT record exists

## Behavior

- Runs on:
  - `https://bsky.app/*`
  - `https://github.com/*`

### Bluesky

- Detects profile domain from URL pattern: `/profile/<domain>` (or handle text fallback).
- Queries:
  - `https://dns.google/resolve?name=_atproto.<domain>&type=TXT`
- If any TXT answer contains `did=`, shows a **Verified** badge.
- Otherwise shows an **Unverified** badge.
- Badge is shown only when the handle looks like a real domain (for example `example.com`).
- Handles ending in `.bsky.social` are excluded (no badge shown).

### GitHub Organizations

- Runs only on organization pages (not regular user pages).
- Discovers candidate domains from:
  - the organization website link
  - domains listed in GitHub's verified-domain section in the org header
- For each discovered domain, queries:
  - `https://dns.google/resolve?name=_gh-<org>-o.<domain>&type=TXT`
- Single badge logic:
  - **Verified** only if all discovered domains return at least one TXT record
  - **Unverified** otherwise
- Clicking the badge opens a modal with per-domain results so you can see exactly which domains passed or failed.

### Badge UI

- Hovering the badge changes text to **Learn more**.
- Clicking the badge opens a short, human-readable modal with details.
- Modal contains a **Learn more** link that opens in a new tab.

## Install (Unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Example

- Bluesky:
  - For `https://bsky.app/profile/bskyakhargha1.help`, extension checks `_atproto.bskyakhargha1.help` and verifies if any TXT record includes `did=`.
- GitHub:
  - For org `adobe` with domain `adobe.com`, extension checks `_gh-adobe-o.adobe.com`.
  - If multiple domains are discovered for the org, all are checked and summarized in one badge, with per-domain details in the modal.
