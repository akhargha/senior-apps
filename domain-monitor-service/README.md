# Domain Monitor Service (local prototype)

This is a small local service that lets a user sign up to “monitor” a domain.
For now it stores the signup in a local JSON-backed table and (for the personal-email flow) verifies a DNS TXT record using a backend DNS lookup.

## What it supports

1. **Domain email flow** (no TXT verification)
   - User provides `domain` and an `email`.
   - If the email's domain matches the provided domain, the signup is saved as `verified`.

2. **Personal email + TXT verification flow**
   - User provides `domain` and a personal `email`.
   - The service generates a random TXT value and asks the user to create:
     - TXT host: `_seniorproject.<domain>`
     - TXT value: `<random token>`
   - When the TXT record matches, the signup is marked `verified`.

## Monitoring frequency

User selects a schedule from **every 6 hours** up to **every 14 days** (1-day increments after 6 hours).
The chosen interval is stored in the database as `monitoring_interval_seconds` (monitoring frequency).

DNS/domain re-verification is scheduled daily per the initial prototype requirements (`next_check_at`).

## Run it

From `domain-monitor-service/`:

```bash
npm install
npm start
```

Then open:
- `http://localhost:3000/`

## Local storage

Local “table” (JSON file):
- `domain-monitor-service/data/monitors.json`

## Endpoints

- `POST /api/signup`
  - Creates a signup record (pending or verified).
- `POST /api/verify-txt`
  - Checks DNS TXT for `_seniorproject.<domain>` and updates the record if it matches.
- `GET /api/monitors`
  - Debug endpoint that lists saved monitor rows.

