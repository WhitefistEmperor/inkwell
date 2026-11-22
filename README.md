# Inkwell

![CI](https://github.com/WhitefistEmperor/inkwell/actions/workflows/ci.yml/badge.svg)

**Live demo: https://inkwell-xi-three.vercel.app**

A full-stack publishing platform: write articles in Markdown, tag them, comment, favorite, and follow other writers to build a personal feed.

Inkwell implements the [RealWorld](https://github.com/realworld-apps/realworld) API spec and **passes the official RealWorld API test suite (13 files, 157 requests)**, which runs in CI on every push. On top of the spec it adds ranked full-text search, real-time notifications and comments over WebSockets, and a trending feed.

**Stack:** React 19 + React Router (Vite) · Node.js + Express 5 · PostgreSQL · Socket.io · JWT authentication

## Features

**RealWorld spec**
- Sign up, sign in, and edit your profile (JWT auth, bcrypt-hashed passwords)
- Create, edit and delete articles written in Markdown, with tags
- Comments, favorites, following authors
- Global list, personal feed, and filters by tag, author and favorites, all paginated
- Authorization: only the author can edit or delete their article or comment
- Validation on every endpoint, with errors in the spec's `{ "errors": { "field": ["message"] } }` format

**Beyond the spec**
- **Ranked full-text search** using PostgreSQL `tsvector` with a GIN index: title matches outrank body matches, word stemming, and highlighted snippets
- **Real-time over WebSockets (Socket.io):** notifications for follows, favorites and comments are pushed instantly, and comments appear live for everyone reading an article
- **Trending** list ranked by a time-decay score: `(favorites + 2·comments + 1) / (age_hours + 2)^1.5`

**Testing**
- The official RealWorld suite: `npm run test:spec`
- 34 integration tests of our own against a real PostgreSQL: security (hashing, tampered tokens, SQL injection, private WebSocket delivery), data integrity (cascades, transaction rollback, idempotency), search, trending, notifications, caching and the search cap
- A load benchmark at 100,000 articles (`npm --prefix server run bench`), described below
- GitHub Actions runs both, plus a frontend build

## Performance at 100,000 articles

`npm --prefix server run bench` seeds a throwaway PostgreSQL with **10,000 users, 100,000
articles (~150-word bodies), 296,000 tag links, 500,000 favorites, 300,000 comments and 299,000
follows**, starts the real server, and loads each read endpoint with
[autocannon](https://github.com/mcollina/autocannon) (20 connections, 10 s each). It also
measures WebSocket fan-out: 200 readers on one article, time from posting a comment over HTTP
until each reader receives it.

The first run exposed four slow paths. The fixes, all in `server/src/articles.service.js`:

1. **Paginate ids first, then build articles.** Every list built the full article (author,
   tags, favorite count, viewer flags) for each row *before* `OFFSET` threw it away, so page
   251 did that work 5,020 times. Now it picks the 20 ids first and builds only those.
   The count query also runs in parallel instead of after the page.
2. **Bounded search.** `ts_rank` has to read each match's `tsvector`, which for long bodies
   PostgreSQL stores compressed outside the row. A word in 35% of articles meant decompressing
   ~35,000 vectors per search. Search now ranks the 2,000 newest matches and caps
   `articlesCount` at 2,000 to match.
3. **Trending** counts favorites and comments with one `GROUP BY` instead of two correlated
   counts per article, and caches the ranked ids for 30 s. The articles themselves, with the
   reader's own flags, are always read fresh.
4. **Tags** are counted by id from the index and cached for 30 s. Writing an article clears
   the cache at once.

Same machine (Ryzen 7 5700U, 16 threads, Windows, Node 24) and the same seeded data for both
runs. Requests per second and latency in ms; no request failed in either run.

| Endpoint | req/s before | req/s after | p50 before | p50 after | p99 before | p99 after |
|---|---:|---:|---:|---:|---:|---:|
| `GET /articles` (page 1) | 257 | 629 | 77 | 30 | 95 | 41 |
| `GET /articles` (page 251) | 38 | 619 | 484 | 32 | 909 | 37 |
| `GET /articles?q=` (word in 35% of articles) | 10 | 127 | 1,938 | 139 | 2,276 | 974 |
| `GET /articles?q=` (two rarer words) | 97 | 191 | 174 | 103 | 1,405 | 172 |
| `GET /articles/trending` | 29 | 1,237 | 665 | 14 | 806 | 20 |
| `GET /tags` | 46 | 5,862 | 411 | 3 | 887 | 7 |
| `GET /articles?tag=` | 324 | 426 | 59 | 45 | 76 | 57 |
| `GET /articles/feed` (signed in) | 529 | 608 | 37 | 32 | 47 | 42 |
| `GET /articles/:slug` | 913 | 1,076 | 21 | 17 | 33 | 24 |
| `GET /articles/:slug/comments` (unchanged code) | 894 | 693 | 22 | 28 | 29 | 36 |

WebSocket fan-out to 200 readers (4,000 deliveries): p50 24 ms, p95 61 ms, p99 72 ms.

How to read this:
- The comments endpoint's code did not change, yet it moved by about 20% between runs. That
  is this machine's run-to-run noise, so treat differences under about 25% as noise.
  The large gains (page 251 ×16, trending ×43, tags ×127, common-word search ×13) are far
  outside it.
- The tags and trending numbers are mostly the cache. A cache miss costs one query of about
  90 ms (tags) or 240 ms (trending).
- The search cap changes behaviour. A search ranks only its 2,000 newest matches and never
  pages past them. Ranking every match exactly needs an index that can order by rank (the RUM
  extension) or a separate search engine. Hosted PostgreSQL usually offers neither.
- The seeded text is generated, so word frequencies are only roughly realistic.
- Raw results: `server/bench/results-before.json`, `server/bench/results-after.json`.

## Run it locally

You only need **Node.js 22+**. No database install is required: in development the server starts its own PostgreSQL (via the `embedded-postgres` package) and keeps its data in `server/.pgdata`.

```bash
npm run install:all
```

```bash
npm --prefix server run seed
```

```bash
npm run dev
```

Open http://localhost:5173. The seed step is optional; it adds two demo users (`meera@example.com` and `kabir@example.com`, password `password123`) and six articles.

> **Windows note:** keep the project in a short path such as `C:\projects\inkwell`. The embedded PostgreSQL binaries fail to start when the full path goes beyond Windows' 260-character limit.

To use your own PostgreSQL instead (local install, Docker via `docker compose up -d`, or a hosted one), copy `server/.env.example` to `server/.env` and set `DATABASE_URL`.

## Tests

```bash
npm test
```

```bash
npm --prefix server run test:spec
```

The first runs our own tests. The second downloads the official RealWorld Hurl files and runs them against the API. Both start a throwaway PostgreSQL and apply the migrations first.

## Project structure

```
inkwell/
├── server/
│   ├── migrations/               database schema, applied in order
│   ├── src/
│   │   ├── server.js             entry point: migrations, HTTP + WebSocket server
│   │   ├── app.js                Express app: middleware + routes
│   │   ├── config.js             environment variables
│   │   ├── db.js                 connection pool, query(), transaction()
│   │   ├── migrate.js            applies .sql files once, in order
│   │   ├── middleware.js         JWT auth, validation, error handling
│   │   ├── schemas.js            shared validation building blocks
│   │   ├── articles.service.js   all SQL for articles, comments, tags, search, trending
│   │   ├── notifications.service.js
│   │   ├── realtime.js           Socket.io rooms and events
│   │   └── routes/               users.js, profiles.js, articles.js, notifications.js
│   ├── scripts/                  with-db.js (dev/test database), seed.js, spec.js (official suite)
│   └── test/                     api.test.js, features.test.js, helpers.js
└── client/
    └── src/
        ├── main.jsx, App.jsx     bootstrapping, routes, header
        ├── api.js                fetch wrapper (token + errors)
        ├── auth.jsx              AuthContext: who is signed in
        ├── realtime.jsx          socket + live notifications state
        ├── components/           ArticleList, small shared pieces
        └── pages/                Home, AuthPage, Editor, Article, Profile, Settings, Notifications
```

## API

All routes are under `/api`. Send `Authorization: Token <jwt>` for routes marked 🔒. Request bodies are wrapped as the spec defines, for example `{ "user": { ... } }` or `{ "article": { ... } }`.

**RealWorld spec**

| Method | Route | What it does |
|---|---|---|
| POST | `/users` | Register, returns `{ user }` including a `token` |
| POST | `/users/login` | Sign in |
| GET / PUT | `/user` 🔒 | Read / update the signed-in user |
| GET | `/profiles/:username` | Public profile |
| POST / DELETE | `/profiles/:username/follow` 🔒 | Follow / unfollow |
| GET | `/articles?tag=&author=&favorited=&limit=&offset=` | List articles, newest first, with `articlesCount` |
| GET | `/articles/feed` 🔒 | Articles by people you follow |
| POST | `/articles` 🔒 | Create an article |
| GET | `/articles/:slug` | Read one article |
| PUT / DELETE | `/articles/:slug` 🔒 | Edit / delete (author only) |
| POST / DELETE | `/articles/:slug/favorite` 🔒 | Favorite / unfavorite |
| GET | `/articles/:slug/comments` | List comments |
| POST | `/articles/:slug/comments` 🔒 | Add a comment |
| DELETE | `/articles/:slug/comments/:id` 🔒 | Delete a comment (author only) |
| GET | `/tags` | Tags in use, most used first |

**Inkwell additions**

| Method | Route | What it does |
|---|---|---|
| GET | `/articles?q=` | Full-text search, ranked by relevance among the 2,000 newest matches (`articlesCount` is capped at 2,000), with a `snippet` per result |
| GET | `/articles/trending` | Top 5 by time-decayed engagement |
| GET | `/notifications` 🔒 | Latest notifications and unread count |
| POST | `/notifications/read` 🔒 | Mark all as read |

**WebSocket events** (Socket.io, same port, JWT in the handshake): `notification` to the recipient's private room; `comment:new` and `comment:deleted` to everyone who sent `article:join` for that article.

## Design

The interface is drawn as a ruled notebook page. A red margin line runs down the left; dates, authors and form labels hang in the margin, and the writing sits to the right of it. Rows are separated by pale blue rules instead of cards. Ink is the only colour: anything new (a comment that just arrived over the WebSocket, an unread notification, something you favorited) is shown in wet blue ink, and a live comment dries to blue-black over a few seconds. Type is Alegreya, a face with a pen-drawn build, with Alegreya Sans for the interface.

**The landing page.** Signed-out visitors arrive on a black cover with the wordmark and a diagonal shelf of 3D hardcover books (Three.js). The books are the 32 latest articles: each cover is drawn on a canvas from the article's title and author, with a colour and motif picked by hashing its slug. Books near the pointer rise in a wave driven by one damped spring per book, and clicking a book opens the article. Three.js is code-split, so it is only downloaded on this page. The same articles are listed as ordinary links below the cover, which is what screen readers and search engines get.

## Deploying to Vercel

The repository is ready to import as it is: `vercel.json` builds the React app as static files and runs the Express API as one serverless function (`api/index.js`).

1. On vercel.com choose **Add New, Project** and import this repository. Set **Application Preset** to **Other** so the repository's own `vercel.json` is used.
2. Under **Storage**, create a **Neon** PostgreSQL database and connect it to the project. That adds `DATABASE_URL`.
3. Deploy. The first request applies the database migrations and creates the JWT signing secret, which is stored in the database. To supply your own instead, set `JWT_SECRET` under **Settings, Environment Variables**.

To load the demo articles into the hosted site, run this once from your machine. It uses only the site's public API, so no database password is needed:

```bash
node server/scripts/seed-remote.js https://your-site.vercel.app
```

**What is different on Vercel.** A serverless function is frozen between requests, so it cannot hold a WebSocket open. The Vercel build therefore sets `VITE_REALTIME=off`: notifications are fetched every 30 seconds instead of pushed, and new comments appear on reload. Everything else, including search, trending and the official RealWorld suite's behaviour, is identical. For live updates, run `server/` on a host with long-lived processes (Render, Railway, Fly) and point the frontend at it.
