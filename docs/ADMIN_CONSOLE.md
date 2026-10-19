# Administrator console

The console groups existing account, profile, provider and profile-audit tools.
It adds navigation and read-only views; it does not change PCL decisions, grants,
database schemas, provider configuration or server deployment.

```text
Administration
  |
  +-- Overview -------- API response / declared database / Redis status
  +-- Profiles -------- existing profile tools and exports
  +-- Accounts -------- existing account and profile-grant controls
  +-- AI provider ----- existing metadata check, no phrase generation
  +-- Audit ----------- select ONE profile
  |                       +-- existing PCL audit
  |                       +-- existing AI-quality diagnostics
  +-- Maintenance
          +-- browser actions: profile export / restore into a new profile
          +-- server procedures: encrypted backup / delivery / local HTTPS

Separate destinations: Accompaniment / Communication
```

## Routes and behavior

The persistent navigation indicates the current console section, including deep
profile audit/AI-quality links and profile restoration. A keyboard skip link
reaches the console content. On mobile, a keyboard-operable toggle shows the
current section and expands the navigation links on request. The desktop sidebar
can scroll on short screens. Existing routes and links continue to work.

`/admin` reads the existing `/health` and `/readiness` endpoints. Each refresh
discards the prior snapshot; independent failures remain explicit. API health
means the HTTP process responds. The current readiness API reports PostgreSQL
configuration, **not a successful database query or recovery test**. Redis status
comes from the existing transient-store health check. The view records the local
read time and does not poll, invoke the AI provider or inspect personal messages.

`/admin/audit` lists profiles with search and ten cards per page. The operator
opens the existing audit or AI-quality view for one profile. This page does not
claim to aggregate every profile's events or to provide a global account/security
audit. Failed profile refreshes hide previous cards until a successful retry.

The existing `/admin/providers` view now discards prior health information during
refresh and after failure, and cancels abandoned reads. Provider health consults
metadata; a compatible provider can contact its configured models endpoint. It is
not a phrase-generation or quality test. API keys remain server-side.

`/admin/maintenance` distinguishes real browser actions from documented server
operations. Links open existing profile export/restoration tools or public server
procedures. This page never reports a backup as successful, displays a fabricated
last-backup date, runs commands, restarts services or starts a server recovery.

## Access and validation

Existing authentication gates protect all console routes before loaders mount.
Supporters and communicators retain their granted spaces and cannot open these
pages by changing a URL. The backend's existing administrator-only provider and
account controls remain authoritative. Local authentication-disabled operation
keeps the console but hides account-management links.

The isolated PCL workflow tests real authenticated administrator and limited-user
journeys, actual profile audit reads, search/pagination, stale-success removal on
service/provider/list failures, recovery, maintenance destinations, local mode,
mobile reflow and unchanged PCL collections. Screenshots contain synthetic data.
Existing account/grant, accompanied-session and communication regressions still
run. No participant usability session or deployment is claimed by this increment.
