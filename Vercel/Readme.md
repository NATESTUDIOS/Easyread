EasyRead — Full Project Documentation (v2 — corrected)

Version: 1.0
Frontend base: https://easytoread.vercel.app
Processing base: https://my-fcm-server.onrender.com

---

Table of Contents

1. Overview
2. Architecture
3. Deployment Targets
4. File Map
5. Static Assets & Images
6. Data Model
7. API Reference
8. Frontend
9. Service Worker & PWA
10. Manifest
11. Routing
12. Auth & Sessions
13. Credits System
14. AI & Prompts
15. Scraper Pipeline
16. Wakeup & Scheduled Jobs
17. Environment Variables
18. Known Issues
19. Operational Playbook

---

1. Overview

EasyRead is a PWA that turns complex content into simplified, persona-tailored explanations. Users can ask questions, paste notes, submit URLs, or read a feed. Each article can be read through multiple Explanation Profiles (Everyday Life, Football Fan, Engineer, …), each of which teaches the same facts through a different mental lens. Users ask inline deep dive follow-ups, bookmark, rate, and track progress. Credits are earned by rating and spent on generation.

Core principle enforced by every prompt:

Accuracy always has priority over personalization. Simple language ≠ shallow thinking.

---

2. Architecture

Three deployment targets (Vercel, Render) plus a GitHub Actions runner, all sharing one Supabase database.

```
┌─────────────────────────────────────────────────────────────────────┐
│  VERCEL  (easytoread.vercel.app)                                    │
│  ├─ Static frontend (index.html, blog.html, profile.html, ...)      │
│  ├─ Icons, screenshots, manifest, sw.js                             │
│  └─ Serverless APIs (/api/*.js)                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
        server-to-server         │  browser
        x-admin-key              │  x-user-id
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RENDER  (my-fcm-server.onrender.com)                               │
│  ├─ server.js (Express)                                             │
│  ├─ /api/processor  (LLM worker)                                    │
│  ├─ /api/scraper    (background loop, 20s interval)                 │
│  └─ /api/nyt        (NYT route)                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │  x-admin-key
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  OPENROUTER (LLM inference)                                         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  SUPABASE (Postgres + pgvector)                                     │
│  Service role key — RLS bypassed. Shared singleton.                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  GITHUB ACTIONS                                                     │
│  └─ easyread-wakeup.yml → POST /api/wakeup (up to 3×/day)           │
└─────────────────────────────────────────────────────────────────────┘
```

Key architectural facts

· Two backends share one Supabase DB via a service-role client.
· AI runs only on Render — Vercel never calls OpenRouter.
· The scraper loop is a long-running setInterval on Render (cannot run on Vercel).
· CORS on Render is a strict allowlist. Vercel APIs use *.
· User identity is x-user-id — client-asserted, never verified.
· Credits are written by both Vercel (explanation.js) and Render (processor.js).

---

3. Deployment Targets

