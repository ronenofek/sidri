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

- `worker/src/index.ts` — full Worker logic (~750 lines)
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
- `USER_MAP` — `"+19173024263:Ronen"` (bootstrap/admin users only — others added via WhatsApp)

## Google Sheets Structure

One tab per list. Columns: A=Item, B=AddedBy, C=Timestamp, D=Status. Row 1 is always the header. New tabs are created automatically on first add to a new list. D="done" means checked off.

## Multi-User Identity

Two-layer user store:
1. `USER_MAP` in wrangler.toml — permanent admin users (e.g. Ronen), never removable via WhatsApp
2. KV key `__usermap__` — dynamic users added via WhatsApp commands

Worker prepends `[From Name]:` to every message before sending to the agent.

### User management commands (WhatsApp)
```
add user +19171234567 as Dana    # add a user
remove user +19171234567         # remove a user
list users                       # show all users
```
Hebrew also supported: `הוסף משתמש +972... בתור דנה`
Only existing known users can run these commands.

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

### Shipped ✅
- [x] Emoji on grocery items
- [x] "Show all lists" summary — all list names + item counts
- [x] Check-off mode — `d=true/false` in ListItem, Status column D in Sheets
- [x] "Clear checked" text command
- [x] Multilingual (Hebrew/English) — responds in caller's language
- [x] List name translation (קוסטקו → costco, מכולת → grocery, etc.)
- [x] Image-to-list — send a photo of a handwritten list, agent extracts items
- [x] User management via WhatsApp — add/remove users without touching wrangler.toml

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
- [ ] WhatsApp button for "Remove checked" — after moving to WhatsApp Business API
- [ ] Shareable read-only link — public URL showing live lists from Sheet
- [ ] Per-user private lists — some lists shared, some personal
- [ ] Landing page — public page for the project

### v6 — Open source / sharing (if going Plan A)
- [ ] Anonymous usage analytics — each deployment phones home once/day (deployment ID + user count + active flag, no personal data). Opt-out via wrangler.toml flag. Signal for when/whether to go SaaS.
- [ ] Tiny central analytics Worker — collects pings, Ronen queries aggregate stats
- [ ] Improve SETUP_GUIDE.md for non-technical users — screenshots, time estimates per step, better troubleshooting
- [ ] SaaS upgrade path (Option B) — if analytics show 15+ deployments / 50+ users, revisit multi-tenant + WhatsApp Business API

## Related Project

Anabel (personal AI second brain): `C:\Users\ronen\OneDrive\Mine\Anabel- Second Brain Agent\`
