# PictoFlow administration (ADMIN-017)

Next.js 16 + TypeScript. Run from this directory with Node.js 22:

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:3000/admin/profiles`. The backend defaults to
`http://127.0.0.1:8000/api/v1`; set `PICTOFLOW_API_BASE_URL` in the ignored
`admin/.env.local` to change it. This variable is server-side. No database,
Redis or provider credentials belong in the administration environment.

The central client calls a same-origin proxy that forwards only PictoFlow API
routes. Its upstream is environment-configured; it forwards no client credentials
or cookies, never caches personal responses and exposes redacted error states.
Abort handling prevents stale profile responses from replacing a newer view.

Routes cover profiles, concepts, representations, semantic space, keyboard,
memory, suggestions, audit and provider health. Profile and concept creation and
gap detection are available as initial actions; other sections are API-backed
views. Memory proposals and validated memory can be viewed separately.
The administration does not duplicate PCL state-transition rules.

Verification:

```powershell
npm run format:check
npm run build
npm run typecheck
```

The Admin GitHub Actions workflow repeats these checks using `npm ci` and the
lockfile. This initial console does not include authentication, a final design
system or the production end-user communication interface, matching ADMIN-017.