Concern Vercel Render
Role Frontend + JSON APIs + SSR reader LLM worker + background scraper
Runtime Serverless (Hobby: 10s, Pro: 60s) Long-running Node
State Stateless Stateful (isRunning, pollInterval, stats)
Auth x-user-id (self-asserted) + x-admin-key x-admin-key on all admin paths
CORS * for all /api/* Strict allowlist
File shape One handler(req, res) per file Express Router exports
Env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROCESSOR_URL, ADMIN_API_KEY, SITE_URL SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_API_KEY, OPENROUTER_API_KEY, BASE_URL, PORT

Both deployments import utils/supabase.js, which registers ADMIN_API_KEY in system_config on startup.

---

4. File Map

```
/
├── api/                              ← VERCEL serverless + RENDER routers
│   ├── articles.js                   Vercel — CRUD, bookmarks, history, ratings
│   ├── explanation.js                Vercel — AI gateway + credits + cache
│   ├── category.js                   Vercel — derived categories from articles[]
│   ├── profiles.js                   Vercel — persona CRUD (admin)
│   ├── view.js                       Vercel — SSR reader, deep-dive, rate, bookmark
│   ├── wakeup.js                     Vercel — keep-alive + poke hardcoded services
│   ├── processor.js                  Render — LLM worker (Express Router)
│   ├── scraper.js                    Render — URL scraper pipeline (Express Router)
│   └── nyt.js                        Render — NYT-specific route
│
├── utils/                            ← SHARED (both deployments)
│   ├── supabase.js                   Service-role client + CRUD + vector RPCs
│   └── openrouter.js                 LLM wrapper (used only by processor.js)
│
├── public/                           ← VERCEL static assets (served at /)
│   ├── index.html                    Main shell (home + blog iframe + profile iframe)
│   ├── blog.html                     Feed iframe
│   ├── profile.html                  Login/profile iframe
│   ├── sw.js                         Service worker
│   ├── manifest.json                 PWA manifest
│   ├── favicon.ico
│   ├── icons/
│   │   ├── icon-120.png
│   │   ├── icon-144.png
│   │   ├── icon-152.png
│   │   ├── icon-180.png
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   ├── favicon-16.png
│   │   ├── favicon-32.png
│   │   └── og-image.png
│   └── screenshots/
│       ├── 1.png                     Profile tab (540×720)
│       ├── 2.png                     Feed tab (540×720)
│       └── 3.png                     Home tab (540×720)
│
├── .github/                          ← GITHUB ACTIONS
│   └── workflows/
│       └── easyread-wakeup.yml       Scheduled wakeup cron
│
├── server.js                         ← RENDER entry point
├── vercel.json                       ← VERCEL routing
└── package.json
```

Rule: Every static asset URL (icons, screenshots, manifest, sw.js) is served from the Vercel frontend base (https://easytoread.vercel.app). /api/view SSR emits SITE_URL for canonical / og:image / apple-touch-icon — all resolve against Vercel, not Render.

---

5. Static Assets & Images

All assets live under /public/ in the repo and are served at / on Vercel.

Icons (/icons/)

File Size Used by
icon-120.png 120×120 manifest.json, apple-touch-icon
icon-144.png 144×144 manifest.json
icon-152.png 152×152 manifest.json, apple-touch-icon
icon-180.png 180×180 manifest.json, apple-touch-icon
icon-192.png 192×192 manifest.json (any), apple-touch-icon, push notifications, sw.js pre-cache
icon-512.png 512×512 manifest.json (any maskable), shortcuts (96×96), og-image fallback
favicon-16.png 16×16 <link rel="icon">
favicon-32.png 32×32 <link rel="icon">
og-image.png Open Graph size <link rel="icon" sizes="32x32"> in article.html / view.js

Screenshots (/screenshots/)

File Size Label (in manifest)
1.png 540×720 Profile — Dark mode
2.png 540×720 Feed — Dark mode
3.png 540×720 Home — Dark mode

All form_factor: "narrow", type: "image/png".

Favicons

Path Format Where referenced
/favicon.ico .ico Root, index.html
/icons/favicon-16.png PNG 16 index.html
/icons/favicon-32.png PNG 32 index.html
/icons/og-image.png PNG view.js (as favicon, sizes 32 & 16)

PWA install references

```html
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
<link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png">
<link rel="apple-touch-icon" sizes="120x120" href="/icons/icon-120.png">
```

sw.js pre-cache list

```
/                    (root)
/index.html
/blog.html
/profile.html
/?mode=pwa
/manifest.json
/icons/icon-192.png
/icons/icon-512.png
/icons/icon-180.png
/icons/icon-152.png
/icons/icon-120.png
/icons/icon-144.png
/icons/favicon-32.png
/icons/favicon-16.png
/favicon.ico
```

Each cached individually with a per-asset try/catch. One 404 does not abort install.

Open Graph images

/api/view generates dynamic og:image via /api/og-image?title=…&description=…&domain=… (or falls back to /icons/og-image.png). The dynamic OG route is not shown in the current file map — it must exist or all article social cards will fall back to the static image.

⚠ Verify asset availability

```bash
curl -I https://easytoread.vercel.app/icons/icon-192.png
curl -I https://easytoread.vercel.app/screenshots/1.png
curl -I https://easytoread.vercel.app/manifest.json
curl -I https://easytoread.vercel.app/sw.js
```

All should return 200. If any 404, either vercel.json route 3 (/public/$1.$2) mismatches the actual file location, or the file is missing. See §11.

---

6. Data Model

Core tables

Table PK Purpose
articles article_id Content + metadata + embedding
explanation_views view_id Per-persona explanation
profiles profile_id Personas
deep_dives deep_dive_id Q&A extended answers

User tables

Table PK Purpose
users user_id credits, auth
bookmarks bookmark_id (user_id, article_id)
reading_history history_id (user_id, article_id, date)
reading_progress progress_id Scroll progress
ratings rating_id (user_id, view_id)

Operational tables

Table PK Purpose
processing_jobs job_id Scraper queue
article_versions version_id Content snapshots
usage usage_id Daily counters
credit_transactions transaction_id Ledger
system_config key (string) Global config

Notable system_config keys

Key Shape Written by
category_metadata { "Tech": { description, aliases[], parent_category } } category.js
api_keys { "ADMIN_KEY": { server, registered_at, active } } utils/supabase.js on startup
wakeup_heartbeat { ts, source } wakeup.js
category_index [{ name, article_ids[], count }] category.js rebuild-index (written, never read)

Key columns

```sql
articles:
  article_id (PK), slug (unique), canonical_title, base_content, summary,
  content_hash (sha256), source_url, source_domain, categories (jsonb),
  embedding (vector), word_count, version, view_count,
  status (pending|processing|processed|failed),
  retrieved_at, created_at, updated_at, next_refresh_at

explanation_views:
  view_id (PK), article_id (FK), profile_id (FK),
  title, content, summary, embedding (vector),
  view_count, rating_avg, rating_count, generated_at

profiles:
  profile_id (PK), name (unique), description, rules,
  status, is_system, is_default, created_by

deep_dives:
  deep_dive_id (PK), article_id (FK), profile_id (FK),
  parent_section, question, answer, created_at
```

Relationships

```
profiles ─┬─► explanation_views ─┬─► ratings
          └─► deep_dives          │
                                  ▼
articles ─┬─► explanation_views ───┘
          ├─► article_versions
          ├─► bookmarks ◄── users
          ├─► reading_history ◄── users
          ├─► reading_progress ◄── users
          └─► deep_dives

users ─┬─► credit_transactions
       ├─► usage
       ├─► bookmarks
       ├─► reading_history
       └─► ratings
```

---

7. API Reference

Vercel endpoints

All return application/json except /api/view (HTML when action is absent).

/api/articles?action=…

Action Method Auth Purpose
list GET public Paginated list
get&id= GET public By ID (increments view)
get-by-slug&slug= GET public By slug
search&search= GET public Full-text search
by-category&category= GET public Filter
similar&id= GET public Vector-similar
random GET public Random picks
versions&id= GET public Version history
ratings&id= GET public Rating distribution
bookmarks GET x-user-id User's bookmarks + article data
history GET x-user-id User's reading history
create POST public Insert
submit-context POST public URL/text → queue
bookmark POST x-user-id Bookmark
toggle-bookmark PUT x-user-id Toggle
rate POST x-user-id Rating (+0.2 credits)
track-view POST x-user-id History
update PUT public Update
update-status PUT public Change status
update-progress PUT x-user-id Progress
refresh POST public Re-queue
delete DELETE x-admin-key Delete + cascade

/api/explanation?action=…

Action Method Auth Notes
generate POST x-user-id 4-way router (mode: ask/paste/website/article_id)
deep-dive POST x-user-id Proxies to Render
regenerate POST x-user-id Delete + regenerate
get&view_id= GET public 
get-by-article&article_id=&profile_id= GET public 
list&article_id= GET public 
search&search= GET public 
similar&view_id= GET public 
history GET x-user-id 
stats GET public 
check&article_id=&profile_id= GET public 
batch-generate POST x-admin-key 
create POST x-admin-key 
update PUT x-admin-key 
delete DELETE x-admin-key 
clear-cache DELETE x-admin-key 

generate request:

```json
{
  "mode": "ask" | "paste" | "website",
  "content": "...",
  "article_id": 123,
  "profile_id": 1,
  "force": false
}
```

/api/category?action=…

Categories are derived from articles.categories[]. Metadata in system_config.category_metadata.

Action Method Auth Notes
list GET public With counts
get&id= GET public id is the category name
get-by-name&name= GET public Fuzzy
search&search= GET public Score-based
suggestions GET public Existing + defaults
stats GET public 
tree GET public Hierarchy
articles&id= GET public 
create POST x-admin-key 
merge POST x-admin-key 
rebuild-index POST x-admin-key Writes category_index (unused)
update PUT x-admin-key Rename (rewrites articles)
recategorize PUT public 
update-hierarchy PUT x-admin-key 
delete DELETE x-admin-key 
remove-from-article DELETE public 

/api/profiles?action=…

Action Method Auth
list GET public
get&id= GET public
get-by-name&name= GET public
default GET public
stats GET public
create POST x-admin-key
update&id= PUT x-admin-key
set-default&id= PUT x-admin-key
delete&id=&force= DELETE x-admin-key

Validation: name ≤ 20 chars, description 10–700 words, rules optional.

/api/view?…

Action Method Auth Output
(none) GET public SSR HTML reader
data GET public JSON
bookmark-status&article_id= GET x-user-id JSON
bookmarks GET x-user-id JSON
rate POST x-user-id JSON (+0.2 credits)
deep-dive POST x-user-id Proxy to processor
bookmark POST/DELETE x-user-id Toggle

POST /api/wakeup

Auth: x-wake-key: EASYREAD-WAKEUP (hardcoded in wakeup.js).

1. Upserts system_config.wakeup_heartbeat (WRITE — Supabase counts writes as activity)
2. Fires all WAKE_TARGETS in parallel (hardcoded array at top of file)
3. Returns 200 (all ok) or 207 (partial)

Response:

```json
{
  "success": true,
  "triggered_at": "2026-10-26T03:00:12.345Z",
  "duration_ms": 234,
  "supabase": { "ok": true, "ms": 187 },
  "targets": []
}
```

Targets with timeoutMs > 8000 are auto-skipped on Vercel (skipped: true, not a failure).

Render endpoints

All require x-admin-key: $ADMIN_API_KEY except /api/scraper/status.

Route Purpose
POST /api/processor Full article pipeline (from scraper)
POST /api/processor/generate-explanation One persona explanation
POST /api/processor/question Ask-mode Q&A
POST /api/processor/generate-deep-dive Deep dive
GET /api/processor/health OpenRouter status
GET /api/processor/explanation/:articleId/:profileId Cache lookup
POST /api/scraper/submit One URL (1 credit)
POST /api/scraper/submit-batch ≤50 URLs
POST /api/scraper/submit-text Raw text (1 credit)
POST /api/scraper/start Start poll loop (idempotent)
POST /api/scraper/stop Stop
POST /api/scraper/run-once One batch
GET /api/scraper/status Public queue stats
POST /api/nyt/* NYT route (unseen)
GET /health Server-level health

---

8. Frontend

public/index.html — Main shell

Three tabs, driven by switchTab():

· Home — inline DOM (composer + feed)
· Blog — <iframe src="blog.html">
· Profile — <iframe src="profile.html">

Cross-frame postMessage messages:

Message From → To Purpose
{type:'switchTab', tab} any Navigate
{type:'themeChanged', theme} any Sync theme
{type:'authChanged'} profile → home Login state
{type:'openArticle', slug, article_id} any Open reader
triggerLogin home → profile Open login

Key flows:

```
Ask/paste/website → submitPipeline()
   → POST /api/explanation?action=generate
   → openArticleInReader(slug) → /article/{slug}

Feed → fetchHomeFeed() → GET /api/article?action=list   ⚠ singular
   fallback: localStorage.easyread_cached_articles

Categories → fetchHomeCategories() → GET /api/category?action=list

Article click → openArticleInReader(slug)
   → /article/{slug}
   → vercel rewrite → /api/view?slug={slug}
```

localStorage keys:

Key Purpose
easyread-theme auto \| light \| dark
easyread-logged-in "true" \| unset
easyread_user_id user ID
easyread_session_token token (never validated)
easyread-profile-id active persona
easyread-credits cached balance
easyread_cached_articles offline feed
easyread_cached_categories offline categories

Reader page (/api/view SSR)

Contains:

· Persona pills (client-side switching via switchProfile)
· Live generation timer with phased status
· Deep dive accordions
· Bookmark / rate / share dock
· Auto-rating modal at 85% scroll
· Push notification support via sw.js

PWA prompts (checkPrompts())

· beforeinstallprompt → install modal (once per session, sessionStorage.er_install_shown)
· Notification.requestPermission → permission modal (once per session, sessionStorage.er_notif_shown)

---

9. Service Worker & PWA

public/sw.js strategies

Request type Strategy Cache
fonts.googleapis.com / fonts.gstatic.com Cache-first Yes
/api/*?action=list Network-first with cache fallback Yes
/api/* (other) Network-only No
HTML navigation Network-first, / fallback Yes
`*.css js png
Everything else Network-first Yes

Cache name: easyread-v1. Bump APP_VERSION to invalidate.

Pre-cache (on install)

```
/  /index.html  /blog.html  /profile.html  /?mode=pwa  /manifest.json
/icons/icon-192.png  /icons/icon-512.png  /icons/icon-180.png
/icons/icon-152.png  /icons/icon-120.png  /icons/icon-144.png
/icons/favicon-32.png  /icons/favicon-16.png  /favicon.ico
```

Push / sync

· push → showNotification with { url, type }
· notificationclick → focus existing client or openWindow
· sync tag sync-feed → refresh /api/article?action=list

⚠ Known SW issues

1. apiNetworkFirst returns {articles:[]} with status 200 on failure — index.html sees res.ok === true, overwrites localStorage with [], shows "Connected". Should return 503.
2. notificationclick posts {type:'navigate', url} — but index.html has no handler for this. Tapping a push while the app is open only focuses the tab.
3. sync-feed never registered — nothing calls registration.sync.register('sync-feed').

---

10. Manifest

public/manifest.json — served at /manifest.json.

Identity

Key Value
name / short_name EasyRead
id /?mode=pwa
start_url /?mode=pwa
scope /
description Knowledge, Simplified — explained in a way only you understand.
lang / dir en / ltr
categories ["education", "productivity", "books", "reference"]

Display

Key Value
display standalone
display_override ["standalone", "minimal-ui"]
orientation portrait
background_color #000000
theme_color #000000
prefer_related_applications false
handle_links preferred
launch_handler.client_mode ["navigate-existing", "auto"]

Icons (6)

src sizes purpose
/icons/icon-192.png 192×192 any
/icons/icon-512.png 512×512 any maskable
/icons/icon-144.png 144×144 any
/icons/icon-180.png 180×180 any
/icons/icon-152.png 152×152 any
/icons/icon-120.png 120×120 any

Screenshots (3, all narrow, dark mode)

src sizes label
/screenshots/3.png 540×720 Home — Dark mode
/screenshots/2.png 540×720 Feed — Dark mode
/screenshots/1.png 540×720 Profile — Dark mode

Shortcuts (3, all use icon-512 at 96×96)

Name URL
Home /
Blog /blog.html
Profile /profile.html

Share target

```json
"share_target": {
  "action": "/?utm_medium=PWA&utm_source=share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "name",
    "text": "description",
    "url": "link",
    "files": [{ "name": "file", "accept": ["image/*", "text/plain"] }]
  }
}
```

Protocol handler

web+easyread: → /?q=%s

⚠ Manifest caveat

All src values are root-relative (/icons/…, /screenshots/…). They resolve against https://easytoread.vercel.app — the frontend base. Any asset path must be available on that origin, not on Render. See §11 for the routing rule that determines this.

---

11. Routing

vercel.json

```json
{
  "version": 2,
  "routes": [
    { "src": "/api/(.*)",        "dest": "/api/$1" },
    { "src": "/article/(.*)",    "dest": "https://easytoread.vercel.app/api/view?slug=$1" },
    { "src": "/(.*)\\.(html|css|js|png|jpg|jpeg|gif|svg|ico|json|xml|txt|woff|woff2|ttf|eot)",
                                 "dest": "/public/$1.$2" },
    { "src": "/(.*)",            "dest": "/index.html" }
  ]
}
```

URL Destination
/api/articles api/articles.js
/api/article 404 (file is articles.js)
/article/my-slug https://easytoread.vercel.app/api/view?slug=my-slug
/icons/icon-192.png /public/icons/icon-192.png
/screenshots/1.png /public/screenshots/1.png
/manifest.json /public/manifest.json
/sw.js /public/sw.js
/any-other-path /index.html (SPA fallback)

⚠ Known routing issues

1. Frontend calls /api/article?action=list (singular) — the file is articles.js (plural). The feed fetch 404s; index.html falls back to localStorage.
2. Route 2 hardcodes production domain — preview/alias deployments read from production's /api/view.
3. Route 2 drops query params — /article/slug?user_id=abc loses user_id; logged-in users get treated as guests on shared links.
4. Route 3 maps to /public/ — verify all referenced assets exist at the corresponding path (see §5 verification step).

---

12. Auth & Sessions

Current model

· No server-side session verification.
· x-user-id is client-asserted.
· x-session-token is threaded through requests but never validated.
· Supabase uses service role key → RLS bypassed entirely.
· All authorization is application-layer only (eq('user_id', user_id)).

Implications

· A user can impersonate another by editing localStorage.easyread_user_id.
· The only guard is each endpoint remembering to filter by the header's user_id.
· x-admin-key is an env compare; blast radius = full DB.

Admin-protected actions

· /api/articles?action=delete
· /api/profiles?action=create|update|set-default|delete
· /api/category?action=create|update|delete|merge|rebuild-index|update-hierarchy
· /api/explanation?action=batch-generate|create|update|delete|clear-cache
· All Render endpoints except /api/scraper/status and /health

Planned improvement

Add /api/session that:

· Accepts a session token
· Validates (JWT or DB lookup)
· Returns verified user_id

Then replace every req.headers['x-user-id'] with the verified value.

---

13. Credits System

Costs

Operation Cost Deducted on
Ask question 1.0 Render (processor.js step 8)
Paste note 1.0 Vercel (explanation.js)
Submit URL (scraper) 1.0 Render (scraper.js)
Generate explanation 0.5 Vercel
Deep dive 0.5 Vercel
Regenerate 1.0 Vercel
Rate an explanation +0.2 Vercel (view.js)

Daily limit

50 credits/day (checked by scraper.js only).

Ledger

credit_transactions row per change:

```json
{
  "user_id": "...",
  "amount": -0.5,
  "reason": "explanation_generation",
  "balance_after": 4.5,
  "item_id": "123"
}
```

⚠ Known credit issues

1. Two writers — Vercel and Render both update users.credits.
2. processQuestion doesn't clamp at 0 — can go negative.
3. Scraper deducts before insert — failed insert loses the credit.
4. No refund on scrape failure.

Recommended

All deductions on Vercel (single ledger writer); Render returns credits_used. Clamp with Math.max(0, current - cost). Refund fetch/quality failures in the scraper.

---

14. AI & Prompts### Models (via OpenRouter)

Prompt type Used by Max tokens
content_processing generateBaseArticle 8192
explanation generateExplanationView 4096
user_questions processQuestion 2048
deep_dive /generate-deep-dive 2048

Prompt architecture

Base → Explanation (articles):

1. buildBaseArticlePrompt — one fact-only article per URL
2. buildExplanationPrompt — one per-persona explanation per base article

Question → Answer (ask mode):

· buildQuestionPrompt — single prompt decides reuse | deep_dive | create | clarify and produces the answer

Design principles

· Accuracy always has priority over personalization.
· Simple language ≠ shallow thinking.
· Analogy safety — reader must distinguish concept from analogy.
· "Would this make sense to someone reading it on their phone while half-paying attention on a bus?"
· Preserve knowledge — never invent facts; attribute when uncertain.

⚠ Known AI issues

1. isLowQualityQuestion regex /^what is/i rejects almost every valid knowledge question.
2. searchExistingKnowledge uses ILIKE on title, not the match_explanations RPC — reuse detection is substring-based, not semantic.
3. processQuestion trusts model's knowledge_action over code's — can return article_id: null while having charged the user.
4. Missing slug uniqueness loop in processQuestion — concurrent identical questions can 500 or produce duplicate slugs.
5. generateBaseArticle silent fallback to raw content on AI JSON parse failure — quality silently degrades, article still marked processed.

---

15. Scraper Pipeline

7-stage flow (scraper.js processJob)

```
1. fetch       — cheerio fetch URL (30s timeout, 3 retries)
2. extract     — main content detection, noise removal
3. quality     — min 200 words, min 10 unique words
4. duplicate   — content_hash (sha256) check
5. storage     — insert articles + article_versions (slug dedupe loop)
6. processing  — POST /api/processor (60s timeout)
7. embedding   — tracked in stages; actual embedding in processor
```

Job states: pending → processing → completed | failed.

Stages stored as JSON: { fetch, extract, quality, duplicate_check, processing, embedding, storage } with values pending|success|failed|skipped.

Poll loop

```
startScraper() → processPendingJobs() immediately
              → setInterval(processPendingJobs, 20000)

processPendingJobs():
  select BATCH_SIZE (default 3) pending jobs
  for each: processJob(job)   ← sequential
```

⚠ Known scraper issues

1. No stuck-job recovery — processing rows never re-picked after a crash.
2. State is process-local — multiple Render instances race on the same jobs.
3. No atomic claim — no FOR UPDATE SKIP LOCKED.
4. Deducts before insert — failed insert loses the credit.
5. pollInterval not stopped on shutdown — graceful shutdown leaks an in-flight job.

---

16. Wakeup & Scheduled Jobs

api/wakeup.js (Vercel)

· Auth: x-wake-key: EASYREAD-WAKEUP (hardcoded)
· Upserts system_config.wakeup_heartbeat (a write — Supabase counts writes as activity, reads may not)
· Fires WAKE_TARGETS in parallel (hardcoded array at top of file)
· Vercel Hobby: function timeout 10s → targets with timeoutMs > 8000 auto-skip (skipped: true)

.github/workflows/easyread-wakeup.yml

Four cron slots, gated by env flags:

Flag Cron Default
ENABLE_4H 0 */4 * * * false
ENABLE_8H 0 */8 * * * false
ENABLE_12H 0 */12 * * * true
ENABLE_1D 0 3 * * * true

