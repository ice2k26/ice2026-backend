# ICE2026 — Backend (Google Apps Script)

Two clasp-managed Apps Script web apps, deployed from sankha@ahlab.org:

| Project | Executes as | Access | Purpose |
|---|---|---|---|
| `auth/` | User accessing | Anyone with Google account | Google sign-in broker — mints HMAC-signed tokens, redirects back to the site with `#icetoken=` |
| `api/`  | Owner | Anyone (anonymous) | JSON API over a Google Sheet (users, teams, messages, announcements) + Drive image uploads |

The two projects share an HMAC secret in `src/Secret.js` (git-ignored — copy
`Secret.js.example`, generate with `openssl rand -hex 32`, keep both copies identical).

## Workflows

```bash
cd api   # or auth
npm install
npx clasp push --force   # upload code
node deploy.js           # push + redeploy to the fixed deployment ID (stable /exec URL)
```

CORS: the frontend POSTs with `Content-Type: text/plain` (a CORS "simple request"),
which Apps Script answers with `Access-Control-Allow-Origin: *`. No preflight, no proxy.

One-time setup after creating from scratch: run `setup()` in the api project's
script editor to authorize scopes and create the database spreadsheet.
