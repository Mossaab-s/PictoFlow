# Protected accompanied access

An authenticated adult can open **Confier le clavier à cette personne** on a
profile's preparation/support pages, then explicitly start an accompanied session.
The account must currently be an administrator or have `communicate` on that
profile. Preparation alone does not authorize communication.

```text
Authenticated adult -> chooses an authorized profile -> confirms handoff
                                                     |
                      close old screens in all browser tabs
                      erase local offline copies and message references
                                                     |
                  POST /api/v1/auth/accompanied {profile_id}
                      atomically replace this browser's cookie
                                                     |
                     one profile's communication screen
                                                     |
                  Return to support -> logout -> real login
```

## Server scope

Migration `0013_accompanied_sessions` adds a profile scope and a review ceiling to
`auth_session`. No personal PCL records or account grants change. Session rotation
uses the same database lock as account/grant changes. The previous token is
deleted, CSRF changes, and the replacement expires at the earlier of the original
session expiry and one hour. The cookie remains HttpOnly, SameSite=Strict and
Secure on HTTPS. Independent browsers retain their own sessions.

The effective session has no administrator power and contains only the chosen
profile. Its capabilities are `communicate` and, only if allowed at handoff,
`review_meanings`. Every request intersects these with current account rights;
losing communication access disables the whole accompanied scope. New grants do
not expand the stored review ceiling. Password resets, deactivation and expiry
continue to revoke sessions. Direct API calls cannot prepare a keyboard, export,
access administration, use another profile or create/import offline copies.
Another handoff from an already restricted cookie is forbidden.

`AccountView.assisted_profile_id` identifies the mode without inventing a person's
account. Access audit events retain the actual authenticating account, the target
profile and an `accompanied:` prefix on authorized PCL mutations. Start/end events
also record the handoff. Human feedback roles remain explicit choices; this mode
does not establish who expressed or confirmed a meaning.

Downgrading the migration deletes scoped sessions before dropping the columns,
so an accompanied cookie can never become an adult cookie after rollback.

## Browser handoff and recovery

A durable browser marker is required before handoff. A storage event and
BroadcastChannel close other tabs, and an access epoch rejects responses started
before the transition. API reads carrying an obsolete CSRF header also fail after
rotation. Restoring a page from browser back/forward cache hides its old contents
until the session has been checked again. This applies to browsers running the
current application; update/reload old application versions before handing over
a shared device.

Before the server handoff, the browser deletes both ordinary and encrypted offline
databases, offline shell caches and its local message references. In other open
tabs, local message references are cleared by the transition event. Offline writes
and vault unlocking reject the accompanied marker, and `/offline` cannot mount the
offline portal while it remains set. Saved PCL messages stay in PostgreSQL. The
handoff is refused if local cleanup cannot complete. Existing personal offline
flows remain available after a successful full login.

The first implementation is online-only. Already displayed words can still be
read by a local voice during a network interruption, but no accompanied offline
copy is prepared or reopened. It does not infer capacity, clinical state or the
identity of the person at the keyboard.

A failed or interrupted POST is never automatically repeated: the client reads
the current server session and accepts the handoff only if its profile scope is
confirmed. Otherwise it stays locked and requires login. A pending marker left
after a crash offers **Fermer l’accès et se reconnecter**. Ending or expiring a
session never restores adult rights. A successful login replaces the cookie,
clears remaining local copies and releases the local marker only after cleanup.

Requests already authorized before the handoff may finish on the server; the
browser rejects their late responses. The handoff does not undo prior accepted
work or cancel ongoing AI jobs. It is an application session boundary, not an
operating-system kiosk or protection against someone controlling browser storage.

## Verification

- PostgreSQL/API tests exercise rotation, live grant reduction, bounded expiry,
  direct API denial, old credentials, CSRF/origin checks, reauthentication and
  safe migration downgrade.
- Browser CI uses synthetic accounts on the authenticated API and checks two tabs
  with BroadcastChannel disabled, a delayed authorized response, local database
  and cache deletion, browser back, offline entry, composition and explicit
  confirmation, failed/successful login, empty committed response and revocation.
- Mobile/tablet screenshots contain only synthetic data. Unit tests cover routing,
  late-response fences and denial of ordinary/encrypted offline access.
