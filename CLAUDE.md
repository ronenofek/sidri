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

- [ ] Reminders — Cloudflare Cron Trigger, reads "reminders" KV key, sends WhatsApp at scheduled times
- [ ] Completed items — checkbox column in Sheet; "check off eggs" marks done without deleting
- [ ] Multi-list overview — "show all lists" returns all list names + item counts
- [ ] Landing page — public page for the project

## Related Project

Anabel (personal AI second brain): `C:\Users\ronen\OneDrive\Mine\Anabel- Second Brain Agent\`
