# Sidri — WhatsApp List Manager

> סדרי — "my organizer" in Hebrew

A shared list manager that lives in WhatsApp. Add and remove items from any named list — grocery, Costco, books, or anything you want. Multiple people can share access. Lists sync to Google Sheets in real time.

```
You: add eggs to grocery
Sidri: Added eggs to grocery.

You: what's on the Costco list?
Sidri: olive oil
       paper towels
       laundry pods

You: remove paper towels from Costco
Sidri: Removed paper towels from Costco.
```

## Architecture

```
WhatsApp → Twilio → Cloudflare Worker → Anthropic Managed Agent → Twilio → WhatsApp
                           ↓↑
                    Google Sheets API
```

The Cloudflare Worker bridges Twilio and Anthropic's Managed Agents API. Lists are stored in Google Sheets — one tab per list, with AddedBy and Timestamp columns.

## Stack

- **Cloudflare Workers** — serverless bridge, zero cold starts
- **Anthropic Managed Agents API** — the brain
- **Twilio** — WhatsApp sandbox / production
- **Google Sheets** — persistent shared list storage

## Setup

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for full step-by-step instructions.

Quick overview:
1. Create a Google Service Account + Sheets spreadsheet
2. Create an Anthropic Managed Agent in Claude Console
3. Configure a Twilio WhatsApp sandbox
4. Create a Cloudflare KV namespace
5. Set Wrangler secrets
6. `npm run deploy` from `worker/`

## License

MIT
