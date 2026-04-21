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

**Fastest way:** Clone the repo, open it in [Claude Code](https://claude.ai/code), and type `/setup`.
Claude Code will run all terminal commands automatically and guide you through the browser steps.

**Using Claude.ai instead?** Open [SETUP_PROMPT.md](./SETUP_PROMPT.md), paste its contents into any Claude chat, and follow the guided wizard.

**Manual setup:** See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for full step-by-step instructions.

What the wizard automates (you just paste values when asked):
- `wrangler login`, KV namespace creation, filling `wrangler.toml`, all 6 secrets, deploy, verification

What requires a browser (~20 min total):
1. **Google Cloud** — create service account, enable Sheets API, create spreadsheet (~10 min)
2. **Anthropic Console** — create a blank Managed Agent, copy Agent ID + Environment ID (~2 min)
3. **Twilio** — join the WhatsApp sandbox from your phone, copy SID + token (~5 min)
4. **Post-deploy** — set Twilio webhook URL, paste system prompt into the agent (~3 min)

## License

MIT
