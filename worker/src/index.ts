/**
 * Sidri — Cloudflare Worker bridge
 * Twilio WhatsApp  ↔  Anthropic Managed Agents  ↔  Google Sheets
 *
 * Sidri (סדרי) = "my organizer" in Hebrew.
 * A shared list manager for households and groups.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

// List item with optional check-off status
// { i: "eggs", d: false } = active   { i: "eggs", d: true } = checked off
export type ListItem = { i: string; d: boolean };

export interface Env {
  SESSIONS: KVNamespace;             // phone → session_id
  ANTHROPIC_API_KEY: string;
  AGENT_ID: string;
  ENVIRONMENT_ID: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_WHATSAPP_NUMBER: string;    // e.g. whatsapp:+14155238886
  LISTS_SECRET: string;              // shared secret for X-Lists-Token header
  GOOGLE_CLIENT_EMAIL: string;       // service account email
  GOOGLE_PRIVATE_KEY: string;        // PEM private key (PKCS#8)
  GOOGLE_SPREADSHEET_ID: string;     // spreadsheet ID from URL
  USER_MAP: string;                  // "+phone:Name,+phone:Name"
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const BETA_HEADER = "managed-agents-2026-04-01";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// ── General helpers ───────────────────────────────────────────────────────────

function chunks(text: string, size: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < Math.max(text.length, 1); i += size) {
    result.push(text.slice(i, i + size));
  }
  return result;
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": BETA_HEADER,
    "content-type": "application/json",
  };
}

// ── User identity ─────────────────────────────────────────────────────────────
// Two-layer user store:
//   1. wrangler.toml USER_MAP  — bootstrap/admin users, always present, never removable
//   2. KV key "__usermap__"    — dynamic users added via WhatsApp
//
// Twilio sends phone as "whatsapp:+19173024263" — strip prefix before lookup.

const USERMAP_KEY = "__usermap__";

/** Parse the wrangler.toml USER_MAP env var into a phone→name map. */
function parseEnvUserMap(userMap: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!userMap) return result;
  for (const entry of userMap.split(",")) {
    const colonIdx = entry.indexOf(":");
    if (colonIdx === -1) continue;
    const num = entry.slice(0, colonIdx).trim();
    const name = entry.slice(colonIdx + 1).trim();
    if (num && name) result[num] = name;
  }
  return result;
}

/** Read merged user map: env-var base + KV dynamic users. */
async function getUserMap(env: Env): Promise<Record<string, string>> {
  const base = parseEnvUserMap(env.USER_MAP);
  const raw = await env.SESSIONS.get(USERMAP_KEY);
  if (raw) {
    try {
      const kvMap = JSON.parse(raw) as Record<string, string>;
      // KV entries augment the base; env-var users always present
      return { ...kvMap, ...base };
    } catch {
      // ignore corrupt KV data
    }
  }
  return base;
}

/** Persist dynamic (non-env-var) users back to KV. */
async function saveUserMap(env: Env, map: Record<string, string>): Promise<void> {
  const base = parseEnvUserMap(env.USER_MAP);
  // Only store entries that aren't already covered by the env-var map
  const toSave: Record<string, string> = {};
  for (const [phone, name] of Object.entries(map)) {
    if (!(phone in base)) toSave[phone] = name;
  }
  await env.SESSIONS.put(USERMAP_KEY, JSON.stringify(toSave));
}

/** Look up a display name for an incoming Twilio phone string. */
async function getUserName(phone: string, env: Env): Promise<string> {
  const barePhone = phone.replace("whatsapp:", "");
  const map = await getUserMap(env);
  return map[barePhone] ?? `Unknown (${barePhone})`;
}

// ── User management commands ──────────────────────────────────────────────────
// Handled at Worker level — fast, no agent round-trip.
// Only recognised users can run these commands.
//
// Commands:
//   add user +19171234567 as Dana   (English)
//   הוסף משתמש +972... בתור דנה    (Hebrew)
//   remove user +19171234567
//   הסר משתמש +972...
//   list users / משתמשים