Default cadence: 3 wakeups/day (00:00, 03:00, 12:00 UTC).

Manual trigger: workflow_dispatch always runs.

Set flags to true/false at the top of the YAML to change cadence.

---

17. Environment Variables

Vercel

Name Purpose
SUPABASE_URL Supabase project URL
SUPABASE_SERVICE_ROLE_KEY Service role key (RLS bypass)
PROCESSOR_URL https://my-fcm-server.onrender.com/api/processor
ADMIN_API_KEY Admin auth for server-to-server
SITE_URL https://easytoread.vercel.app
NODE_ENV production
VERCEL Set automatically by Vercel

Render

Name Purpose
SUPABASE_URL Supabase URL
SUPABASE_SERVICE_ROLE_KEY Service role key
ADMIN_API_KEY Admin auth
OPENROUTER_API_KEY LLM inference
BASE_URL https://my-fcm-server.onrender.com
PORT 3001 (default)
NODE_ENV production
SCRAPER_INTERVAL 20000 (default)
SCRAPER_BATCH_SIZE 3 (default)
SCRAPER_MAX_RETRIES 3 (default)
ALLOWED_ORIGINS Comma-separated extra CORS origins

GitHub

Name Where Purpose
(none — hardcoded key) wakeup.yml uses literal EASYREAD-WAKEUP Matches wakeup.js

