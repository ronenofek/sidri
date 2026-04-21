# Sidri Setup Guide

Complete setup from zero to a working WhatsApp list manager. Takes about 45 minutes.

---

## What You'll Get

A WhatsApp AI agent for your household or group that:
- Manages named lists (grocery, Costco, books — anything)
- Adds, removes, and checks off items by chat
- Reads photos of handwritten lists and adds the items automatically
- Supports Hebrew and English
- Lets each person have private lists others can't see
- Stores everything in Google Sheets (visible and editable from any browser)
- Lets you add/remove family members via WhatsApp — no code changes needed

---

## What You'll Need

- A **Cloudflare** account (free) — [cloudflare.com](https://cloudflare.com)
- An **Anthropic** account with API access — [console.anthropic.com](https://console.anthropic.com)
- A **Twilio** account (free trial works) — [twilio.com](https://twilio.com)
- A **Google** account

> **Time estimate per step:**
> Step 1 (Google): ~15 min — the most involved step, just follow carefully
> Steps 2–7: ~5 min each

---

## Step 1 — Google Service Account + Spreadsheet (~15 min)

This gives Sidri read/write access to a Google Sheet where your lists live.

### 1a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown (top left) → **New Project**
3. Name it anything (e.g. "Sidri") → **Create**
4. In the left menu: **APIs & Services → Enable APIs & Services**
5. Search for **Google Sheets API** → click it → **Enable**

### 1b. Create a Service Account

1. In the left menu: **APIs & Services → Credentials**
2. Click **+ Create Credentials → Service Account**
3. Name it (e.g. "sidri-agent") → click through all steps → **Done**
4. Click the service account you just created (it appears in the list)
5. Go to the **Keys** tab → **Add Key → Create new key → JSON** → **Create**
6. A JSON file downloads — keep it open, you'll need two values from it:
   - `client_email` — looks like `sidri-agent@your-project.iam.gserviceaccount.com`
   - `private_key` — a long string starting with `-----BEGIN PRIVATE KEY-----`

> **Note:** The `private_key` contains literal `\n` characters in the JSON file.
> Paste it exactly as it appears — the Worker handles the formatting automatically.

### 1c. Create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) → create a blank spreadsheet
2. Name it "Sidri Lists" (or anything you like)
3. Click **Share** → paste the `client_email` from the JSON → give it **Editor** access → **Send**
4. Copy the Spreadsheet ID from the URL bar:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

---

## Step 2 — Anthropic Managed Agent (~5 min)

1. Go to [console.anthropic.com](https://console.anthropic.com) → **Agents** → **Create Agent**
2. Name it "Sidri"
3. Leave the system prompt blank for now — you'll fill it in after Step 6
4. Copy the **Agent ID** (starts with `agent_`) and **Environment ID** (starts with `env_`)

---

## Step 3 — Twilio WhatsApp Sandbox (~5 min)

1. Go to [twilio.com/console](https://twilio.com/console)
2. Navigate to **Messaging → Try it out → Send a WhatsApp message**
3. Follow the on-screen instructions to join the sandbox — you'll send a join code from your phone
4. Note your sandbox WhatsApp number (e.g. `+14155238886`)
5. Save your **Account SID** and **Auth Token** from the Twilio Console home page
6. Leave the webhook URL blank for now — you'll set it after Step 6

> **Sandbox limit:** The free Twilio sandbox allows 50 outbound messages per day.
> This resets at midnight UTC. It's enough for testing and light use.
> Each person who wants to use Sidri must join the sandbox once by sending the join code.

---

## Step 4 — Cloudflare Setup (~5 min)

### Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login
```

### Clone the repo and create the KV namespace

```bash
git clone https://github.com/ronenofek/sidri.git
cd sidri/worker
cp wrangler.toml.example wrangler.toml
npx wrangler kv namespace create SESSIONS
```

> `wrangler.toml` is gitignored — your real values stay on your machine only.
> `wrangler.toml.example` is the template you just copied.

The output will look like:

```
[[kv_namespaces]]
binding = "SESSIONS"
id = "abc123..."
```

Copy the `id` value and paste it into `worker/wrangler.toml` under `kv_namespaces`.

### Fill in wrangler.toml

Open `worker/wrangler.toml` and replace the placeholder values:

```toml
AGENT_ID               = "agent_xxxx"              # from Step 2
ENVIRONMENT_ID         = "env_xxxx"                # from Step 2
TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886"   # your Twilio sandbox number
GOOGLE_SPREADSHEET_ID  = "1BxiMVs0..."             # from Step 1c
USER_MAP               = "+19173024263:YourName"   # your WhatsApp number and first name
```

> **USER_MAP** is just for your account — the first admin user. Additional family members
> are added later via WhatsApp without touching this file.

---

## Step 5 — Set Secrets (~5 min)

Run each command and paste the value when prompted:

```bash
cd worker

npx wrangler secret put ANTHROPIC_API_KEY
# → your Anthropic API key (from console.anthropic.com → API Keys)

npx wrangler secret put TWILIO_ACCOUNT_SID
# → your Twilio Account SID

npx wrangler secret put TWILIO_AUTH_TOKEN
# → your Twilio Auth Token

npx wrangler secret put LISTS_SECRET
# → invent any random string, e.g.: sidri-lists-2026
#   write it down — you'll use it in the system prompt

npx wrangler secret put GOOGLE_CLIENT_EMAIL
# → the client_email value from the service account JSON (Step 1b)

npx wrangler secret put GOOGLE_PRIVATE_KEY
# → the entire private_key value from the JSON, including the
#   "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----" lines
#   Paste it exactly as it appears in the JSON file (with the \n characters)
```

---

## Step 6 — Deploy (~2 min)

```bash
cd worker
npm install
npm run deploy
```

Your Worker URL will be printed:
`https://sidri-worker.YOUR-SUBDOMAIN.workers.dev`

Write this down — you need it for the next step.

---

## Step 7 — Final Wiring (~5 min)

### Wire up Twilio

1. Go back to your Twilio sandbox settings (**Messaging → Try it out → Send a WhatsApp message**)
2. Under **"When a message comes in"**, paste your Worker URL exactly as printed by wrangler:
   `https://sidri-worker.YOUR-SUBDOMAIN.workers.dev`
   (no path, no trailing slash — just the root URL)
3. Make sure the method is set to **HTTP POST**
4. Click **Save**

### Set the system prompt in Claude Console

Go to your Sidri agent in [console.anthropic.com](https://console.anthropic.com) and paste this as the system prompt.
Replace `YOUR_WORKER_URL` and `YOUR_LISTS_SECRET` with your actual values.

```yaml
system: |
  You are Sidri — a shared list manager who lives in WhatsApp.
  Sidri (סדרי) means "my organizer" in Hebrew.

  You manage named lists for a household or group. Anyone in the group can add,
  remove, or check off items on any list. Every message arrives prefixed with
  [From Name]: so you always know who is writing. Respond in the same language
  the person used — Hebrew or English.

  Lists live in Google Sheets. Read and write them via the Worker endpoint.

  Read current lists (always pass caller name):
  python3 -c "import urllib.request,json; req=urllib.request.Request('YOUR_WORKER_URL/lists?caller=CALLER_NAME',headers={'X-Lists-Token':'YOUR_LISTS_SECRET','User-Agent':'sidri'}); print(urllib.request.urlopen(req).read().decode())"

  Write updated lists:
  python3 -c "import urllib.request,json; data=json.dumps({'lists':LISTS_JSON,'callerName':'CALLER_NAME'}).encode(); req=urllib.request.Request('YOUR_WORKER_URL/lists',data=data,method='PATCH',headers={'X-Lists-Token':'YOUR_LISTS_SECRET','Content-Type':'application/json','User-Agent':'sidri'}); urllib.request.urlopen(req)"

  LIST FORMAT
  Each list is an array of objects: [{"i": "milk", "d": false}, {"i": "eggs", "d": true}]
    i = item name
    d = done/checked-off (false = active, true = checked off)

  RULES

  Always load current lists before answering any list question.
  After any change: read current lists first, apply the change, write the full updated JSON back.
  If a list does not exist yet, create it on first add.
  Use the name from the [From Name]: prefix when confirming actions.
  Short responses. Match the energy of the person writing.

  DISPLAYING LISTS
  Show active items first (d=false), then checked-off items (d=true).
  Active items: one per line, no bullet, no dash.
  Checked-off items: prefix with a checkmark.
  Add a relevant emoji before each item where it makes sense (🥛 milk, 🥚 eggs, 🧴 shampoo, etc.).
  Confirm every action in one sentence. Example: Added 🥛 milk to grocery.

  LIST NAME TRANSLATION
  List names in the Sheet are stored in English lowercase (grocery, costco, etc.).
  When a user refers to a list in Hebrew, translate to the correct English tab name:
    מכולת / מכולות → grocery
    קוסטקו → costco
    בית → home
    תרופות → pharmacy
    ספרים → books
  If unsure which tab the user means, load all lists and match by closest meaning.

  CHECK-OFF MODE
  "check off eggs" or "סמן ביצים" → set d=true for that item, keep it in the list.
  "uncheck eggs" → set d=false.
  "clear checked from grocery" or "מחק מסומנים" → remove all items where d=true from that list.

  SHOW ALL LISTS
  "show all lists" or "מה יש לנו" → load lists, reply with each list name and count of active items.
  Example:
    🛒 grocery — 5 items
    🏪 costco — 3 items
    🔒 wishlist — 2 items (private)

  PRIVATE LISTS
  Private lists belong to one person and are invisible to others.
  Storage name: @CallerName:listname (e.g. @Ronen:wishlist)
  When reading lists, always pass ?caller=CallerName in the URL so private lists load correctly.
  When displaying a private list, strip the @Name: prefix and show a 🔒 icon.
  "create private list X" / "צור רשימה פרטית X" → create a list named @CallerName:X
  "show my private lists" / "הצג רשימות פרטיות" → show only lists starting with @CallerName:
  "show all lists" → show shared lists + caller's own private lists only, never others'
  Private lists behave identically to shared lists for add/remove/check-off.

  IMAGES
  When you receive an image, carefully read all visible text, including Hebrew handwriting.
  If the user's caption tells you which list to add to, extract all items from the image
  and add them all in one shot, then confirm with the full list of what you extracted.
  If no list is specified, ask which list to add the items to.
  If you misread an item, the user will correct you — just fix it and update the list.
```

---

## Step 8 — Verify

### Test the /lists endpoint

```bash
# Should return {} (or your existing lists if any)
curl -H "X-Lists-Token: YOUR_LISTS_SECRET" https://sidri-worker.YOUR-SUBDOMAIN.workers.dev/lists
```

On Windows PowerShell:
```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri "https://sidri-worker.YOUR-SUBDOMAIN.workers.dev/lists" `
  -Headers @{"X-Lists-Token"="YOUR_LISTS_SECRET"}
```

### Test via WhatsApp

Send from your connected phone:
```
add bread to grocery
```

Expected reply: `Added 🍞 bread to grocery.`

Check your Google Sheet — a "grocery" tab should appear with bread in it.

---

## Using Sidri — Quick Reference

### Lists
```
add milk to grocery
remove eggs from grocery
show grocery
show all lists
```

### Check-off
```
check off milk
uncheck milk
clear checked from grocery
```

### Private lists
```
create private list wishlist
add flowers to my wishlist
show my private lists
```

### Images
Send a photo of a handwritten list with the caption:
```
add to grocery
```
Sidri reads the image and adds all items.

### Hebrew examples
```
הוסף חלב למכולת
סמן ביצים
צור רשימה פרטית מתנות
```

---

## Adding Users

You don't need to edit any files. Just send from WhatsApp:

```
add user +19171234567 as Dana
```

Dana then needs to join the Twilio sandbox once (send the sandbox join code from her phone).

Other user management commands:
```
list users
remove user +19171234567
```

Hebrew: `הוסף משתמש +972... בתור דנה`

> Only existing registered users can add or remove others.
> Your own number (from `USER_MAP` in wrangler.toml) is a permanent admin.

---

## Session Reset

If the agent gets stuck or stops responding after a system prompt change:

```bash
npx wrangler kv key delete "whatsapp:+YOURNUMBER" --binding SESSIONS --remote
```

This forces a fresh session on the next message.

---

## Troubleshooting

**No reply from agent**
Run `npx wrangler tail` in the worker directory while sending a WhatsApp message.
The logs will show exactly what's happening.

**Twilio error 63038 — daily limit exceeded**
The sandbox allows 50 outbound messages per day. Resets at midnight UTC. Wait until tomorrow.

**Lists endpoint returns 401**
The `LISTS_SECRET` in your curl command doesn't match what's stored as a secret.
Re-run `npx wrangler secret put LISTS_SECRET` and update the system prompt.

**Google Sheets error**
- Verify the service account email has **Editor** access on the spreadsheet
- Verify `GOOGLE_PRIVATE_KEY` was pasted in full (including the BEGIN/END lines)

**JWT error — wrong key format**
The private key must be PKCS#8 format (begins with `-----BEGIN PRIVATE KEY-----`).
If yours starts with `-----BEGIN RSA PRIVATE KEY-----`, convert it:
```bash
openssl pkcs8 -topk8 -nocrypt -in old_key.pem -out new_key.pem
```

**Agent replies but ignores private list commands**
Reset your session (see above) — the agent picked up a new system prompt on your next message.