async function handleUserCommand(
  from: string,
  body: string,
  env: Env
): Promise<string | null> {
  const barePhone = from.replace("whatsapp:", "");
  const map = await getUserMap(env);

  // Only existing known users may manage users
  if (!(barePhone in map)) return null;

  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();

  // list users
  if (lower === "list users" || lower === "רשימת משתמשים" || lower === "משתמשים") {
    const lines = Object.entries(map).map(([p, n]) => `${n} (${p})`);
    return lines.length ? lines.join("\n") : "No users registered.";
  }

  // add user +X as Name  /  הוסף משתמש +X בתור Name
  const addMatch =
    trimmed.match(/^add user\s+(\+[\d]+)\s+as\s+(.+)$/i) ??
    trimmed.match(/^הוסף משתמש\s+(\+[\d]+)\s+בתור\s+(.+)$/i);
  if (addMatch) {
    const phone = addMatch[1].trim();
    const name = addMatch[2].trim();
    map[phone] = name;
    await saveUserMap(env, map);
    return `✓ Added ${name} (${phone})`;
  }

  // remove user +X  /  הסר משתמש +X
  const removeMatch =
    trimmed.match(/^remove user\s+(\+[\d]+)$/i) ??
    trimmed.match(/^הסר משתמש\s+(\+[\d]+)$/i);
  if (removeMatch) {
    const phone = removeMatch[1].trim();
    const base = parseEnvUserMap(env.USER_MAP);
    if (phone in base) return `Can't remove ${base[phone]} — they're a permanent admin.`;
    const name = map[phone];
    if (!name) return `${phone} is not in the user list.`;
    delete map[phone];
    await saveUserMap(env, map);
    return `✓ Removed ${name} (${phone})`;
  }

  return null; // not a user management command
}

// ── Anthropic session management ──────────────────────────────────────────────

