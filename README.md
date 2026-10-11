# <img src="docs/favicon.png" width="32" height="32" align="absmiddle" alt=""> gh-pull

much better github pr dashboard

A fast GitHub pull request dashboard with two authentication modes: use your existing GitHub CLI login locally, or sign in through a GitHub App. Both modes share the same UI and PR actions.

**[Open the hosted dashboard](https://gh-pull.up.railway.app/)** and sign in with GitHub—no local setup required.

If you can't get your organization's approval for the hosted GitHub App, you can [host it yourself in local mode](#local-mode) using your existing GitHub CLI login or a personal access token with access to your repositories. Your organization's token and SSO policies still apply.

Plain JavaScript, a CodeMirror query editor, and a Node server. No server runtime dependencies or build step to run the app; the editor bundle is checked in. A **GitHub.com** account is required; running it yourself also requires **Node.js 22+**.

![gh-pull dashboard showing fictional demo pull requests](docs/demo.png)

## Local mode

```sh
gh auth login
npm start
```

Open <http://localhost:3000>. Local mode is the default (`AUTH_MODE=local`). The server uses your GitHub CLI credentials, or `GH_TOKEN` / `GITHUB_TOKEN` if supplied. It binds only to `127.0.0.1`; credentials stay on the server.

`npm start` and `npm run dev` restart the server when backend files change. Reload the browser after frontend edits. Use `node server.js` to run without automatic restarts.

## GitHub App mode

Users select **Sign in with GitHub** and authorize the app. Each session has its own GitHub client and PR cache. This mode never uses the server owner's GitHub CLI credentials or personal token.

Register a [GitHub App](https://github.com/settings/apps/new) with its user authorization callback set to `PUBLIC_URL/auth/callback`. For local development, use `http://localhost:3000/auth/callback`. Create a client secret and configure the app:

```sh
cp .env.example .env
# Set AUTH_MODE=github-app and fill in the GitHub App settings in .env.
node --env-file=.env server.js
```

`.env` is ignored by Git. `npm start` reads environment variables already set in your shell; it does not load `.env` automatically.

Repository permissions for the full feature set:

| Permission | Access | Purpose |
| --- | --- | --- |
| Pull requests | Read and write | View PRs, edit titles, change draft status |
| Contents | Read and write | Merge PRs |
| Checks | Read-only | Check results and progress |
| Commit statuses | Read-only | Commit status results |

Metadata read access is included by GitHub. Read-only Pull requests and Contents permissions can be used if write actions are not needed; GitHub rejects writes without the corresponding permission.

Keep user access token expiration enabled. An app private key and repository webhooks are not needed. The optional Marketplace webhook is described below. Leave “Request user authorization (OAuth) during installation” disabled: sign-in starts from the dashboard with browser-bound state and PKCE.

Install the app on the repositories it should access. Private repositories must be accessible to both the app and the signed-in user; organization access may require administrator approval or an active SSO session. Set the optional app slug to enable **Install GitHub App** and **Manage repository access** links. Installation and repository approval take place on GitHub; return here and refresh afterward. See [GitHub's authorization documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_MODE` | `local` | `local` or `github-app` |
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind address in GitHub App mode; local mode always uses loopback |
| `GH_TOKEN` / `GITHUB_TOKEN` | GitHub CLI login | Local-mode authentication |
| `PUBLIC_URL` | — | Required in GitHub App mode; public origin without a path |
| `GITHUB_APP_CLIENT_ID` | — | Required in GitHub App mode; client ID, not app ID |
| `GITHUB_APP_CLIENT_SECRET` | — | Required in GitHub App mode; kept on the server |
| `GITHUB_APP_SLUG` | — | Optional app slug for the repository access link |
| `GITHUB_MARKETPLACE_WEBHOOK_SECRET` | — | Optional shared secret for signed Marketplace deliveries in GitHub App mode |

`PUBLIC_URL` requires HTTPS, except for HTTP localhost development. Its host must match incoming requests, and its `/auth/callback` URL must match the GitHub App registration. Use the same hostname throughout login; `localhost` and `127.0.0.1` are distinct.

## Marketplace webhook

GitHub App mode provides `POST /webhooks/marketplace`. It requires `application/json` and a valid `X-Hub-Signature-256` computed with `GITHUB_MARKETPLACE_WEBHOOK_SECRET`. Configure the same secret in the Marketplace listing's webhook settings. Without the secret, the endpoint returns 503; local mode returns 404. This endpoint uses signature authentication rather than browser cookies; browser API origin checks remain in place.

The handler accepts signed `ping` events and effective purchases/cancellations for **free plans**. Purchases need no additional entitlement: users install the app and sign in through the existing OAuth flow. Use `PUBLIC_URL/auth/login` as the Marketplace setup URL. Paid plans, trials, and plan changes are not implemented and unsupported purchase actions return 422.

Cancellations immediately disable matching in-memory sessions and clear their PR caches, then revoke their GitHub user tokens. Matching includes the purchasing user's numeric GitHub ID and sessions known to have accessed the account's repositories. Organization matching uses repository owners observed by this process, not an organization membership directory. This ends existing sessions; it does not prevent a later sign-in to the free dashboard or uninstall the GitHub App.

Delivery IDs and payload hashes are kept in memory for 24 hours (up to 1,000 entries), with expired entries removed on subsequent deliveries. Duplicate deliveries share processing. Failed revocations return an error and retain inaccessible credentials until retry or session expiry. Monitor failed deliveries and [redeliver them from GitHub](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks); GitHub does not automatically retry. State is process-local and lost on restart: this is not a durable billing system or a shared queue for multiple instances.

## Features

- **Query search:** Search GitHub with highlighted qualifiers and autocomplete. Show, State, and Sort are synchronized shortcuts for the query; queries and grouping are shareable through the URL.
- **Grouping:** Group results by repository, author, status, or checks; collapse groups while preserving GitHub's query order within each group.
- **PR details:** Authors, reviewers, review decisions, labels, changed-line counts, source branches, and update times. Authors and reviewers have consistent colors saved in this browser.
- **Check progress:** Pending badges show passed/total counts, such as **Checks pending · 1/8**. Only successful checks count as passed; skipped and neutral checks do not. Failed-check badges link to GitHub's checks page.
- **Background refresh:** Refreshes 60 seconds after each load finishes. The circular refresh icon shows the countdown in its center and tooltip, and spins while fetching, with the button disabled until the request finishes. Existing PRs stay visible until fresh data arrives, including when a refresh fails.
- **Viewed tracking:** New updates have brighter, bolder titles. Opening a PR, diff, or checks link marks the displayed update as viewed. Newer updates highlight it again; tracking is per GitHub account and synchronized across dashboard tabs.
- **Quick links and copying:** Open PRs, repositories, diffs, and user profiles in new tabs. Usernames keep their existing appearance and show a pointer cursor. Copy PR URLs or branch names with confirmation feedback.
- **Feedback:** Use **report an issue** in the footer to open this repository's GitHub issue form.
- **Appearance:** Responsive layout, keyboard-accessible controls, and system light/dark colors.

### Query search

The default query is `is:pr is:open involves:@me sort:updated-desc`. Add qualifiers such as `repo:owner/repository`, `author:octocat`, `-label:wip`, or `label:"good first issue"`, and press **Enter** or **Search**. Free text follows GitHub's search semantics (title, body, and comments by default); it no longer filters just the loaded rows.

Type a qualifier or press **Ctrl+Space** for suggestions. Use arrow keys to choose, Enter or Tab to accept, and Escape to dismiss. When a suggestion is selected, Enter accepts it; press Enter again to search. Repository, user, branch, and label suggestions come from loaded PRs, and you can type values that aren't suggested.

Changing Show, State, or Sort rewrites that part of the query and searches immediately. A dropdown shows **Custom** when the query doesn't match one of its presets. Show replaces author/involvement/review-request qualifiers; State replaces state/draft qualifiers; unrelated terms stay intact. Closed means closed and unmerged. Group by only changes presentation.

Unsubmitted edits stay in the editor while automatic refresh and pagination use the last applied query. Only applied queries are saved in the URL. Qualifiers, exclusions, and quoted phrases are supported; Boolean operators and parenthesized groups are not yet supported. Named saved queries are not implemented yet.

### PR actions

Actions apply to your own PRs and require GitHub write permissions:

- **Edit a title:** Select the pencil icon. Save or Enter submits; Cancel or Escape discards. Titles must be 1–256 characters on one line. Failed saves retain the draft, and the server checks whether the title changed on GitHub before updating it.
- **Change draft status:** Select **Open** to convert a PR to draft, or **Draft** to mark it ready for review. A tooltip explains the action on hover. The badge changes after GitHub confirms, and merge readiness is rechecked automatically.
- **Merge:** Eligible PRs show a button with the repository's preferred merge method. The server rechecks permissions and readiness and pins the merge to the displayed commit. Drafts, blocked PRs, merge queues, and stacked PRs do not show this action. In GitHub App mode, a mergeable PR keeps a disabled merge button when installation access or Contents write permission is missing, with a tooltip and an installation/access link when available. Access is checked again before merging. Local mode skips installation checks.

If GitHub is still calculating mergeability, the dashboard rechecks in the background every two seconds, up to five times, without resetting loaded pages. The regular one-minute refresh continues afterward.

## Data and sessions

PRs load in pages of 50, with a 30-second server cache keyed by query and cursor. Manual and automatic refresh bypass the cache and reset pagination on success. Searches run against GitHub; grouping applies to loaded pages. All dashboard searches, including Created by me, expose at most 1,000 matches, with a notice when that limit applies. Narrow the query by repository or date to find more specific results.

Labels include the first ten per PR. Reviewers include up to 100 review requests and 100 latest reviews, with a GitHub link when more exist. Check status and counts describe the latest commit's check runs and commit statuses.

Browser storage holds name colors and account-specific viewed PR IDs/timestamps, not PR contents or credentials. Without browser storage, tracking lasts only for the current page. Reading PRs directly on GitHub does not mark them as viewed here.

GitHub App tokens remain on the server; the browser receives an opaque HttpOnly session cookie, marked Secure for HTTPS. Sessions last up to seven days, and expiring GitHub tokens refresh automatically. Sign out ends the dashboard session; app authorization can be revoked separately in GitHub settings.

Sessions, login attempts, and caches are held in memory in a single server process. Restarting ends sessions. A shared session store would be needed for multiple server instances. GitHub Enterprise hosts are not supported.

## Privacy and third-party services

See the [Privacy Policy](PRIVACY.md) for data handling, retention, and user controls, [Third-party services](THIRD_PARTY_SERVICES.md) for GitHub and Railway dependencies, and [Transparency disclosures](TRANSPARENCY.md) for security mechanisms and the scope of compliance claims.

## Verify

```sh
npm run check
npm test
```

Tests use Node's built-in test runner and mocked GitHub responses. They cover PR behavior, authentication, token refresh, session isolation, and request validation without credentials or network access.

Browser interaction tests use Playwright with isolated fixture PRs. They cover editing, draft/ready changes, merges, read tracking, clipboard feedback, query autocomplete and keyboard editing, synchronized presets, pagination, stale responses, background refresh, and light/dark mobile layouts. All mutations stay in the fixture server; external browser requests are blocked.

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

To use an existing Chrome installation instead, set `CHROME_BIN` to its executable path when running `npm run test:browser`. Browser screenshots are written to `/tmp/gh-pull-query-browser` (override with `BROWSER_ARTIFACT_DIR`).

After changing `scripts/query-editor.js` or updating its dependencies, run `npm run build:editor` and commit the generated bundle and license notices. `public/query.js` contains the shared query model and is loaded separately. CodeMirror, esbuild, and Playwright are development dependencies; running the server does not require installing them. The editor loads only after authentication.

## License

[MIT](LICENSE) © 2026 shiqicao. Third-party attribution and license terms are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
