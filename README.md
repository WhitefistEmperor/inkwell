# Inkwell

![CI](https://github.com/WhitefistEmperor/inkwell/actions/workflows/ci.yml/badge.svg)

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
- 31 integration tests of our own against a real PostgreSQL: security (hashing, tampered tokens, SQL injection, private WebSocket delivery), data integrity (cascades, transaction rollback, idempotency), search, trending and notifications
- GitHub Actions runs both, plus a frontend build

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
| GET | `/articles?q=` | Full-text search, ranked by relevance, with a `snippet` per result |
| GET | `/articles/trending` | Top 5 by time-decayed engagement |
| GET | `/notifications` 🔒 | Latest notifications and unread count |
| POST | `/notifications/read` 🔒 | Mark all as read |

**WebSocket events** (Socket.io, same port, JWT in the handshake): `notification` to the recipient's private room; `comment:new` and `comment:deleted` to everyone who sent `article:join` for that article.

## Design

The interface is drawn as a ruled notebook page. A red margin line runs down the left; dates, authors and form labels hang in the margin, and the writing sits to the right of it. Rows are separated by pale blue rules instead of cards. Ink is the only colour: anything new (a comment that just arrived over the WebSocket, an unread notification, something you favorited) is shown in wet blue ink, and a live comment dries to blue-black over a few seconds. Type is Alegreya, a face with a pen-drawn build, with Alegreya Sans for the interface.

**The landing page.** Signed-out visitors arrive on a black cover with the wordmark and a diagonal shelf of 3D hardcover books (Three.js). The books are the 32 latest articles: each cover is drawn on a canvas from the article's title and author, with a colour and motif picked by hashing its slug. Books near the pointer rise in a wave driven by one damped spring per book, and clicking a book opens the article. Three.js is code-split, so it is only downloaded on this page. The same articles are listed as ordinary links below the cover, which is what screen readers and search engines get.

## Deploying to Vercel

The repository is ready to import as it is: `vercel.json` builds the React app as static files and runs the Express API as one serverless function (`api/index.js`).

1. On vercel.com choose **Add New, Project** and import this repository. Leave the build settings alone.
2. Under **Storage**, create a **Neon** PostgreSQL database and connect it to the project. That adds `DATABASE_URL`.
3. Under **Settings, Environment Variables**, add `JWT_SECRET` with a long random value.
4. Deploy. The first request applies the database migrations.

To add the demo articles to the hosted database, run the seed once from your machine with the hosted connection string in `DATABASE_URL`.

**What is different on Vercel.** A serverless function is frozen between requests, so it cannot hold a WebSocket open. The Vercel build therefore sets `VITE_REALTIME=off`: notifications are fetched every 30 seconds instead of pushed, and new comments appear on reload. Everything else, including search, trending and the official RealWorld suite's behaviour, is identical. For live updates, run `server/` on a host with long-lived processes (Render, Railway, Fly) and point the frontend at it.