---

18. Known Issues

🔴 Critical

1. Auth boundary — x-user-id self-asserted + service-role RLS bypass. Users can impersonate each other.
2. /api/article vs /api/articles — feed fetch 404s; index.html runs on localStorage cache.
3. Credit ledger split — Vercel + Render both write users.credits, non-atomic.
4. CORS allowlist on Render — server.js has easyread.vercel.app but real app is easytoread.vercel.app.

🟡 Significant

5. apiNetworkFirst returns 200 on failure — silently destroys localStorage feed cache.
6. notificationclick no handler — tapping a push while the app is open does nothing.
7. isLowQualityQuestion — rejects valid questions.
8. searchExistingKnowledge uses ILIKE — not the vector RPC.
9. processQuestion returns article_id: null in mixed-state cases while charging the user.
10. Scraper stuck-job recovery — none.
11. escapeHtml in onclick= — XSS via category names.
12. processQuestion no slug uniqueness — concurrent identical questions can 500.

🟢 Minor

13. generateBaseArticle silent fallback on parse failure.
14. pollInterval not stopped on shutdown → leaks in-flight job.
15. vercel.json route 2 hardcodes production domain; drops query params.
16. sync-feed never registered.
17. category_index written but never read.
18. listProfiles / getProfileStats do O(N) full scans in JS.
19. getExistingCategories scans all articles per request.
20. /api/og-image referenced in view.js but not present in file map — must confirm it exists or all article social cards fall back to static /icons/og-image.png.

