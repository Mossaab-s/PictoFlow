# Explicit profile capabilities

This is the access foundation for the three-space UX proposal in #76. It extends
existing accounts and sessions without changing personal PCL records or services.

| Capability         | Authorized task                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `communicate`      | Compose/import a draft, request optional formulation, propose from personal memory and read communication data  |
| `review_meanings`  | Confirm, correct or reject a profile interpretation                                                             |
| `prepare_keyboard` | Prepare/review drawings and touches, arrange pages/positions, rename the profile and configure phrase shortcuts |
| `manage_meanings`  | Create/change concepts, manage semantic relations and decide vocabulary-gap proposals                           |
| `view_history`     | Read profile history and semantic evidence                                                                      |
| `export_profile`   | Download the existing complete profile backup                                                                   |

These authorize operations, not professional titles. Feedback `actor_role` never
grants permission. Parents/practitioners can have different sets per profile.
The compatible `communicator` preset contains communication and interpretation
review; the compatible `editor` preset contains all six capabilities. `is_admin`
retains administration. An explicit capability map overrides legacy role labels;
a missing entry grants no profile operation. No profile capability permits memory
erasure or the technical AI-quality endpoint: these are now administrator-only.

Common touch/communication reads support the existing components. Communication,
review, preparation and history retain the existing communication collections they
use. This increment does not claim field-level redaction of the memory DTO or
replace the planned readable supporter/communicator views. Export-only access
allows profile identity and backup, without composition or general sequence reads.

## Session and grant API

The session and administrator account list include `account.profile_capabilities`
alongside compatible `profile_access`. FastAPI uses persisted capabilities on
every request, with existing cookies, origin/CSRF checks and profile isolation.
Unknown operations deny by default. Grant changes affect existing sessions on the
next request. Browser navigation, preparation links and review controls mirror
these permissions; a compatibility fallback for old session payloads is never an
HTTP authorization fallback.

The administrator's **Comptes et accès** screen offers presets and individual
checkboxes per profile. Clearing every checkbox removes the assignment.

```http
PUT /api/v1/auth/users/{user_id}/profiles/{profile_id}/capabilities
Content-Type: application/json

{
  "capabilities": ["communicate"],
  "expected_capabilities": ["communicate", "review_meanings"]
}
```

Use `null` for no previous grant or explicit revocation. A present list must have
one to six distinct supported values. Empty, duplicate and unknown lists return 422. Order is not significant. Stale expected sets return 409. A role-only edit
cannot overwrite/revoke a customized grant using only the legacy role label;
use the capability endpoint with the last actual set instead.

## Migration and validation

`0012_profile_capabilities` backfills existing grants on `auth_profile_access`.
Communicators keep composition/feedback; editors keep preparation, meaning
management, history, review and export. Removing editor memory-erasure and
technical AI-quality access is an intentional administration boundary change.
No PCL table or accepted record is rewritten. Back up before migration as usual.

The database rejects empty, unsupported and null capability values. The API also
rejects duplicates and normalizes order. Downgrade refuses customized grants to
avoid converting a limited set to a broader legacy role. Review/remove customized
grants explicitly before downgrade. Older code restores its older authorization
policy; it cannot preserve the new admin-only maintenance boundary.

Policy tests cover independent capabilities and deny-by-default behavior.
PostgreSQL/API tests cover real cookies, CSRF, live revocation, forged roles,
stale edits, migration backfill/PCL preservation and unsafe downgrade refusal.
A separate authenticated CI browser checks the real admin checkbox editor,
composition without validation, explicit human acceptance after review is granted,
and denial of a stale action after revocation. Its guarded synthetic bootstrap is
test-only and is not included in server Docker images.

Three-space layouts and protected accompanied sessions are later increments.
This development change is not deployed before maintainer review and merge.
