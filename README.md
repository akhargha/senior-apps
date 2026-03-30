# Bluesky Domain Verification Extension

Chrome extension that verifies Bluesky domain handles by querying TXT records on `_atproto.<domain>` and checking for `did=`.

## Behavior

- Runs on `https://bsky.app/*`
- Detects profile domain from URL pattern: `/profile/<domain>`
- Queries `https://dns.google/resolve?name=_atproto.<domain>&type=TXT`
- If any TXT answer contains `did=`, shows a **Verified** badge
- Otherwise shows an **Unverified** badge
- Badge is only shown when the profile segment looks like a real domain (e.g. contains dots like `example.com`). If it does not, no badge is displayed.

Hovering the badge shows “Learn more”. Clicking the badge opens a short, human-readable explanation with a **Learn more** link (opens in a new tab).

## Install (Unpacked)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Example

For `https://bsky.app/profile/bskyakhargha1.help`, extension checks TXT records of `_atproto.bskyakhargha1.help` and verifies if a `did=` value exists.