---

19. Operational Playbook

Verify assets

```bash
curl -I https://easytoread.vercel.app/icons/icon-192.png
curl -I https://easytoread.vercel.app/icons/icon-512.png
curl -I https://easytoread.vercel.app/screenshots/1.png
curl -I https://easytoread.vercel.app/screenshots/2.png
curl -I https://easytoread.vercel.app/screenshots/3.png
curl -I https://easytoread.vercel.app/manifest.json
curl -I https://easytoread.vercel.app/sw.js
curl -I https://easytoread.vercel.app/favicon.ico
```

All should 200. Any 404 → asset missing or route mismatch (see §11).

Verify endpoints

```bash
# Vercel
curl -I "https://easytoread.vercel.app/api/articles?action=list"
curl -I "https://easytoread.vercel.app/api/article?action=list"   # ⚠ currently 404
curl -I "https://easytoread.vercel.app/api/category?action=list"
curl -I "https://easytoread.vercel.app/api/profiles?action=list"

# Render
curl -I "https://my-fcm-server.onrender.com/health"
curl -I "https://my-fcm-server.onrender.com/api/scraper/status"

# Wakeup
curl -X POST "https://easytoread.vercel.app/api/wakeup" \
     -H "x-wake-key: EASYREAD-WAKEUP"
```

