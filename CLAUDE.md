# Sidri — Project Context

**Sidri** (סדרי) means "my organizer" in Hebrew. It's a WhatsApp AI agent that manages shared lists for households and groups — grocery lists, Costco runs, book lists, anything. Built on the same architecture as Anabel.

## Architecture

```
WhatsApp → Twilio → Cloudflare Worker → Anthropic Managed Agent → Twilio → WhatsApp
                           ↓↑
                    Google Sheets API
                  (Service Account JWT)
```

## Key Files

- `worker/src/index.ts` — full Worker logic (~390 lines)
- `worker/wrangler.toml` — config: KV binding, vars, secrets list
- `worker/package.json` — devDependencies only (wrangler, TypeScript)

## Worker Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | POST | Twilio webhook — receives WhatsApp messages |
| `/lists` | GET | Agent reads current lists as JSON |
| `/lists` | PATCH | Agent writes updated lists |

## Secrets (set via `npx wrangler secret put`)

- `ANTHROPIC_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `LISTS_SECRET` — shared token for X-Lists-Token header (e.g. `sidri-lists-2026`)
- `GOOGLE_CLIENT_EMAIL` — service account email
- `GOOGLE_PRIVATE_KEY` — full PEM private key (PKCS#8, BEGIN PRIVATE KEY)

## Wrangler Vars (in wrangler.toml, not secrets)

- `AGENT_ID` — from Claude Console
- `ENVIRONMENT_ID` — from Claude Console
- `TWILIO_WHATSAPP_NUMBER` — e.g. `whatsapp:+14155238886`
- `GOOGLE_SPREADSHEET_ID` — from Google Sheets URL
- `USER_MAP` — `"+19173024263:Ronen,+19171234567:Dana"` (add users here)

## Google Sheets Structure

One tab per list. Columns: A=Item, B=AddedBy, C=Timestamp. Row 1 is always the header. New tabs are created automatically on first add to a new list.

## Multi-User Identity

Worker parses `USER_MAP` and prepends `[From Name]:` to every message before sending to the agent. The agent sees who is writing on every message.

## Session Reset (if agent gets stuck)

```bash
npx wrangler kv key delete "whatsapp:+PHONENUMBER" --binding SESSIONS --remote
```

## Worker URL

After deploy: `https://sidri-worker.SUBDOMAIN.workers.dev`

## Deploy

```bash
cd worker
npm install
npx wrangler kv namespace create SESSIONS   # first time only — copy ID to wrangler.toml
npm run deploy
```

## Open TODOs

### Quick wins (system prompt only)
- [x] Emoji on grocery items — auto-add relevant emoji to recognized items
- [x] "Show all lists" summary — all list names + item counts in one message

### v2 — Check-off mode (Easy, ~1 hour)
- [ ] Add status column to Sheets; "check off eggs" marks done without deleting
- [ ] "Clear checked from [list]" text command — removes all checked items
- [ ] WhatsApp button for "Remove checked" — polish step, after moving to WhatsApp Business API

### v3 — Reminders (Medium, ~3 hours)
- [ ] Cloudflare Cron Trigger — checks KV every minute, fires WhatsApp messages when due
- [ ] Store reminders as JSON in KV: {id, text, who, due}
- [ ] "Remind me Friday at 9am to buy flowers" → stored in KV
- [ ] "Show my reminders" → lists upcoming reminders
- [ ] Recurring items — "add milk to grocery every week"

### v4 — Calendar layer (Hard, ~1 day, builds on v3)
- [ ] Google Calendar integration — Sidri creates real calendar events alongside KV reminders
- [ ] Shared calendar — both users see events in phone calendar app

### v5 — Polish & scale
- [ ] User management via WhatsApp — "add +number as Name" without touching wrangler.toml
- [ ] Shareable read-only link — public URL showing live lists from Sheet
- [ ] Per-user private lists — some lists shared, some personal
- [ ] Landing page — public page for the project

## Related Project

Anabel (personal AI second brain): `C:\Users\ronen\OneDrive\Mine\Anabel- Second Brain Agent\`
