// Runs automatically after every verified Netlify Forms submission (spam is filtered out first).
// For the "easier-if-worksheet" form it creates or updates the person in ActiveCampaign,
// stores their answers in custom fields, subscribes them to the workshop list, and adds the
// "Workshop: Easier If" tag. That tag starts the ActiveCampaign automation that emails
// them their answers.
//
// Needs two environment variables, set in the Netlify UI (scope: Functions):
//   AC_API_URL  e.g. https://youraccount.api-us1.com   (ActiveCampaign > Settings > Developer)
//   AC_API_KEY  the API key from the same page
// Nothing here ever prints or returns the key.

const FORM_NAME = "easier-if-worksheet";
const WORKSHOP_LIST = "Easier If Workshop";
const NEWSLETTER_LIST = "Monthly Newsletter";
const WORKSHOP_TAG = "Workshop: Easier If";
const MAX_FIELD = 60000;

// Netlify field name -> ActiveCampaign personalization tag
const FIELD_MAP: Record<string, string> = {
  title: "TITLE",
  organization: "COMPANY_NAME",
  event: "EI_EVENT",
  ei_systems: "EI_SYSTEMS",
  ei_map: "EI_MAP",
  ei_say: "EI_SAY",
  ei_dig: "EI_DIG",
  ei_flow: "EI_FLOW",
  ei_connect: "EI_CONNECT",
  ei_remap: "EI_REMAP",
  ei_pick: "EI_PICK",
};

type Json = Record<string, any>;

function makeClient(baseUrl: string, key: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return async function ac(method: string, path: string, body?: Json): Promise<Json> {
    const res = await fetch(`${base}/api/3${path}`, {
      method,
      headers: { "Api-Token": key, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ActiveCampaign ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export default async (req: Request) => {
  let payload: Json;
  try {
    ({ payload } = await req.json());
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  if (!payload || payload.form_name !== FORM_NAME) return new Response("Not this form");

  const url = Netlify.env.get("AC_API_URL");
  const key = Netlify.env.get("AC_API_KEY");
  if (!url || !key) {
    console.log("AC_API_URL or AC_API_KEY is not set. Submission kept in Netlify Forms; ActiveCampaign skipped.");
    return new Response("Skipped: ActiveCampaign not configured");
  }

  const d: Json = payload.data || {};
  const email = clean(d.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response("No valid email");

  const ac = makeClient(url, key);
  try {
    // 1. Look up custom field ids by personalization tag.
    const fieldsRes = await ac("GET", "/fields?limit=100");
    const idByTag = new Map<string, string>();
    for (const f of fieldsRes.fields || []) if (f.perstag) idByTag.set(String(f.perstag).toUpperCase(), String(f.id));

    const fieldValues: Json[] = [];
    for (const [formField, tag] of Object.entries(FIELD_MAP)) {
      const id = idByTag.get(tag);
      const value = clean(d[formField]).slice(0, MAX_FIELD);
      if (id) fieldValues.push({ field: id, value: value || " " });
      else console.log(`Custom field ${tag} not found in ActiveCampaign; skipped.`);
    }

    // 2. Create or update the contact with their answers.
    const [firstName, ...rest] = clean(d.name).split(/\s+/);
    const sync = await ac("POST", "/contact/sync", {
      contact: { email, firstName: firstName || "", lastName: rest.join(" "), fieldValues },
    });
    const contactId = String(sync.contact?.id || "");
    if (!contactId) throw new Error("contact/sync returned no id");

    // 3. Subscribe to the workshop list (needed for the email), and the newsletter only if they opted in.
    const listId = async (name: string) => {
      const r = await ac("GET", `/lists?filters[name]=${encodeURIComponent(name)}&limit=100`);
      const hit = (r.lists || []).find((l: Json) => String(l.name).toLowerCase() === name.toLowerCase());
      return hit ? String(hit.id) : "";
    };
    const wl = await listId(WORKSHOP_LIST);
    if (wl) await ac("POST", "/contactLists", { contactList: { list: wl, contact: contactId, status: 1 } });
    else console.log(`List "${WORKSHOP_LIST}" not found; contact not subscribed.`);
    if (clean(d.newsletter) === "yes") {
      const nl = await listId(NEWSLETTER_LIST);
      if (nl) await ac("POST", "/contactLists", { contactList: { list: nl, contact: contactId, status: 1 } });
    }

    // 4. Tags. The workshop tag is removed and re-added so the email goes out every time someone sends.
    const tagId = async (name: string, description: string) => {
      const r = await ac("GET", `/tags?search=${encodeURIComponent(name)}&limit=100`);
      const hit = (r.tags || []).find((t: Json) => String(t.tag).toLowerCase() === name.toLowerCase());
      if (hit) return String(hit.id);
      const created = await ac("POST", "/tags", { tag: { tag: name, tagType: "contact", description } });
      return String(created.tag?.id || "");
    };
    const existing = await ac("GET", `/contacts/${contactId}/contactTags`);
    const current: Json[] = existing.contactTags || [];

    const eventName = clean(d.event).slice(0, 80);
    if (eventName) {
      const evId = await tagId(`Event: ${eventName}`, "Added by the Easier If workshop page");
      if (evId && !current.some((ct) => String(ct.tag) === evId)) {
        await ac("POST", "/contactTags", { contactTag: { contact: contactId, tag: evId } });
      }
    }

    const wsId = await tagId(WORKSHOP_TAG, "Sent their Easier If worksheet from the workshop page. Starts the email-back automation.");
    for (const ct of current) if (String(ct.tag) === wsId) await ac("DELETE", `/contactTags/${ct.id}`);
    await ac("POST", "/contactTags", { contactTag: { contact: contactId, tag: wsId } });

    console.log(`Easier If worksheet synced to ActiveCampaign contact ${contactId}.`);
    return new Response("ok");
  } catch (err) {
    // The submission is still safe in Netlify Forms.
    console.error(String(err));
    return new Response("ActiveCampaign sync failed", { status: 500 });
  }
};