async function createSession(env: Env): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE}/sessions`, {
    method: "POST",
    headers: anthropicHeaders(env.ANTHROPIC_API_KEY),
    body: JSON.stringify({
      agent: env.AGENT_ID,
      environment_id: env.ENVIRONMENT_ID,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function getOrCreateSession(phone: string, env: Env): Promise<string> {
  const existing = await env.SESSIONS.get(phone);
  if (existing) return existing;
  const sessionId = await createSession(env);
  await env.SESSIONS.put(phone, sessionId);
  return sessionId;
}

async function resetSession(phone: string, env: Env): Promise<string> {
  const sessionId = await createSession(env);
  await env.SESSIONS.put(phone, sessionId);
  return sessionId;
}

// ── Core agent call (POST + poll) ─────────────────────────────────────────────
// The Managed Agents API is JSON REST, not SSE.
// Pattern: POST user message → poll GET events until agent reply appears.

type AgentEvent = {
  id: string;
  type: string;
  content?: Array<{ type: string; text: string }>;
};

async function getAgentResponse(
  sessionId: string,
  message: string,
  env: Env,
  image?: { base64: string; mediaType: string }
): Promise<string> {
  // Build content array: optional image block + text block
  const content: unknown[] = [
    ...(image
      ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }]
      : []),
    { type: "text", text: message },
  ];

  // 1. Send the user message
  const sendRes = await fetch(`${ANTHROPIC_BASE}/sessions/${sessionId}/events`, {
    method: "POST",
    headers: anthropicHeaders(env.ANTHROPIC_API_KEY),
    body: JSON.stringify({
      events: [{ type: "user.message", content }],
    }),
  });

  if (!sendRes.ok) {
    const text = await sendRes.text();
    throw new Error(`Send failed: ${sendRes.status} ${text}`);
  }

  // Grab the user event ID to use as a cursor
  const sendData = (await sendRes.json()) as { data: AgentEvent[] };
  const userEventId = sendData.data?.slice(-1)?.[0]?.id ?? null;

  // 2. Poll GET until we see new events after the user message
  const parts: string[] = [];
  const seenIds = new Set<string>();
  let emptyPolls = 0;

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));

    const eventsRes = await fetch(`${ANTHROPIC_BASE}/sessions/${sessionId}/events`, {
      method: "GET",
      headers: anthropicHeaders(env.ANTHROPIC_API_KEY),
    });

    if (!eventsRes.ok) continue;

    const eventsData = (await eventsRes.json()) as { data: AgentEvent[] };
    const allEvents = eventsData.data ?? [];

    const cursorIndex = userEventId
      ? allEvents.findIndex((e) => e.id === userEventId)
      : -1;

    if (userEventId && cursorIndex === -1) continue;

    const newEvents = allEvents
      .slice(cursorIndex + 1)
      .filter((e) => !seenIds.has(e.id));

    if (newEvents.length === 0) {
      if (++emptyPolls >= 2 && parts.length > 0) return parts.join("");
      continue;
    }

    emptyPolls = 0;
    let isIdle = false;

    for (const event of newEvents) {
      seenIds.add(event.id);
      if (event.type === "agent.message") {
        for (const block of event.content ?? []) {
          if (block.type === "text") parts.push(block.text);
        }
      } else if (event.type === "session.status_idle") {
        isIdle = true;
      } else if (event.type === "session.error") {
        throw new Error(`Agent error in event: ${event.id}`);
      }
    }

    if (isIdle && parts.length > 0) return parts.join("\n\n");
  }

  return parts.join("\n\n") || "Sorry, timed out waiting for a response.";
}

// ── Twilio media download ─────────────────────────────────────────────────────
// Twilio-hosted media requires Basic auth (Account SID + Auth Token).
// Returns base64-encoded image data + MIME type.

async function downloadTwilioMedia(
  mediaUrl: string,
  env: Env
): Promise<{ base64: string; mediaType: string }> {
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  const mediaType = res.headers.get("Content-Type") ?? "image/jpeg";
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mediaType };
}

// ── Twilio outbound ───────────────────────────────────────────────────────────

async function sendWhatsApp(to: string, body: string, env: Env): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  for (const chunk of chunks(body, 1600)) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: env.TWILIO_WHATSAPP_NUMBER,
        To: to,
        Body: chunk,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Twilio error ${res.status}: ${text}`);
    }
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleWhatsApp(
  from: string,
  body: string,
  env: Env,
  image?: { base64: string; mediaType: string }
): Promise<void> {
  // Inject caller name so the agent knows who is writing
  const callerName = await getUserName(from, env);
  const taggedMessage = `[From ${callerName}]: ${body}`;

  try {
    let sessionId = await getOrCreateSession(from, env);
    let reply: string;

    try {
      reply = await getAgentResponse(sessionId, taggedMessage, env, image);
    } catch (err) {
      // Session likely expired — recreate and retry once
      console.error(`Session error for ${from}, resetting...`, err);
      sessionId = await resetSession(from, env);
      reply = await getAgentResponse(sessionId, taggedMessage, env, image);
    }

    await sendWhatsApp(from, reply, env);
  } catch (err) {
    console.error(`Failed to handle message from ${from}:`, err);
    try {
      await sendWhatsApp(from, "Something went wrong. Try again in a moment.", env);
    } catch {
      // swallow
    }
  }
}

// ── Google Sheets: base64 helpers ─────────────────────────────────────────────

function base64urlEncodeBuffer(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncode(str: string): string {
  return base64urlEncodeBuffer(new TextEncoder().encode(str));
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Google Sheets: JWT auth ───────────────────────────────────────────────────
// Uses WebCrypto (native in Workers) — no external packages needed.
// Google service account keys downloaded today are PKCS#8 (BEGIN PRIVATE KEY).

async function getGoogleAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string> {
  // Normalise escaped newlines — Wrangler secrets may store \n as two chars
  const pem = privateKey.replace(/\\n/g, "\n");

  // Strip PEM headers and whitespace, decode base64 to DER
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const keyData = base64ToArrayBuffer(b64);

  // Import PKCS#8 key for RS256 signing
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Build and sign the JWT
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64urlEncodeBuffer(signatureBuffer)}`;

  // Exchange JWT for a Google access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`OAuth2 token exchange failed: ${tokenRes.status} ${err}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}

// ── Google Sheets: data layer ─────────────────────────────────────────────────

// A1 range for full sheet (columns A–D). Titles with spaces must be quoted.
function sheetRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'!A:D`;
}

