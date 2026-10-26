
<div align="center">

# EasyRead

### Knowledge, Simplified.

**Complex information. Clear explanations. Your way of understanding.**

A progressive web app that transforms complex content into simple, accurate, persona-tailored explanations — helping everyone understand more without losing the depth that matters.

[![Version](https://img.shields.io/badge/version-1.0-6c3483?style=flat-square)](#)
[![Platform](https://img.shields.io/badge/platform-PWA-6c3483?style=flat-square)](#service-worker--pwa)
[![Frontend](https://img.shields.io/badge/frontend-Vercel-black?style=flat-square)](https://easytoread.vercel.app)
[![Backend](https://img.shields.io/badge/backend-Render-46a758?style=flat-square)](https://my-fcm-server.onrender.com)
[![Database](https://img.shields.io/badge/database-Supabase-3ecf8e?style=flat-square)](https://supabase.com)

[Open EasyRead](https://easytoread.vercel.app) · [Frontend](https://easytoread.vercel.app) · [Processing Server](https://my-fcm-server.onrender.com)

</div>

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Architecture](#2-architecture)
- [3. Deployment Targets](#3-deployment-targets)
- [4. File Map](#4-file-map)
- [5. Static Assets and Images](#5-static-assets-and-images)
- [6. Data Model](#6-data-model)
- [7. API Reference](#7-api-reference)
- [8. Frontend](#8-frontend)
- [9. Service Worker and PWA](#9-service-worker-and-pwa)
- [10. Manifest](#10-manifest)
- [11. Routing](#11-routing)
- [12. Authentication and Sessions](#12-authentication-and-sessions)
- [13. Credits System](#13-credits-system)
- [14. AI and Prompts](#14-ai-and-prompts)
- [15. Scraper Pipeline](#15-scraper-pipeline)
- [16. Wakeup and Scheduled Jobs](#16-wakeup-and-scheduled-jobs)
- [17. Environment Variables](#17-environment-variables)
- [18. Known Issues](#18-known-issues)
- [19. Operational Playbook](#19-operational-playbook)

---

## 1. Overview

EasyRead is a progressive web application (PWA) that transforms complex content into simplified, persona-tailored explanations.

Users can ask questions, paste notes, submit URLs, or browse a feed of existing articles. Each article can be understood through multiple **Explanation Profiles** — such as Everyday Life, Football Fan, or Engineer — that communicate the same underlying facts through different mental models.

Instead of merely shortening content, EasyRead helps people understand it.

### What users can do

- **Ask:** Submit a question and receive an understandable answer.
- **Paste:** Turn notes, documents, or raw text into structured explanations.
- **Read:** Explore a feed of processed articles.
- **Personalize:** Switch between explanation profiles to find the perspective that works best.
- **Go deeper:** Ask inline follow-up questions about specific sections.
- **Bookmark:** Save articles for later.
- **Track progress:** Record reading activity and progress.
- **Rate:** Evaluate explanations and earn credits.
- **Install:** Add EasyRead to a device as a PWA, with offline support for selected content.

### Core principle

> Accuracy always has priority over personalization. Simple language does not mean shallow thinking.

Every AI prompt should preserve the original meaning, avoid invented facts, communicate uncertainty, and use analogies without confusing them with reality.

### Deployment

| Component | URL |
|---|---|
| Frontend and serverless APIs | [easytoread.vercel.app](https://easytoread.vercel.app) |
| Processing server | [my-fcm-server.onrender.com](https://my-fcm-server.onrender.com) |
| Shared database | Supabase |
| AI inference | OpenRouter |
| Scheduled wakeups | GitHub Actions |

**Version:** 1.0

---

## 2. Architecture

EasyRead uses Vercel for the frontend and serverless APIs, Render for long-running processing, Supabase for shared persistent storage, OpenRouter for AI inference, and GitHub Actions for scheduled wakeups.

### System architecture

```text
                         USERS
                           |
                           v
        +------------------------------------+
        | VERCEL                             |
        | easytoread.vercel.app              |
        |                                    |
        | Static frontend                    |
        | PWA assets and service worker      |
        | Serverless APIs                    |
        | SSR article reader                 |
        +------------------+-----------------+
                           |
              Server-to-server requests
                x-admin-key / headers
                           |
                           v
        +------------------------------------+
        | RENDER                             |
        | my-fcm-server.onrender.com         |
        |                                    |
        | Express server                     |
        | /api/processor                     |
        | /api/scraper                       |
        | /api/nyt                           |
        | Background polling loop            |
        +------------------+-----------------+
                           |
                           v
        +------------------------------------+
        | OPENROUTER                         |
        | LLM inference                       |
        +------------------------------------+

        +------------------------------------+
        | SUPABASE                           |
        | PostgreSQL + pgvector              |
        | Articles, profiles, credits,       |
        | bookmarks, jobs, history, vectors  |
        +------------------------------------+
               ^                    ^
               |                    |
          Vercel APIs          Render APIs

        +------------------------------------+
        | GITHUB ACTIONS                     |
        | easyread-wakeup.yml                |
        | Scheduled POST /api/wakeup         |
        +------------------------------------+
```

### Architectural facts

1. Both deployments share one Supabase database through a service-role client.
2. AI inference runs on Render. Vercel does not call OpenRouter directly.
3. The scraper uses a long-running `setInterval()` loop on Render; it is not intended to run as a Vercel background process.
4. Render uses a strict CORS allowlist, while Vercel's `/api/*` routes are configured with wildcard CORS according to the current implementation.
5. User identity is passed through `x-user-id`. It is currently client-asserted, not independently verified.
6. Credits are currently modified by both Vercel and Render, creating a consistency risk.
7. The Supabase service-role key bypasses Row Level Security (RLS). Application-level authorization is therefore critical.

### Request flow

A typical article-generation request follows this path:

```text
User input
   |
   v
Vercel /api/explanation
   |
   v
Validate request and credits
   |
   v
Render /api/processor
   |
   v
OpenRouter inference
   |
   v
Validate and process result
   |
   v
Supabase storage
   |
   v
Response to frontend
```

The exact steps vary by operation. For example, URL submissions enter the Render scraper queue before article processing begins.

---

## 3. Deployment Targets

| Concern | Vercel | Render |
|---|---|---|
| Primary role | Frontend, APIs, SSR reader | AI worker and scraper |
| Runtime | Serverless functions | Long-running Node.js |
| State | Stateless between invocations | Process-local state |
| User identity | Client-supplied `x-user-id` | Admin-authenticated processing |
| Admin authentication | `x-admin-key` where required | `x-admin-key` on protected routes |
| CORS | Wildcard for `/api/*` in current configuration | Strict allowlist |
| Entry-point shape | `handler(req, res)` | Express router exports |
| Main responsibilities | User-facing APIs and rendering | AI generation and background jobs |

### Environment overview

| Vercel | Render |
|---|---|
| `SUPABASE_URL` | `SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| `PROCESSOR_URL` | `ADMIN_API_KEY` |
| `ADMIN_API_KEY` | `OPENROUTER_API_KEY` |
| `SITE_URL` | `BASE_URL` |
| `NODE_ENV` | `PORT`, `NODE_ENV` |

Both deployments import `utils/supabase.js`, which also registers `ADMIN_API_KEY` in `system_config` during startup.

---

## 4. File Map

```text
/
├── api/
│   ├── articles.js
│   │   └── Vercel: article CRUD, bookmarks, history and ratings
│   ├── explanation.js
│   │   └── Vercel: generation gateway, credits and cache
│   ├── category.js
│   │   └── Vercel: category discovery and management
│   ├── profiles.js
│   │   └── Vercel: explanation profile management
│   ├── view.js
│   │   └── Vercel: SSR reader, deep dives, ratings and bookmarks
│   ├── wakeup.js
│   │   └── Vercel: keep-alive and service wakeups
│   ├── processor.js
│   │   └── Render: LLM processing router
│   ├── scraper.js
│   │   └── Render: URL scraping and job queue
│   └── nyt.js
│       └── Render: New York Times-specific route
│
├── utils/
│   ├── supabase.js
│   │   └── Shared service-role client, CRUD and vector RPCs
│   └── openrouter.js
│       └── LLM wrapper used by the Render processor
│
├── public/
│   ├── index.html
│   │   └── Main application shell
│   ├── blog.html
│   │   └── Feed iframe
│   ├── profile.html
│   │   └── Login and profile iframe
│   ├── sw.js
│   │   └── Service worker
│   ├── manifest.json
│   │   └── PWA manifest
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
│       ├── 1.png
│       ├── 2.png
│       └── 3.png
│
├── .github/
│   └── workflows/
│       └── easyread-wakeup.yml
│
├── server.js
├── vercel.json
└── package.json
```

### Static asset rule

All static assets must resolve from the Vercel frontend origin:

`https://easytoread.vercel.app`

The Render deployment is not the canonical host for icons, screenshots, the manifest, or the service worker.

The SSR reader must also use the Vercel frontend base for canonical URLs, Open Graph metadata, and Apple touch icons.

---

## 5. Static Assets and Images

All assets live under `public/` and are expected to be served from the root of the Vercel deployment.

### Icons

| File | Dimensions | Main usage |
|---|---:|---|
| `icon-120.png` | 120 × 120 | Manifest and Apple touch icon |
| `icon-144.png` | 144 × 144 | Manifest |
| `icon-152.png` | 152 × 152 | Manifest and Apple touch icon |
| `icon-180.png` | 180 × 180 | Manifest and Apple touch icon |
| `icon-192.png` | 192 × 192 | Manifest, notifications, pre-cache |
| `icon-512.png` | 512 × 512 | Manifest, maskable icon, shortcuts |
| `favicon-16.png` | 16 × 16 | Browser favicon |
| `favicon-32.png` | 32 × 32 | Browser favicon |
| `og-image.png` | Open Graph image | Static social image and fallback |

### Screenshots

| File | Dimensions | Manifest label |
|---|---:|---|
| `screenshots/1.png` | 540 × 720 | Profile — Dark mode |
| `screenshots/2.png` | 540 × 720 | Feed — Dark mode |
| `screenshots/3.png` | 540 × 720 | Home — Dark mode |

All three screenshots use `form_factor: "narrow"` and `type: "image/png"`.

### Favicon references

| Path | Format | Usage |
|---|---|---|
| `/favicon.ico` | ICO | Root and main page |
| `/icons/favicon-16.png` | PNG, 16 px | Browser tab |
| `/icons/favicon-32.png` | PNG, 32 px | Browser tab |
| `/icons/og-image.png` | PNG | Reader fallback references |

### PWA installation links

```html
<link rel="manifest" href="/manifest.json">

<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
<link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152.png">
<link rel="apple-touch-icon" sizes="120x120" href="/icons/icon-120.png">
```

### Service worker pre-cache list

```text
/
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

Each asset is cached individually with its own `try/catch`, so one missing asset should not abort the entire installation.

### Open Graph images

The SSR reader generates a dynamic social image through:

```text
/api/og-image?title=...&description=...&domain=...
```

If the dynamic endpoint is missing or fails, the reader should fall back to:

```text
/icons/og-image.png
```

**Verification required:** `/api/og-image` is referenced by the reader but is not present in the supplied file map. Confirm that the route exists.

### Verify asset availability

```bash
curl -I https://easytoread.vercel.app/icons/icon-192.png
curl -I https://easytoread.vercel.app/icons/icon-512.png
curl -I https://easytoread.vercel.app/screenshots/1.png
curl -I https://easytoread.vercel.app/manifest.json
curl -I https://easytoread.vercel.app/sw.js
```

Expected result: HTTP `200 OK` for every existing asset.

If an asset returns `404`, verify its actual repository location and the static-asset routing rule in `vercel.json`.

---

## 6. Data Model

EasyRead uses Supabase PostgreSQL with pgvector for persistent storage and semantic retrieval.

### Core tables

| Table | Primary key | Purpose |
|---|---|---|
| `articles` | `article_id` | Article content, metadata and embeddings |
| `explanation_views` | `view_id` | Persona-specific explanations |
| `profiles` | `profile_id` | Explanation profiles |
| `deep_dives` | `deep_dive_id` | Follow-up questions and answers |

### User tables

| Table | Primary key | Purpose |
|---|---|---|
| `users` | `user_id` | User records, credits and account data |
| `bookmarks` | `bookmark_id` | Saved articles |
| `reading_history` | `history_id` | Reading history |
| `reading_progress` | `progress_id` | Reading position |
| `ratings` | `rating_id` | Explanation ratings |

### Operational tables

| Table | Primary key | Purpose |
|---|---|---|
| `processing_jobs` | `job_id` | Scraper queue |
| `article_versions` | `version_id` | Article snapshots |
| `usage` | `usage_id` | Usage counters |
| `credit_transactions` | `transaction_id` | Credit ledger |
| `system_config` | `key` | Global configuration |

### Important `system_config` keys

| Key | Structure | Written by |
|---|---|---|
| `category_metadata` | Category descriptions, aliases and parents | `category.js` |
| `api_keys` | Registered admin key metadata | `utils/supabase.js` |
| `wakeup_heartbeat` | `{ ts, source }` | `wakeup.js` |
| `category_index` | Array of category names, article IDs and counts | Category index rebuild |

`category_index` is currently written but not read by the application.

### Key columns

```sql
articles:
  article_id       -- Primary key
  slug             -- Unique article slug
  canonical_title
  base_content
  summary
  content_hash     -- SHA-256
  source_url
  source_domain
  categories       -- JSONB
  embedding        -- Vector
  word_count
  version
  view_count
  status           -- pending | processing | processed | failed
  retrieved_at
  created_at
  updated_at
  next_refresh_at

explanation_views:
  view_id          -- Primary key
  article_id       -- Foreign key
  profile_id       -- Foreign key
  title
  content
  summary
  embedding       -- Vector
  view_count
  rating_avg
  rating_count
  generated_at

profiles:
  profile_id       -- Primary key
  name             -- Unique
  description
  rules
  status
  is_system
  is_default
  created_by

deep_dives:
  deep_dive_id     -- Primary key
  article_id       -- Foreign key
  profile_id       -- Foreign key
  parent_section
  question
  answer
  created_at
```

### Relationships

```text
profiles ───────► explanation_views ───────► ratings
    │                     ▲
    └──────────► deep_dives│
                          │
articles ─────────────────┘
    │
    ├──► article_versions
    ├──► bookmarks ◄──────── users
    ├──► reading_history ◄── users
    ├──► reading_progress ◄─ users
    └──► deep_dives

users ──► credit_transactions
  │
  ├─────► usage
  ├─────► bookmarks
  ├─────► reading_history
  └─────► ratings
```

### Data integrity considerations

- Article slugs must remain unique.
- Credit changes should be recorded in `credit_transactions`.
- User-specific queries must always constrain records to the authenticated user.
- Vector retrieval depends on the correct embedding dimensions and matching pgvector schema.
- Service-role database access makes server-side authorization essential.

---

## 7. API Reference

The API is split between Vercel serverless handlers and the Render Express server.

Unless otherwise stated, JSON endpoints return `application/json`. `/api/view` returns server-rendered HTML when no action is specified.

### 7.1 Vercel: Articles API

**Base path:** `/api/articles?action=...`

| Action | Method | Authentication | Purpose |
|---|---|---|---|
| `list` | GET | Public | Paginated article list |
| `get&id=` | GET | Public | Get article by ID; increments view count |
| `get-by-slug&slug=` | GET | Public | Get article by slug |
| `search&search=` | GET | Public | Full-text search |
| `by-category&category=` | GET | Public | Filter by category |
| `similar&id=` | GET | Public | Vector-similar articles |
| `random` | GET | Public | Random article selection |
| `versions&id=` | GET | Public | Article version history |
| `ratings&id=` | GET | Public | Rating distribution |
| `bookmarks` | GET | `x-user-id` | User bookmarks and article data |
| `history` | GET | `x-user-id` | User reading history |
| `create` | POST | Public in current design | Insert an article |
| `submit-context` | POST | Public in current design | Queue URL or text |
| `bookmark` | POST | `x-user-id` | Bookmark an article |
| `toggle-bookmark` | PUT | `x-user-id` | Toggle bookmark state |
| `rate` | POST | `x-user-id` | Rate an explanation; award credits |
| `track-view` | POST | `x-user-id` | Record reading history |
| `update` | PUT | Public in current design | Update an article |
| `update-status` | PUT | Public in current design | Change article status |
| `update-progress` | PUT | `x-user-id` | Save reading progress |
| `refresh` | POST | Public in current design | Re-queue processing |
| `delete` | DELETE | `x-admin-key` | Delete an article and related records |

**Security note:** Several article mutations are marked public in the current implementation. These should be reviewed before production use.

### 7.2 Vercel: Explanation API

**Base path:** `/api/explanation?action=...`

| Action | Method | Authentication | Purpose |
|---|---|---|---|
| `generate` | POST | `x-user-id` | Generate from a question, pasted text, URL or article |
| `deep-dive` | POST | `x-user-id` | Proxy deep-dive generation to Render |
| `regenerate` | POST | `x-user-id` | Delete and regenerate an explanation |
| `get&view_id=` | GET | Public | Retrieve explanation by ID |
| `get-by-article&article_id=&profile_id=` | GET | Public | Retrieve a specific persona explanation |
| `list&article_id=` | GET | Public | List explanations for an article |
| `search&search=` | GET | Public | Search explanations |
| `similar&view_id=` | GET | Public | Find similar explanations |
| `history` | GET | `x-user-id` | User explanation history |
| `stats` | GET | Public | Explanation statistics |
| `check&article_id=&profile_id=` | GET | Public | Check explanation availability |
| `batch-generate` | POST | `x-admin-key` | Generate multiple explanations |
| `create` | POST | `x-admin-key` | Create an explanation |
| `update` | PUT | `x-admin-key` | Update an explanation |
| `delete` | DELETE | `x-admin-key` | Delete an explanation |
| `clear-cache` | DELETE | `x-admin-key` | Clear cached explanations |

#### Generate request

```json
{
  "mode": "ask",
  "content": "Explain how solar panels generate electricity.",
  "article_id": 123,
  "profile_id": 1,
  "force": false
}
```

Supported modes:

- `ask` — Answer a user question.
- `paste` — Process supplied text.
- `website` — Process content from a URL.

The `article_id` and `profile_id` fields are contextual and may depend on the selected mode. `force` requests regeneration when supported.

### 7.3 Vercel: Category API

**Base path:** `/api/category?action=...`

Categories are derived from `articles.categories[]`. Additional metadata is stored in `system_config.category_metadata`.

| Action | Method | Authentication | Purpose |
|---|---|---|---|
| `list` | GET | Public | List categories with counts |
| `get&id=` | GET | Public | Get a category by name |
| `get-by-name&name=` | GET | Public | Fuzzy category lookup |
| `search&search=` | GET | Public | Score-based search |
| `suggestions` | GET | Public | Existing and default suggestions |
| `stats` | GET | Public | Category statistics |
| `tree` | GET | Public | Category hierarchy |
| `articles&id=` | GET | Public | Articles in a category |
| `create` | POST | `x-admin-key` | Create category metadata |
| `merge` | POST | `x-admin-key` | Merge categories |
| `rebuild-index` | POST | `x-admin-key` | Rebuild the category index |
| `update` | PUT | `x-admin-key` | Rename category and rewrite articles |
| `recategorize` | PUT | Public in current design | Change article categories |
| `update-hierarchy` | PUT | `x-admin-key` | Update parent relationships |
| `delete` | DELETE | `x-admin-key` | Delete a category |
| `remove-from-article` | DELETE | Public in current design | Remove an article-category relationship |

### 7.4 Vercel: Profiles API

**Base path:** `/api/profiles?action=...`

| Action | Method | Authentication |
|---|---|---|
| `list` | GET | Public |
| `get&id=` | GET | Public |
| `get-by-name&name=` | GET | Public |
| `default` | GET | Public |
| `stats` | GET | Public |
| `create` | POST | `x-admin-key` |
| `update&id=` | PUT | `x-admin-key` |
| `set-default&id=` | PUT | `x-admin-key` |
| `delete&id=&force=` | DELETE | `x-admin-key` |

**Profile validation**

- Name: maximum 20 characters.
- Description: 10–700 words.
- Rules: optional.

### 7.5 Vercel: Article Reader API

**Base path:** `/api/view`

| Action | Method | Authentication | Output |
|---|---|---|---|
| No action | GET | Public | Server-rendered HTML |
| `data` | GET | Public | Article JSON |
| `bookmark-status&article_id=` | GET | `x-user-id` | Bookmark status |
| `bookmarks` | GET | `x-user-id` | User bookmarks |
| `rate` | POST | `x-user-id` | Rating and credit reward |
| `deep-dive` | POST | `x-user-id` | Proxy to Render |
| `bookmark` | POST/DELETE | `x-user-id` | Toggle bookmark |

### 7.6 Vercel: Wakeup API

**Endpoint:** `POST /api/wakeup`

**Authentication:** `x-wake-key: EASYREAD-WAKEUP` in the current implementation.

The handler:

1. Upserts `system_config.wakeup_heartbeat`.
2. Triggers configured wakeup targets in parallel.
3. Reports target outcomes and total duration.

Possible status codes:

- `200` — All required operations succeeded.
- `207` — Partial success.

Targets with `timeoutMs > 8000` are automatically skipped on Vercel when the function's execution limit makes them unsuitable.

Example response:

```json
{
  "success": true,
  "triggered_at": "2026-10-26T03:00:12.345Z",
  "duration_ms": 234,
  "supabase": {
    "ok": true,
    "ms": 187
  },
  "targets": []
}
```

The `targets` array contains the actual results returned by the configured targets.

> **Security warning:** The wakeup key is hardcoded in the current implementation and must be treated as a secret. Move it to an environment variable and rotate it if exposed.

### 7.7 Render: Processor API

All processor routes require `x-admin-key: $ADMIN_API_KEY` unless explicitly documented otherwise.

| Route | Method | Purpose |
|---|---|---|
| `/api/processor` | POST | Full article-processing pipeline |
| `/api/processor/generate-explanation` | POST | Generate one persona explanation |
| `/api/processor/question` | POST | Ask-mode question processing |
| `/api/processor/generate-deep-dive` | POST | Generate a deep dive |
| `/api/processor/health` | GET | Check OpenRouter status |
| `/api/processor/explanation/:articleId/:profileId` | GET | Look up a cached explanation |

### 7.8 Render: Scraper API

| Route | Method | Purpose |
|---|---|---|
| `/api/scraper/submit` | POST | Submit one URL; costs 1 credit |
| `/api/scraper/submit-batch` | POST | Submit up to 50 URLs |
| `/api/scraper/submit-text` | POST | Submit raw text; costs 1 credit |
| `/api/scraper/start` | POST | Start polling; idempotent |
| `/api/scraper/stop` | POST | Stop polling |
| `/api/scraper/run-once` | POST | Process one batch |
| `/api/scraper/status` | GET | Public queue statistics |

All routes require `x-admin-key` except `/api/scraper/status`.

### 7.9 Other Render endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/nyt/*` | POST or route-specific | NYT-specific integration |
| `/health` | GET | Server-level health |

The exact behavior and authentication of individual NYT subroutes should be verified against `api/nyt.js`.

---

## 8. Frontend

### Main shell: `public/index.html`

The application uses three main tabs controlled by `switchTab()`.

| Tab | Implementation | Purpose |
|---|---|---|
| Home | Inline DOM | Composer and main feed |
| Blog | `blog.html` iframe | Article feed |
| Profile | `profile.html` iframe | Login and user profile |

### Cross-frame messaging

| Message | Direction | Purpose |
|---|---|---|
| `{ type: 'switchTab', tab }` | Any frame | Navigate between tabs |
| `{ type: 'themeChanged', theme }` | Any frame | Synchronize theme |
| `{ type: 'authChanged' }` | Profile → Home | Notify login-state changes |
| `{ type: 'openArticle', slug, article_id }` | Any frame | Open article reader |
| `triggerLogin` | Home → Profile | Open login interface |

**Implementation note:** `postMessage` handlers should validate `event.origin` and message shape before acting. Do not treat cross-frame messages as trusted authentication.

### Main user flows

#### Ask, paste or website

```text
User submits content
        |
        v
submitPipeline()
        |
        v
POST /api/explanation?action=generate
        |
        v
openArticleInReader(slug)
        |
        v
/article/{slug}
```

#### Feed

```text
fetchHomeFeed()
        |
        v
GET /api/article?action=list
        |
        +---- success ---> Render feed
        |
        +---- failure ---> localStorage fallback
```

**Known issue:** The frontend uses the singular `/api/article` path, but the actual file is `api/articles.js`. Correct the request to `/api/articles?action=list`.

#### Categories

```text
fetchHomeCategories()
        |
        v
GET /api/category?action=list
        |
        v
Render categories
```

#### Article reader

```text
Article click
     |
     v
openArticleInReader(slug)
     |
     v
/article/{slug}
     |
     v
Vercel rewrite
     |
     v
/api/view?slug={slug}
```

### localStorage keys

| Key | Purpose |
|---|---|
| `easyread-theme` | `auto`, `light` or `dark` |
| `easyread-logged-in` | Cached login flag |
| `easyread_user_id` | Client-side user identifier |
| `easyread_session_token` | Token that is not currently validated |
| `easyread-profile-id` | Active explanation profile |
| `easyread-credits` | Cached credit balance |
| `easyread_cached_articles` | Offline feed |
| `easyread_cached_categories` | Offline categories |

These values are client-side storage, not proof of identity or authorization.

### Server-rendered article reader

`/api/view` generates the reader page with:

- Persona pills and client-side profile switching.
- A live generation timer with phased status messages.
- Deep-dive accordions.
- Bookmark, rating and sharing controls.
- An automatic rating modal at 85% scroll.
- Push notification support through `sw.js`.

### Installation and notification prompts

`checkPrompts()` handles:

- `beforeinstallprompt`: shows the install modal once per session using `sessionStorage.er_install_shown`.
- `Notification.requestPermission()`: shows the notification permission modal once per session using `sessionStorage.er_notif_shown`.

The app should not repeatedly interrupt users who have dismissed these prompts.

---

## 9. Service Worker and PWA

**File:** `public/sw.js`

**Current cache name:** `easyread-v1`

The service worker provides selected offline caching, navigation fallback, push notifications and a planned feed synchronization mechanism.

### Cache strategies

| Request type | Strategy | Cached? |
|---|---|---|
| Google Fonts | Cache-first | Yes |
| `/api/*?action=list` | Network-first with cache fallback | Yes |
| Other `/api/*` requests | Network-only | No |
| HTML navigation | Network-first, `/` fallback | Yes |
| CSS, JavaScript and PNG assets | Static asset caching, as configured | Yes |
| Other requests | Network-first | Yes |

The exact file-matching behavior depends on the conditions implemented in `sw.js`; verify it before relying on an asset being cached.

### Installation pre-cache

```text
/
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

### Push notifications

The service worker:

- Listens for `push` events.
- Displays notifications with `showNotification()`.
- Supports notification data such as `url` and `type`.
- Handles `notificationclick` by focusing an existing client or opening a new window.

### Background synchronization

The intended synchronization tag is:

```text
sync-feed
```

The service worker attempts to refresh:

```text
/api/article?action=list
```

This currently contains the same singular/plural endpoint mismatch found in the frontend.

### Known service-worker issues

1. **False success on network failure:** `apiNetworkFirst` returns `{ "articles": [] }` with HTTP `200` when the network fails. The frontend sees `res.ok === true` and may overwrite its offline feed cache with an empty array.

   **Fix:** Return a non-success status when the request genuinely fails and no cached response is available.

2. **Push navigation is incomplete:** The notification click handler posts `{ type: 'navigate', url }`, but the main page does not handle that message. An already-open tab may be focused without navigating to the intended article.

   **Fix:** Add a validated `navigate` message handler in the page and navigate to the supplied URL.

3. **Background sync is never registered:** Nothing currently calls `registration.sync.register('sync-feed')`.

   **Fix:** Register synchronization where supported, with a graceful fallback for browsers that do not support Background Sync.

4. **Cache invalidation:** Bump `APP_VERSION` or the cache version when incompatible cached assets must be replaced.

5. **Cache safety:** Do not cache private user data or authenticated API responses indiscriminately.

---

## 10. Manifest

**File:** `public/manifest.json`

The manifest describes EasyRead as an installable web application.

### Identity

| Property | Value |
|---|---|
| `name` | `EasyRead` |
| `short_name` | `EasyRead` |
| `id` | `/?mode=pwa` |
| `start_url` | `/?mode=pwa` |
| `scope` | `/` |
| `description` | `Knowledge, Simplified — explained in a way only you understand.` |
| `lang` | `en` |
| `dir` | `ltr` |
| `categories` | `education`, `productivity`, `books`, `reference` |

### Display settings

| Property | Value |
|---|---|
| `display` | `standalone` |
| `display_override` | `standalone`, `minimal-ui` |
| `orientation` | `portrait` |
| `background_color` | `#000000` |
| `theme_color` | `#000000` |
| `prefer_related_applications` | `false` |
| `handle_links` | `preferred` |
| `launch_handler.client_mode` | `navigate-existing`, `auto` |

### Icons

| Source | Dimensions | Purpose |
|---|---:|---|
| `/icons/icon-192.png` | 192 × 192 | Standard icon |
| `/icons/icon-512.png` | 512 × 512 | Standard and maskable |
| `/icons/icon-144.png` | 144 × 144 | Standard icon |
| `/icons/icon-180.png` | 180 × 180 | Standard icon |
| `/icons/icon-152.png` | 152 × 152 | Standard icon |
| `/icons/icon-120.png` | 120 × 120 | Standard icon |

### Screenshots

| Source | Dimensions | Label |
|---|---:|---|
| `/screenshots/3.png` | 540 × 720 | Home — Dark mode |
| `/screenshots/2.png` | 540 × 720 | Feed — Dark mode |
| `/screenshots/1.png` | 540 × 720 | Profile — Dark mode |

All screenshots use the narrow form factor.

### Shortcuts

| Name | URL | Icon |
|---|---|---|
| Home | `/` | `icon-512.png` |
| Blog | `/blog.html` | `icon-512.png` |
| Profile | `/profile.html` | `icon-512.png` |

The configured shortcut icons use 96 × 96 sizes.

### Share target

```json
{
  "share_target": {
    "action": "/?utm_medium=PWA&utm_source=share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "name",
      "text": "description",
      "url": "link",
      "files": [
        {
          "name": "file",
          "accept": ["image/*", "text/plain"]
        }
      ]
    }
  }
}
```

### Protocol handler

```text
web+easyread: → /?q=%s
```

### Manifest caveat

All asset paths are root-relative, so they resolve against:

`https://easytoread.vercel.app`

The corresponding files must be available on the Vercel frontend origin, regardless of where the processing server runs.

---

## 11. Routing

**File:** `vercel.json`

The following is the current documented routing configuration:

```json
{
  "version": 2,
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    },
    {
      "src": "/article/(.*)",
      "dest": "https://easytoread.vercel.app/api/view?slug=$1"
    },
    {
      "src": "/(.*)\\.(html|css|js|png|jpg|jpeg|gif|svg|ico|json|xml|txt|woff|woff2|ttf|eot)",
      "dest": "/public/$1.$2"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
```

### Route mapping

| Requested URL | Intended destination |
|---|---|
| `/api/articles` | `api/articles.js` |
| `/api/article` | No matching `api/article.js`; currently returns 404 |
| `/article/my-slug` | `/api/view?slug=my-slug` |
| `/icons/icon-192.png` | `/public/icons/icon-192.png` |
| `/screenshots/1.png` | `/public/screenshots/1.png` |
| `/manifest.json` | `/public/manifest.json` |
| `/sw.js` | `/public/sw.js` |
| Other unmatched paths | `/index.html` |

### Known routing issues

**1. Singular versus plural API path**

The frontend requests `/api/article?action=list`, but the actual handler is `api/articles.js`.

Correct the frontend and service-worker requests to:

```javascript
fetch('/api/articles?action=list');
```

**2. Production domain hardcoded in article rewrites**

The article rewrite targets the production domain directly. Preview deployments may therefore fetch the production reader rather than the preview deployment.

**3. Query parameters may be lost**

The article rewrite does not explicitly preserve extra query parameters. For example, `/article/slug?user_id=abc` may lose `user_id` when rewritten, depending on the rewrite behavior.

Avoid relying on a query parameter for authentication; use a properly validated session instead.

**4. Static asset destination**

The `/public/` destination must match the actual project structure and Vercel's deployment behavior. Verify that every icon, screenshot, manifest and service worker URL resolves successfully.

**Deployment note:** This route configuration is reproduced from the supplied documentation. Confirm that it matches the deployed `vercel.json` and the Vercel project settings before changing production routing.

---

## 12. Authentication and Sessions

### Current model

The current implementation uses client-supplied identity headers and a Supabase service-role key.

| Component | Current behavior |
|---|---|
| `x-user-id` | Client-asserted user identity |
| `x-session-token` | Passed through requests but not validated |
| Supabase service-role key | Bypasses RLS |
| Authorization | Application-layer checks |
| Admin API | `x-admin-key` comparison |

### Security implications

- A user may impersonate another user by changing `localStorage.easyread_user_id`.
- User-owned records are only protected if every endpoint correctly filters by the supplied user ID.
- A leaked admin key can grant broad access to protected operations.
- Wildcard CORS does not authenticate requests.
- A client-side login flag is not proof that a user has a valid session.
- A service-role key must never be exposed to browser code.

### Admin-protected actions

- `/api/articles?action=delete`
- `/api/profiles?action=create|update|set-default|delete`
- `/api/category?action=create|update|delete|merge|rebuild-index|update-hierarchy`
- `/api/explanation?action=batch-generate|create|update|delete|clear-cache`
- Render endpoints other than `/api/scraper/status` and `/health`, according to the documented design

### Recommended session architecture

Introduce a server-side `/api/session` endpoint that:

1. Accepts a session token.
2. Validates the token using a trusted JWT verifier or database-backed session lookup.
3. Returns the verified `user_id`.
4. Rejects invalid, expired or revoked sessions.
5. Uses the verified identity for all user-specific database operations.

Then replace direct trust in:

```javascript
req.headers['x-user-id']
```

with the verified user identity from the session.

**Priority:** Implement this before treating user credits, bookmarks, history or other personal data as securely isolated between users.

---

## 13. Credits System

Credits are the application's usage currency. Users spend credits on generation and earn credits by rating explanations.

### Current costs

| Operation | Cost | Current deduction location |
|---|---:|---|
| Ask question | 1.0 | Render processor |
| Paste note | 1.0 | Vercel explanation API |
| Submit URL | 1.0 | Render scraper |
| Generate explanation | 0.5 | Vercel |
| Deep dive | 0.5 | Vercel |
| Regenerate explanation | 1.0 | Vercel |
| Rate an explanation | +0.2 | Vercel reader |

### Daily limit

The documented daily limit is **50 credits per day**, currently enforced by `scraper.js` only.

This means the limit is not necessarily enforced consistently across all operations.

### Credit ledger

Every credit change should produce a `credit_transactions` row.

Example:

```json
{
  "user_id": "example-user",
  "amount": -0.5,
  "reason": "explanation_generation",
  "balance_after": 4.5,
  "item_id": "123"
}
```

### Known credit issues

1. **Two balance writers:** Vercel and Render both modify `users.credits`.
2. **Negative balances:** `processQuestion` does not clamp deductions at zero.
3. **Lost credits on insert failure:** The scraper deducts before confirming that article insertion succeeds.
4. **No refund on scrape failure:** A failed scraping operation may leave the user charged.
5. **Non-atomic operations:** Concurrent requests can create inconsistent balances unless deductions and ledger updates are transactional.

### Recommended design

Use a single authoritative credit service, preferably on Vercel under the current architecture.

1. Render reports `credits_used` and the result of the operation.
2. The authoritative credit service performs the deduction.
3. The balance update and ledger insert occur atomically.
4. Failed operations are refunded according to explicit rules.
5. All operations enforce the same daily limit.
6. Balance checks and deductions are protected against concurrent requests.

At minimum, prevent negative balances:

```javascript
const newBalance = Math.max(0, currentBalance - cost);
```

This alone does not prevent race conditions. Production-safe deductions should use an atomic database operation or transaction that verifies the available balance.

---

## 14. AI and Prompts

EasyRead uses OpenRouter for model inference, accessed by the Render processor.

### Prompt types

| Prompt type | Main function | Maximum tokens |
|---|---|---:|
| Content processing | `generateBaseArticle` | 8192 |
| Explanation | `generateExplanationView` | 4096 |
| User questions | `processQuestion` | 2048 |
| Deep dive | `/generate-deep-dive` | 2048 |

The exact model IDs are determined by the configuration in `utils/openrouter.js` and the processor implementation.

### Prompt architecture

#### Article processing

```text
Source URL
    |
    v
buildBaseArticlePrompt
    |
    v
Fact-focused base article
    |
    v
buildExplanationPrompt
    |
    v
Persona-specific explanation
```

- `buildBaseArticlePrompt` creates a fact-focused article from the source.
- `buildExplanationPrompt` generates an explanation tailored to a particular profile.

#### Ask mode

```text
User question
     |
     v
buildQuestionPrompt
     |
     v
Knowledge decision
     |
     +--> Reuse existing knowledge
     |
     +--> Deep dive
     |
     +--> Create new content
     |
     +--> Ask for clarification
```

The question prompt decides which action is appropriate and generates the response.

### Core AI principles

**Accuracy before personalization.**

Every prompt should enforce the following:

- Preserve the facts in the source.
- Never invent facts to make an explanation more engaging.
- Communicate uncertainty when the source is incomplete.
- Use simple language without removing important technical depth.
- Explain analogies clearly enough that readers do not mistake them for literal descriptions.
- Maintain consistency between the source article and its persona-specific explanations.
- Consider whether the explanation would be understandable to someone reading on a phone while distracted.

### Known AI issues

1. **Overly broad low-quality question filter:** The regex `/^what is/i` rejects many valid questions beginning with “What is”.

2. **Weak knowledge reuse:** `searchExistingKnowledge` uses `ILIKE` against article titles instead of the semantic `match_explanations` RPC. Similar questions may not be recognized.

3. **Model-controlled knowledge actions:** `processQuestion` trusts the model's `knowledge_action` decision too heavily. Mixed states may produce `article_id: null` even after charging the user.

4. **Missing slug uniqueness loop:** Concurrent identical questions may cause duplicate slugs or database errors.

5. **Silent fallback on malformed AI output:** `generateBaseArticle` may fall back to raw content when AI JSON parsing fails, allowing low-quality output to be marked as processed.

### Recommended AI reliability improvements

- Replace overly broad regex rules with better validation.
- Use semantic retrieval for knowledge reuse.
- Validate model output against a strict schema.
- Verify required article IDs before deducting credits.
- Add unique-slug retries or a database-safe slug generator.
- Treat malformed AI output as a processing failure rather than silently accepting unsuitable content.
- Log model errors and quality failures without exposing private user content unnecessarily.

---

## 15. Scraper Pipeline

The scraper turns URLs and raw text into articles that can be processed, embedded and presented through EasyRead.

### Seven-stage pipeline

```text
1. FETCH
   Retrieve the source URL
   30-second timeout, up to 3 retries
          |
          v
2. EXTRACT
   Detect main content and remove noise
          |
          v
3. QUALITY
   Minimum 200 words
   Minimum 10 unique words
          |
          v
4. DUPLICATE CHECK
   Compare SHA-256 content_hash
          |
          v
5. STORAGE
   Insert article and article_versions
   Deduplicate slug
          |
          v
6. PROCESSING
   POST /api/processor
   60-second timeout
          |
          v
7. EMBEDDING
   Track embedding stage
   Actual embedding handled by processor
```

### Job states

```text
pending
   |
   v
processing
   |
   +----> completed
   |
   +----> failed
```

### Stage tracking

Each job stores a JSON representation of its processing stages:

```json
{
  "fetch": "success",
  "extract": "success",
  "quality": "success",
  "duplicate_check": "success",
  "storage": "success",
  "processing": "pending",
  "embedding": "pending"
}
```

Each stage uses one of:

- `pending`
- `success`
- `failed`
- `skipped`

The example above is illustrative; actual stage values depend on the job's current progress.

### Poll loop

```text
startScraper()
    |
    +--> processPendingJobs() immediately
    |
    +--> setInterval(processPendingJobs, 20000)
```

Each polling cycle:

1. Selects up to `BATCH_SIZE` pending jobs, default `3`.
2. Processes the selected jobs sequentially.
3. Updates job status and stage information.

### Known scraper issues

1. **No stuck-job recovery:** Jobs left in `processing` after a crash are not automatically picked up again.
2. **Process-local state:** Multiple Render instances may race on the same jobs.
3. **No atomic claim:** The queue does not currently use `FOR UPDATE SKIP LOCKED`.
4. **Early credit deduction:** Failed inserts may still cost credits.
5. **Shutdown handling:** `pollInterval` may continue during shutdown, allowing an in-flight job to outlive the intended lifecycle.

### Recommended improvements

- Claim jobs atomically in the database.
- Add lease timestamps and automatic recovery for stale jobs.
- Make processing idempotent.
- Add graceful shutdown handlers that stop polling and wait for active jobs.
- Deduct credits only after a successful operation or implement reliable refunds.
- Make duplicate detection and slug generation concurrency-safe.

---

## 16. Wakeup and Scheduled Jobs

EasyRead uses a Vercel endpoint and GitHub Actions to periodically wake configured services and record database activity.

### Wakeup endpoint

**File:** `api/wakeup.js`

**Endpoint:** `POST /api/wakeup`

The current implementation:

- Checks `x-wake-key: EASYREAD-WAKEUP`.
- Upserts `system_config.wakeup_heartbeat`.
- Fires the hardcoded `WAKE_TARGETS` array in parallel.
- Records target outcomes and execution duration.
- Skips targets whose `timeoutMs` exceeds `8000` when they are unsuitable for Vercel's Hobby timeout.

The heartbeat is a database write. This may help maintain activity, but it should not be treated as a guarantee against all provider suspension or inactivity policies.

### GitHub Actions workflow

**File:** `.github/workflows/easyread-wakeup.yml`

The workflow contains four optional cron schedules:

| Flag | Cron | Default |
|---|---|---|
| `ENABLE_4H` | `0 */4 * * *` | `false` |
| `ENABLE_8H` | `0 */8 * * *` | `false` |
| `ENABLE_12H` | `0 */12 * * *` | `true` |
| `ENABLE_1D` | `0 3 * * *` | `true` |

The documented default cadence is three wakeups per day: 00:00, 03:00 and 12:00 UTC.

Manual execution is supported through `workflow_dispatch`.

**Note:** GitHub Actions cron schedules are UTC-based and can be delayed. Confirm the exact enabled conditions in the deployed YAML before relying on a schedule.

### Recommended security improvement

Move the wakeup key to a secret environment variable in both Vercel and GitHub Actions. Avoid keeping authentication secrets as hardcoded source literals.

---

## 17. Environment Variables

Configure these values separately for each deployment. Never commit real credentials or service-role keys to the repository.

### Vercel

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database access |
| `PROCESSOR_URL` | Render processor URL |
| `ADMIN_API_KEY` | Server-to-server authentication |
| `SITE_URL` | Canonical frontend origin |
| `NODE_ENV` | Runtime environment |
| `VERCEL` | Automatically supplied by Vercel |

Recommended values:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PROCESSOR_URL=https://my-fcm-server.onrender.com/api/processor
ADMIN_API_KEY=your_shared_admin_secret
SITE_URL=https://easytoread.vercel.app
NODE_ENV=production
```

### Render

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database access |
| `ADMIN_API_KEY` | Admin and server-to-server authentication |
| `OPENROUTER_API_KEY` | AI inference |
| `BASE_URL` | Render server base URL |
| `PORT` | Server port; defaults to `3001` |
| `NODE_ENV` | Runtime environment |
| `SCRAPER_INTERVAL` | Poll interval in milliseconds |
| `SCRAPER_BATCH_SIZE` | Jobs per polling cycle |
| `SCRAPER_MAX_RETRIES` | Retry limit |
| `ALLOWED_ORIGINS` | Additional comma-separated CORS origins |

Recommended values:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
ADMIN_API_KEY=your_shared_admin_secret
OPENROUTER_API_KEY=your_openrouter_api_key
BASE_URL=https://my-fcm-server.onrender.com
PORT=3001
NODE_ENV=production
SCRAPER_INTERVAL=20000
SCRAPER_BATCH_SIZE=3
SCRAPER_MAX_RETRIES=3
ALLOWED_ORIGINS=https://easytoread.vercel.app
```

### GitHub Actions

The current workflow uses a literal wakeup key in its documented implementation. Replace that with a GitHub Actions secret, for example:

```text
EASYREAD_WAKE_KEY
```

The value should match the wakeup secret configured in Vercel.

### Secret management rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to frontend JavaScript.
- Never commit real API keys.
- Keep the admin secret consistent between services that authenticate each other.
- Rotate exposed credentials immediately.
- Prefer separate secrets for admin operations and wakeup operations.
- After changing environment variables, redeploy the affected service if required.

---

## 18. Known Issues

This section summarizes the current documented risks. It is a working checklist, not confirmation that every issue has been independently reproduced against production.

### Critical

| # | Issue | Impact |
|---:|---|---|
| 1 | `x-user-id` is self-asserted and RLS is bypassed | Users may impersonate other users |
| 2 | Frontend calls `/api/article` instead of `/api/articles` | Feed requests return 404 |
| 3 | Vercel and Render both write credit balances | Race conditions and inconsistent balances |
| 4 | Render CORS may allow `easyread.vercel.app` instead of `easytoread.vercel.app` | Valid frontend requests may be blocked |

### Significant

| # | Issue | Impact |
|---:|---|---|
| 5 | Service worker returns HTTP 200 with an empty feed on failure | Offline feed cache may be destroyed |
| 6 | Push navigation lacks a corresponding page message handler | Notification clicks may not navigate |
| 7 | `/^what is/i` rejects valid questions | Unnecessary question rejection |
| 8 | Knowledge reuse relies on `ILIKE` | Similar content may not be found |
| 9 | `processQuestion` may return `article_id: null` after charging | User pays without a valid result |
| 10 | Stuck scraper jobs are not recovered | Jobs may remain in `processing` indefinitely |
| 11 | `escapeHtml` is used in an `onclick` context | Potential XSS through category names |
| 12 | Slug uniqueness is not enforced safely in `processQuestion` | Concurrent requests may fail or create conflicts |

### Minor

| # | Issue | Impact |
|---:|---|---|
| 13 | Raw-content fallback on AI JSON parse failure | Silent quality degradation |
| 14 | Polling interval may survive shutdown | In-flight work may leak |
| 15 | Article rewrite hardcodes production domain | Preview deployments may use production |
| 16 | Article rewrite may drop query parameters | Shared links may lose context |
| 17 | `sync-feed` is never registered | Background synchronization does not run |
| 18 | `category_index` is written but never read | Unused derived data |
| 19 | Profile statistics perform O(N) scans | Poor scalability |
| 20 | Category lookup scans all articles | Increasing request cost |
| 21 | `/api/og-image` is missing from the documented file map | Dynamic social cards may fall back to the static image |

### Recommended repair order

1. Fix authentication and authorization.
2. Correct the article endpoint path in the frontend and service worker.
3. Consolidate credit deductions and make them atomic.
4. Correct the Render CORS allowlist.
5. Prevent the service worker from returning false success responses.
6. Fix XSS risks and validate incoming messages.
7. Add scraper recovery and atomic job claims.
8. Improve AI validation, question filtering and knowledge reuse.
9. Fix push navigation and background sync registration.
10. Confirm the OG-image route and routing behavior.

---

## 19. Operational Playbook

This section contains commands and procedures for checking the deployment, identifying common failures and recovering affected services.

### 19.1 Verify static assets

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

Expected result: `200 OK` for each existing asset.

If an asset fails:

1. Confirm the file exists in `public/`.
2. Check the Vercel deployment output.
3. Inspect `vercel.json` and the static-file routing rule.
4. Check for incorrect casing in file paths.
5. Redeploy after correcting the issue.

### 19.2 Verify Vercel endpoints

```bash
# Correct article endpoint
curl -i \
  "https://easytoread.vercel.app/api/articles?action=list"

# Known incorrect singular endpoint
curl -i \
  "https://easytoread.vercel.app/api/article?action=list"

# Categories
curl -i \
  "https://easytoread.vercel.app/api/category?action=list"

# Profiles
curl -i \
  "https://easytoread.vercel.app/api/profiles?action=list"
```

The singular endpoint is expected to fail until a matching handler or rewrite is added.

### 19.3 Verify Render endpoints

```bash
curl -i \
  "https://my-fcm-server.onrender.com/health"

curl -i \
  "https://my-fcm-server.onrender.com/api/scraper/status"
```

These endpoints should respond according to their documented public access rules.

### 19.4 Trigger a wakeup

```bash
curl -i -X POST \
  "https://easytoread.vercel.app/api/wakeup" \
  -H "x-wake-key: YOUR_WAKEUP_SECRET"
```

Replace `YOUR_WAKEUP_SECRET` with the configured secret.

Do not publish the actual key in logs, issues, documentation or public repositories.

### 19.5 Verify the wakeup heartbeat

After a successful wakeup, inspect `system_config` for a record similar to:

```json
{
  "key": "wakeup_heartbeat",
  "value": {
    "ts": "2026-10-26T03:00:12.345Z",
    "source": "vercel-wakeup"
  }
}
```

If the timestamp is stale, check:

1. GitHub Actions run history.
2. Whether the workflow is enabled.
3. Whether the secret matches the Vercel configuration.
4. Vercel function logs.
5. Supabase environment variables and database errors.

### 19.6 Common failures

| Symptom | Likely cause | First action |
|---|---|---|
| PWA icons missing | Missing files or incorrect static routing | Check asset URLs and `vercel.json` |
| Feed is empty | Singular `/api/article` path returns 404 | Change to `/api/articles` |
| Offline feed disappears | Service worker reports empty data as success | Fix the network-first fallback |
| Push tap does not navigate | Missing `navigate` message handler | Implement validated navigation |
| Credit balance is wrong | Vercel and Render write concurrently | Consolidate credit handling |
| Render requests are blocked | Incorrect CORS origin | Correct `ALLOWED_ORIGINS` |
| Wakeup returns 401 | Secret mismatch | Check both secret configurations |
| Wakeup returns 500 | Supabase configuration or runtime failure | Inspect Vercel logs |
| Scraper queue is stuck | Jobs remain in `processing` | Recover stale jobs |
| Article social card is generic | Dynamic OG route missing or failing | Verify `/api/og-image` |

### 19.7 Recovery: feed stuck on cached data

1. Update the frontend to use `/api/articles?action=list`.
2. Update the service worker's feed URL to match.
3. Ensure genuine network failures do not return a successful empty response.
4. Redeploy Vercel.
5. Bump the service-worker cache version if required.
6. Test both online and offline behavior.

### 19.8 Recovery: push notifications do not navigate

1. Inspect the `notificationclick` handler in `sw.js`.
2. Confirm the target URL is included in notification data.
3. Add a matching message handler to the main page.
4. Validate message origin and URL before navigating.
5. Redeploy and test with both an open tab and a closed app.

### 19.9 Recovery: scraper jobs are stuck

The following SQL is a manual recovery example. Run it only after verifying that the affected jobs are genuinely stale and not still being processed.

```sql
UPDATE processing_jobs
SET
  status = 'pending',
  current_stage = 'fetch'
WHERE status = 'processing'
  AND started_at < now() - interval '15 minutes';
```

Before running this in production, confirm that:

- `started_at` and `current_stage` match the actual schema.
- Reprocessing is idempotent.
- No active worker still owns the jobs.
- The operation will not cause duplicate charges or duplicate article records.

The long-term fix is atomic job claiming plus lease-based stale-job recovery.

### 19.10 Recovery: credit inconsistencies

1. Identify every function that modifies `users.credits`.
2. Choose one authoritative credit service.
3. Make balance changes and ledger inserts atomic.
4. Review failed jobs for eligible refunds.
5. Reconcile `credit_transactions` with user balances.
6. Add tests for simultaneous generation requests and insufficient balances.
7. Redeploy both services and monitor the next credit transactions.

### 19.11 Recovery: wakeup schedule stops

1. Open GitHub → Actions → EasyRead Wakeup.
2. Inspect the most recent workflow run and logs.
3. Check the configured schedule flags.
4. Verify that GitHub Actions has not disabled the workflow due to repository inactivity.
5. Confirm the wakeup secret is available to the workflow.
6. Trigger `workflow_dispatch` manually.
7. Verify the new heartbeat in Supabase.

---

## Final Notes

EasyRead's core design separates user-facing interactions from expensive, long-running processing. Vercel serves the experience and APIs, Render handles AI processing and scraping, and Supabase stores the shared application state.

The highest-priority engineering work is to strengthen authentication, centralize credit accounting, repair the article feed endpoint, and make background processing resilient to crashes.

These changes will improve correctness and security without requiring a complete architectural rewrite.

<div align="center">

### EasyRead

**Knowledge, Simplified.**

Understand more. See it differently. Keep learning.

[Open EasyRead](https://easytoread.vercel.app)

</div>
