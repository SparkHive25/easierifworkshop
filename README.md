# Easier If workshop page

The online version of the two-sided *It would be easier if…* worksheet. Attendees follow along on paper or here, and their answers save on their device as they type. At the end they can send it to themselves, print it, or download it.

- `public/index.html` is the whole page (Netlify serves this folder).
- `netlify/functions/submission-created.mts` runs after every verified form submission. It pushes the answers to ActiveCampaign.

## Per-workshop link
Add `?event=` to the URL and the workshop name fills in for everyone. The name is also saved as an `Event: …` tag in ActiveCampaign.
Example: `/?event=DLAC%20Ignite%202026`

## Where answers go
1. **Netlify Forms** (form name `easier-if-worksheet`) keeps every submission. Export it as a CSV anytime.
2. **ActiveCampaign** gets the answers once both environment variables are set in Netlify (scope: Functions):
   - `AC_API_URL`, for example `https://youraccount.api-us1.com`
   - `AC_API_KEY`

   Without them, the function skips ActiveCampaign and Netlify still keeps the record.

The ActiveCampaign side expects:
- a list named **Easier If Workshop**
- custom fields with these personalization tags: `EI_EVENT`, `EI_SYSTEMS`, `EI_MAP`, `EI_SAY`, `EI_DIG`, `EI_FLOW`, `EI_CONNECT`, `EI_REMAP`, `EI_PICK`
- an automation started by the tag **Workshop: Easier If**

The function creates that tag on its own if it's missing.
