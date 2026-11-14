# Inkwell

A full-stack publishing platform inspired by the [RealWorld](https://github.com/gothinkster/realworld) spec: write articles in Markdown, tag them, comment, favorite, and follow other writers to build a personal feed.

**Stack:** React 19 + React Router (Vite) · Node.js + Express 5 · PostgreSQL · JWT authentication

## Features

- Sign up, sign in, and edit your profile (JWT auth, bcrypt-hashed passwords)
- Create, edit and delete articles written in Markdown, with tags
- Comment on articles; favorite articles; follow authors
- Global list, personal "Following" feed, tag filter, author and favorites pages, all paginated
- Authorization: only the author can edit or delete their article or comment
- Input validation on every endpoint with field-level error messages
- 21 integration tests that run against a real PostgreSQL database

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

Starts a throwaway PostgreSQL, applies the migrations, and runs the API tests in `server/test/api.test.js`.

## Project structure

```
inkwell/
├── server/
│   ├── migrations/001_init.sql   database schema (7 tables)
│   ├── src/
│   │   ├── server.js             entry point: run migrations, start listening
│   │   ├── app.js                Express app: middleware + routes
│   │   ├── config.js             environment variables
│   │   ├── db.js                 connection pool, query(), transaction()
│   │   ├── migrate.js            applies .sql files once, in order
│   │   ├── middleware.js         JWT auth, validation, error handling
│   │   ├── articles.service.js   all SQL for articles, comments and tags
│   │   └── routes/               auth.js, profiles.js, articles.js
│   ├── scripts/                  with-db.js (dev/test database), seed.js
│   └── test/api.test.js          integration tests
└── client/
    └── src/
        ├── main.jsx, App.jsx     bootstrapping, routes, header
        ├── api.js                fetch wrapper (token + errors)
        ├── auth.jsx              AuthContext: who is signed in
        ├── components/           ArticleList, small shared pieces
        └── pages/                Home, AuthPage, Editor, Article, Profile, Settings
```

## API

All routes are under `/api`. Send `Authorization: Bearer <token>` for routes marked 🔒.

| Method | Route | What it does |
|---|---|---|
| POST | `/auth/register` | Create an account, returns `{ user, token }` |
| POST | `/auth/login` | Sign in, returns `{ user, token }` |
| GET / PUT | `/auth/me` 🔒 | Read / update the signed-in user |
| GET | `/profiles/:username` | Public profile |
| POST / DELETE | `/profiles/:username/follow` 🔒 | Follow / unfollow |
| GET | `/articles?tag=&author=&favorited=&limit=&offset=` | List articles, newest first |
| GET | `/articles/feed` 🔒 | Articles by people you follow |
| POST | `/articles` 🔒 | Create an article |
| GET | `/articles/:slug` | Read one article |
| PUT / DELETE | `/articles/:slug` 🔒 | Edit / delete (author only) |
| POST / DELETE | `/articles/:slug/favorite` 🔒 | Favorite / unfavorite |
| GET | `/articles/:slug/comments` | List comments |
| POST | `/articles/:slug/comments` 🔒 | Add a comment |
| DELETE | `/articles/:slug/comments/:id` 🔒 | Delete a comment (author only) |
| GET | `/tags` | Most-used tags |

Errors always look like `{ "error": { "message": "...", "details": { "field": "reason" } } }`.