Wakeup health check

After each wakeup, system_config should have:

```json
{ "key": "wakeup_heartbeat", "value": { "ts": "2026-10-26T03:00:12.345Z", "source": "vercel-wakeup" } }
```

If the ts is stale, cron isn't firing or x-wake-key doesn't match.

Common failures

Symptom Likely cause
Icons missing on PWA install Files not in /public/icons/, or vercel.json route 3 mismatch
Feed always empty /api/article 404 → SW caches nothing → localStorage fallback
Push notification tap does nothing index.html lacks type: 'navigate' handler
User credits stuck / wrong Two writers (Vercel + Render) racing
Render requests blocked Frontend origin not in server.js allowlist
Wakeup returns 401 x-wake-key ≠ EASYREAD-WAKEUP
Wakeup returns 500 Supabase env missing (silent failure)
Scraper queue stuck Stuck processing rows — no recovery implemented

Recovery procedures

Feed stuck on cache:

1. Fix /api/article → /api/articles in index.html
2. Redeploy Vercel
3. Clear user cache (or bump APP_VERSION in sw.js)

Push tap broken:

1. Add else if (event.data.type === 'navigate') window.location.href = event.data.url to index.html message handler
2. Redeploy

Scraper stuck:

```sql
UPDATE processing_jobs
SET status = 'pending', current_stage = 'fetch'
WHERE status = 'processing'
  AND started_at < now() - interval '15 minutes';
```

Credits broken:

1. Identify the two writers
2. Consolidate to Vercel (return credits_used from Render responses)
3. Redeploy both

Wakeup stopped firing:

1. GitHub → Actions → EasyRead Wakeup → check last run
2. GitHub auto-disables workflows on repos inactive 60+ days — re-enable if so
3. Manually trigger via Run workflow

---

End of documentation.