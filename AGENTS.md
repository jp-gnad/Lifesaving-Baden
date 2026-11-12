# Working in Lifesaving Baden

## Start here

- Read [docs/architecture.md](docs/architecture.md) for entrypoints, module ownership and data flows.
- Read [docs/security-and-compatibility.md](docs/security-and-compatibility.md) before changing authentication, persistence or Firestore access.
- Use [docs/development.md](docs/development.md) for installation, commands and test selection.
- Inspect `git status --short` before editing. Preserve changes made by the user or another active task.

## Runtime and project boundaries

- This is a static HTML/CSS/JavaScript site served from GitHub Pages, including under a repository subpath. There is no production Node server, bundler or build step.
- Node packages and Python requirements are development/maintenance tools only. Do not import `firebase-admin`, Node built-ins or credentials into browser code.
- Keep existing public HTML URLs, timer hash routes and installation identities working. `startberechtigungen.html` and `timer/login.html` are intentional compatibility redirects.
- The live project is `lifesaving-baden`. Tests use local emulator hosts and `demo-*` projects only. Never run a production sync, account migration or deployment as a test.
- The user requires free Firebase usage. Do not enable billing, change the Firebase plan or introduce paid services. Avoid full-collection reads inside searches, loops and normal save handlers.

## Module ownership

- `assets/js/auth-core.js`: authentication/session primitives, account setup and authoritative role loading.
- `assets/js/login.js`, `google-handoff.js`: shared login and recovery across app/browser navigation.
- `assets/js/auth.js`: member/account/profile/link-request UI and page initialization.
- `assets/js/admin-accounts.js`: account administration factory, receiving explicit callbacks from `auth.js`.
- `assets/js/*-core.js`: reusable domain calculations; keep them independent from DOM and database access.
- `assets/js/*-store.js`: database mutations and transaction invariants for clubs, links and worktime.
- `timer/core.js`: shared, immutable discipline definitions and timing/formatting functions used by UI and adapter.
- `timer/firestore-api.js`: timer authentication, Firestore adapter, permissions and view-scoped caches.
- `timer/result-feed.js`: one visible, bounded result-page listener; paging, visibility cleanup and explicit full-export traversal.
- `timer/participant-store.js`: atomic participant/identity writes and legacy index migration.
- `timer/views/people.js`: participant view factory. Pass dependencies explicitly; do not reach into another view's private state.
- `timer/offline-store.js`: IndexedDB persistence only. Queue synchronization stays in `timer/app.js`.
- `timer/results-pdf.js`: PDF export factory, independent from route/stopwatch state.
- `timer/app.js`: route orchestration, stopwatch and result views. Prefer extracting a coherent feature over growing this entrypoint.
- `tools/lib/`: pure maintenance planning and credential/project guards. Maintenance CLIs stay in `tools/`.

## Safe implementation conventions

- Follow the existing small factory / `*-core` / `*-store` patterns. A framework migration is not needed to add a feature.
- Browser scripts use `defer` and named `window` namespaces. Pure modules also support `module.exports` for Node tests. Do not change the repository-wide module type.
- Keep factories free of initialization side effects. Entrypoints initialize them after their dependencies load.
- Do not treat hiding UI, cached profiles or client role checks as authorization. Firestore rules enforce access independently.
- Use `textContent`/DOM creation for user data. Where HTML templates are necessary, escape text and attribute values, including database IDs. Encode IDs used in URL path segments.
- Preserve session/account checks around asynchronous operations. An old response must not update the new user's or new route's view.
- Preserve transactional reservations for person links, participant identities, club responsibilities and overlapping worktime entries. Do not replace them with browser-only duplicate checks.
- Treat old fields, migrations, manifests, redirects and local storage names as compatibility contracts. Check persisted data and old installations before removing them; an old-looking name alone is not evidence of dead code.
- Never clear or rename the timer's IndexedDB database/store or pending submission IDs during cleanup. A pending result may have no other copy.
- Avoid raw credentials or full account documents in logs. Maintenance credentials must target the expected project and remain in environment variables.
- Reuse the existing view-scoped participant/search cache. Invalidate on route, account and role changes; do not use it to bypass current write authorization.

## Assets and checks

- When a browser module changes, update the affected HTML versioned script URLs and timer service-worker precache. `npm run check` checks both existence and exact cached URLs.
- Keep relative paths valid from root pages and `timer/`. Do not assume hosting at `/`.
- `npm test` runs structural checks, Node unit tests and Python integration tests, without live Firebase access.
- `npm run test:rules` runs the Firestore and club suites in a local demo emulator. Require real passes; skipped rule tests are not verification.
- For a module refactor, run its existing behavior tests and add tests for meaningful missing invariants, not assertions that merely repeat implementation details.
- For auth/store/rule changes, also run the emulator suites. For offline code, check transaction aborts and retention of pending results.
- Update the architecture/development documents when a module boundary, dependency or command changes. Keep the README's operational instructions accurate.