interface SheetMeta {
  properties: { title: string; sheetId: number };
  data?: Array<{
    rowData?: Array<{
      values?: Array<{ formattedValue?: string }>;
    }>;
  }>;
}

interface SpreadsheetResponse {
  sheets?: SheetMeta[];
}

// Read all lists: returns { listName: [{i: "milk", d: false}, ...] }
// d=false = active, d=true = checked off (col D = "done")
async function readSheets(
  spreadsheetId: string,
  accessToken: string
): Promise<Record<string, ListItem[]>> {
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}?includeGridData=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Sheets read failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as SpreadsheetResponse;
  const result: Record<string, ListItem[]> = {};

  for (const sheet of data.sheets ?? []) {
    const name = sheet.properties.title;
    const rows = sheet.data?.[0]?.rowData ?? [];
    const items: ListItem[] = [];

    // Row 0 is the header ["Item","AddedBy","Timestamp","Status"] — skip it
    for (let r = 1; r < rows.length; r++) {
      const cellA = rows[r].values?.[0]?.formattedValue ?? "";
      const cellD = rows[r].values?.[3]?.formattedValue ?? "";
      if (cellA.trim()) items.push({ i: cellA.trim(), d: cellD.trim() === "done" });
    }

    result[name] = items;
  }

  return result;
}

// Fetch { sheetTitle: sheetId } — needed for deleteSheet requests
async function fetchSheetIds(
  spreadsheetId: string,
  accessToken: string
): Promise<Record<string, number>> {
  const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`fetchSheetIds failed: ${res.status}`);
  const data = (await res.json()) as SpreadsheetResponse;
  const map: Record<string, number> = {};
  for (const sheet of data.sheets ?? []) {
    map[sheet.properties.title] = sheet.properties.sheetId;
  }
  return map;
}

