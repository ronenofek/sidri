# Sidri Setup Guide

Complete setup from zero to a working WhatsApp list manager. Takes about 30 minutes.

---

## What You'll Need

- A Cloudflare account (free)
- An Anthropic account with API access
- A Twilio account (free trial works)
- A Google account

---

## Step 1 — Google Service Account + Spreadsheet

### 1a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (name it anything, e.g. "Sidri")
3. In the left menu: **APIs & Services → Enable APIs**
4. Search for **Google Sheets API** and enable it

### 1b. Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Name it (e.g. "sidri-agent"), click through to finish
4. Click the service account you just created
5. Go to the **Keys** tab → **Add Key → Create new key → JSON**
6. Download the JSON file — you'll need `client_email` and `private_key` from it

> The `private_key` field in the JSON looks like:
> `"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"`
> This is PKCS#8 format — exactly what the Worker expects.

### 1c. Create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a blank spreadsheet
2. Name it "Sidri Lists" (or anything)
3. Share it with your service account email (the `client_email` from the JSON file) — give it **Editor** access
4. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_IS_HERE/edit`

---

## Step 2 — Anthropic Managed Agent

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Navigate to **Agents** and create a new agent
3. Set the system prompt (see below)
4. Copy the **Agent ID** (starts with `agent_`) and **Environment ID** (starts with `env_`)

### System Prompt

After you deploy the Worker (Step 5) and get your Worker URL, paste this into Claude Console. Replace `YOUR_WORKER_URL` and `YOUR_LISTS_SECRET` with your actual values.

```
You are Sidri — a shared list manager who lives in WhatsApp.
Sidri means my organizer in Hebrew.

You manage named lists for a group. Anyone in the group can add or remove items
from any list. Every message arrives prefixed with [From Name]: so you always
know who is writing.

Lists live in Google Sheets. Read and write them via the Worker endpoint.

Read current lists:
python3 -c "import urllib.request,json; req=urllib.request.Request('YOUR_WORKER_URL/lists',headers={'X-Lists-Token':'YOUR_LISTS_SECRET','User-Agent':'sidri'}); print(urllib.request.urlopen(req).read().decode())"

Write updated lists:
python3 -c "import urllib.request,json; data=json.dumps({'lists':LISTS_JSON,'callerName':'CALLER_NAME'}).encode(); req=urllib.request.Request('YOUR_WORKER_URL/lists',data=data,method='PATCH',headers={'X-Lists-Token':'YOUR_LISTS_SECRET','Content-Type':'application/json','User-Agent':'sidri'}); urllib.request.urlopen(req)"

Rules:
Always load current lists before answering any list question.
After any change: read current lists first, apply the change, write the full updated JSON back.
Confirm every action in one sentence. Examples: Added eggs to grocery. Removed milk from Costco.
Show a list as one item per line, clean. No bullet points, no hyphens as pauses, no em dashes.
Short responses. Match the energy of the person writing.
If a list does not exist yet, create it on first add.
Use the name from the [From Name]: prefix when confirming actions.
```

---

## Step 3 — Twilio WhatsApp Sandbox

1. Go to [twilio.com/console](https://twilio.com/console)
2. Navigate to **Messaging → Try it out → Send a WhatsApp message**
3. Follow the instructions to join the sandbox (send a join code from your phone)
4. Set the **When a message comes in** webhook URL to your Worker URL (set this after Step 5)
5. Note your Twilio WhatsApp number (e.g. `+14155238886`) and save your Account SID + Auth Token

---

## Step 4 — Cloudflare Setup

### Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### Create KV namespace

```bash
cd worker
npx wrangler kv namespace create SESSIONS
```

Copy the `id` from the output and paste it into `wrangler.toml` under `kv_namespaces`.

### Fill in wrangler.toml

Open `worker/wrangler.toml` and replace all placeholder values:

```toml
AGENT_ID               = "agent_xxxx"         # from Claude Console
ENVIRONMENT_ID         = "env_xxxx"            # from Claude Console
TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886"
GOOGLE_SPREADSHEET_ID  = "1BxiMVs0..."         # from your Sheet URL
USER_MAP               = "+19173024263:Ronen"   # your WhatsApp number and name
```

---

## Step 5 — Set Secrets

Run each of these and paste the value when prompted:

```bash
cd worker

npx wrangler secret put ANTHROPIC_API_KEY
# → paste your Anthropic API key

npx wrangler secret put TWILIO_ACCOUNT_SID
# → paste your Twilio Account SID

npx wrangler secret put TWILIO_AUTH_TOKEN
# → paste your Twilio Auth Token

npx wrangler secret put LISTS_SECRET
# → type any random string, e.g.: sidri-lists-2026
#   (you'll use this same value in the system prompt)

npx wrangler secret put GOOGLE_CLIENT_EMAIL
# → paste the client_email from your service account JSON

npx wrangler secret put GOOGLE_PRIVATE_KEY
# → paste the ENTIRE private_key value from the JSON, including
#   "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----"
#   It will have \n characters — paste it exactly as it appears in the JSON
```

---

## Step 6 — Deploy

```bash
cd worker
npm install
npm run deploy
```

Your Worker URL will be printed — something like:
`https://sidri-worker.YOUR-SUBDOMAIN.workers.dev`

---

## Step 7 — Final Wiring

1. **Twilio**: Go back to your sandbox settings and set the webhook URL to your Worker URL
2. **Claude Console**: Update the system prompt — replace `YOUR_WORKER_URL` and `YOUR_LISTS_SECRET` with real values

---

## Step 8 — Verify

### Test the /lists endpoint directly

```bash
# Should return {}
curl -H "X-Lists-Token: YOUR_LISTS_SECRET" \
  https://sidri-worker.YOUR-SUBDOMAIN.workers.dev/lists

# Should create a "grocery" tab in your Sheet with milk and eggs
curl -X PATCH \
  -H "X-Lists-Token: YOUR_LISTS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"lists":{"grocery":["milk","eggs"]},"callerName":"Test"}' \
  https://sidri-worker.YOUR-SUBDOMAIN.workers.dev/lists
```

Open your Google Sheet — you should see a "grocery" tab with the header row and two items.

### Test via WhatsApp

Send from your connected phone:
```
add bread to grocery
```

Expected reply: `Added bread to grocery.`

Check your Sheet — bread should appear in the grocery tab.

---

## Adding More Users

Edit `USER_MAP` in `wrangler.toml` and redeploy:

```toml
USER_MAP = "+19173024263:Ronen,+19171234567:Dana"
```

Each person needs to join the same Twilio sandbox (one-time setup).

---

## Session Reset (if agent gets stuck)

```bash
npx wrangler kv key delete "whatsapp:+YOURNUMBER" --binding SESSIONS --remote
```

---

## Troubleshooting

**Agent doesn't reply**: Check Cloudflare Workers logs (`wrangler tail`) for errors.

**Lists endpoint returns 401**: Wrong `LISTS_SECRET` in the curl command or system prompt.

**Google Sheets error**: Verify the service account email has Editor access on the spreadsheet, and the `GOOGLE_PRIVATE_KEY` was pasted in full.

**JWT error**: Make sure your private key is PKCS#8 format (begins with `-----BEGIN PRIVATE KEY-----`, not `-----BEGIN RSA PRIVATE KEY-----`). If it's the latter, convert with:
```bash
openssl pkcs8 -topk8 -nocrypt -in old_key.pem -out new_key.pem
```
