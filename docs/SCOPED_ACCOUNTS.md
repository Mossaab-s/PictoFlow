# Account types and explicit management scope

An account identifies someone signing in. A patient communication profile contains personal meaning, vocabulary, memory and a keyboard. Account types and management links never create semantic evidence or validate an interpretation.

| Account type | Account management | Communication profiles |
| --- | --- | --- |
| Administrator | All accounts; global provider and maintenance controls | All profiles |
| Practitioner | Explicitly linked parents and patients | Explicit patient links, with selected capabilities |
| Parent | Explicitly linked patients | Explicit patient links, with selected capabilities |
| Patient | None | Their bound personal profile: communicate and review their phrases |

```text
Practitioner A -- manage --> Parent A -- manage + permissions --> Patient A
       `---------------- manage + permissions -------------------> | PCL A

Practitioner B -- manage --> Parent A
       `---------------- manage + permissions --> Patient B / PCL B

Parent A can have both patients. Neither practitioner inherits the other's patient.
```

## Creating and linking accounts

`POST /api/v1/auth/users` accepts `account_type` (`practitioner`, `parent` or `patient`). An administrator can create all three; a practitioner can create a parent or patient; a parent can create a patient. Non-administrator creators are linked to the new account atomically. A new patient receives a distinct, initially empty communication profile and their creator receives full support permissions for that new profile. Prepare the keyboard before inviting the patient to use it.

Only an administrator may supply `profile_id` to bind an existing, unbound communication profile to a new patient account. This preserves its existing personal memory. One patient account binds to one profile, and a profile can have only one patient account. The global administrator is created through the existing server console, never by selecting a browser role.

Account types are fixed when created in this first increment. The schema migration labels existing administrators and preserves other existing accounts as legacy accounts (`account_type: null`) with their exact existing grants. It does not guess whether a previous editor is a practitioner or parent. Legacy accounts continue using the administrator's explicit profile-grant interface. Newly typed accounts use relationships instead; legacy grant endpoints reject them, preventing hidden access from surviving an unlink. Classifying an existing legacy account is a separate migration workflow, not an automatic promotion.

`GET /api/v1/auth/users` returns all accounts to the administrator and only direct managed accounts to a practitioner/parent. `GET /api/v1/auth/management-links` returns only visible links. A shared parent's other patient IDs and profile permissions are removed from these scoped list responses.

`PUT /api/v1/auth/users/{manager_id}/links/{dependent_id}` requires:

```json
{
  "linked": true,
  "expected_linked": false,
  "capabilities": ["communicate", "review_meanings", "prepare_keyboard"],
  "expected_capabilities": null
}
```

Patient links require explicit profile capabilities. Practitioner-to-parent links use `capabilities: null` and confer account management only. Unlinking uses `linked: false`, `capabilities: null` and the previously read state. Stale writes return 409.

The administrator assigns existing accounts to a manager. A practitioner can link one of their already managed parents to one of their already managed patients. Managers cannot claim an arbitrary existing account by guessing its identifier. Delegated capabilities must be a subset of the actor's own current permissions, including when reducing or removing an existing link. A manager may reduce or revoke their own existing links, but cannot subsequently reclaim an unlinked account without administrator assignment.

## Account-wide actions and revocation

Password reset and suspension require a direct management link and authority over **all** of the target account's current profile permissions. This prevents resetting a shared parent's password to gain access to another family. Use the global administrator for shared accounts whose full scope exceeds one practitioner's rights. Existing last-administrator protection, password rules, secure cookies, CSRF checks and session revocation continue to apply.

Relationship edits and account actions share the existing PostgreSQL transaction lock; the repository rechecks live scope inside the transaction. Grants are computed from current links on every authenticated request. An unlink removes access on the next request, including for an already-open accompanied session, without deleting its PCL. Links to different accounts are independent: unlinking a parent does not implicitly unlink a separately assigned patient.

Patients retain the explicit choice to confirm or refuse phrases. They cannot prepare keyboards, export profiles, administer accounts or configure AI. Accompanied sessions never gain account-management permission from the underlying adult's account type.

## Validation

Integration tests cover two unrelated families, shared parents, administrator-only binding of existing profiles, role elevation attempts, stale writes, CSRF, accompanied sessions, live revocation, permission ceilings, atomic account/profile creation, patient communication and explicit confirmation. Migration tests preserve legacy grants and PCL rows and reject downgrading configured roles/relationships. All test identities and messages are synthetic.