// Read raw string values for a single sheet (to preserve existing AddedBy/Timestamp)
async function readSheetRawRows(
  spreadsheetId: string,
  sheetTitle: string,
  accessToken: string
): Promise<string[][]> {
  const range = sheetRange(sheetTitle);
  const res = await fetch(
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return []; // sheet may not exist yet — return empty
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

// Write the full lists state to Sheets.
// Diffs against current state: creates/deletes tabs, preserves existing row metadata.
async function writeLists(
  spreadsheetId: string,
  accessToken: string,
  newLists: Record<string, ListItem[]>,
  callerName: string
): Promise<void> {
  const authHeader = { Authorization: `Bearer ${accessToken}` };
  const current = await readSheets(spreadsheetId, accessToken);

  const currentNames = new Set(Object.keys(current));
  const newNames = new Set(Object.keys(newLists));
  const toAdd = [...newNames].filter((n) => !currentNames.has(n));
  const toDelete = [...currentNames].filter((n) => !newNames.has(n));

  // Structural changes: add / delete sheets in one batchUpdate
  if (toAdd.length > 0 || toDelete.length > 0) {
    const sheetIdMap =
      toDelete.length > 0 ? await fetchSheetIds(spreadsheetId, accessToken) : {};

    const requests: unknown[] = [
      ...toAdd.map((title) => ({ addSheet: { properties: { title } } })),
      ...toDelete
        .filter((title) => sheetIdMap[title] !== undefined)
        .map((title) => ({ deleteSheet: { sheetId: sheetIdMap[title] } })),
    ];

    const batchRes = await fetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!batchRes.ok) {
      throw new Error(`batchUpdate failed: ${batchRes.status} ${await batchRes.text()}`);
    }
  }

  // Write data for each list
  const now = new Date().toISOString();
  const HEADER = ["Item", "AddedBy", "Timestamp", "Status"];

  for (const [listName, newItems] of Object.entries(newLists)) {
    // Read existing rows to preserve AddedBy + Timestamp for items that haven't changed
    const existingRows = await readSheetRawRows(spreadsheetId, listName, accessToken);
    const existingRowMap: Record<string, string[]> = {};
    for (let i = 1; i < existingRows.length; i++) {
      const item = existingRows[i][0]?.trim() ?? "";
      if (item) existingRowMap[item] = existingRows[i];
    }

    const dataRows: string[][] = [HEADER];
    for (const listItem of newItems) {
      const { i: itemName, d: isDone } = listItem;
      const status = isDone ? "done" : "";
      if (existingRowMap[itemName]) {
        // Preserve original AddedBy + Timestamp, update Status
        dataRows.push([itemName, existingRowMap[itemName][1] ?? callerName, existingRowMap[itemName][2] ?? now, status]);
      } else {
        // New item — stamp with caller and current time
        dataRows.push([itemName, callerName, now, status]);
      }
    }

    const range = sheetRange(listName);

    // Clear first so shorter lists don't leave stale rows at the bottom
    await fetch(`${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
      method: "POST",
      headers: authHeader,
    });

    const writeRes = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ values: dataRows }),
      }
    );
    if (!writeRes.ok) {
      throw new Error(
        `Values write failed for "${listName}": ${writeRes.status} ${await writeRes.text()}`
      );
    }
  }
}

// ── Lists HTTP handler ────────────────────────────────────────────────────────
// GET  /lists  → { "grocery": [{i:"milk",d:false}, {i:"eggs",d:true}], ... }
// PATCH /lists → body: { lists: {...}, callerName: "Ronen" }

async function handleLists(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("X-Lists-Token") !== env.LISTS_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const accessToken = await getGoogleAccessToken(
      env.GOOGLE_CLIENT_EMAIL,
      env.GOOGLE_PRIVATE_KEY
    );

    if (request.method === "GET") {
      const lists = await readSheets(env.GOOGLE_SPREADSHEET_ID, accessToken);
      return new Response(JSON.stringify(lists), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "PATCH") {
      const body = (await request.json()) as {
        lists: Record<string, ListItem[]>;
        callerName: string;
      };
      if (!body.lists || typeof body.callerName !== "string") {
        return new Response(
          JSON.stringify({ error: "Body must contain lists (object) and callerName (string)" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      await writeLists(env.GOOGLE_SPREADSHEET_ID, accessToken, body.lists, body.callerName);
      return new Response("OK", { status: 200 });
    }

    return new Response("Method Not Allowed", { status: 405 });
  } catch (err) {
    console.error("handleLists error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Worker entry point ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Lists proxy route
    if (url.pathname === "/lists") {
      return handleLists(request, env);
    }

    // Twilio webhook
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const form = await request.formData();
    const from = form.get("From") as string | null;
    const rawBody = form.get("Body") as string | null;
    const body = rawBody?.trim() ?? "";
    const numMedia = parseInt((form.get("NumMedia") as string | null) ?? "0", 10);
    const mediaUrl = form.get("MediaUrl0") as string | null;
    const mediaContentType = form.get("MediaContentType0") as string | null;

    if (from && (body || numMedia > 0)) {
      // Return 200 to Twilio immediately; process in background
      ctx.waitUntil(
        (async () => {
          // User management commands are handled locally — no agent round-trip
          if (body) {
            const userReply = await handleUserCommand(from, body, env);
            if (userReply !== null) {
              await sendWhatsApp(from, userReply, env);
              return;
            }
          }

          let image: { base64: string; mediaType: string } | undefined;
          if (numMedia > 0 && mediaUrl) {
            try {
              image = await downloadTwilioMedia(mediaUrl, env);
              // Use the content type from form data if available (more reliable)
              if (mediaContentType) image.mediaType = mediaContentType;
            } catch (err) {
              console.error("Media download failed:", err);
            }
          }
          await handleWhatsApp(from, body, env, image);
        })()
      );
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { "Content-Type": "text/xml" } }
    );
  },
};
