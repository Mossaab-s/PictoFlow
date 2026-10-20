# Memory-first interpretation and a 24-hour pending cache

An explicit phrase request resolves in this order:

```text
Completed selection in one profile
              |
              v
Exact accepted PCL alignment? -- yes --> Offer remembered phrases
              | no                      as NEW unvalidated choices
              v
Pending cache younger than 24 h? -- yes --> Re-offer eligible choices
              | no                          with fresh message IDs
              v
Ask the active provider with personal PCL history
              |
              v
Persist proposals in PostgreSQL; cache their IDs in Redis
```

## Matching and current limits

Direct memory reuse requires the same ordered block IDs, including repetitions,
the same sequence context, compatible declared context, and currently accepted
human feedback. Existing meaning-change checks exclude associations whose source
blocks or concepts have changed since acceptance. Frequency and recency rank up to
three distinct accepted texts from the bounded repository shortlist.

New proposals record their declared context. Older associations without recorded
declared context participate only when the current request has no extra declared
context. This compatibility rule cannot reconstruct missing historical context.

This first version matches exact personal alignments. Similar selections can still
inform AI generation through the existing personal-example retrieval; they do not
silently become exact remembered meanings. A model may express a request,
preference, observation or another intent. Improving the diversity and semantic
quality of those hypotheses is separate from this reuse mechanism.

## Pending cache

The default lifetime is **86,400 seconds (24 hours), from generation**. Reads and
replayed copies never extend it. Only retained provider proposals are cached;
literal fallbacks and provider failures are not. Redis contains a version, an
absolute expiry and up to three original interpretation IDs. It contains no phrase
text or API credentials. PostgreSQL remains the authority for all proposals and
human decisions.

The hashed lookup identity includes the profile, ordered selections with current
labels and meanings, sequence/declared context, selected semantic hints and memory
examples, confidence policy, prompt, active provider options and administrative
configuration version. The fixture provider also identifies its loaded fixture
content. API keys are excluded. An administrator saving a new configuration,
including rotating a key, increments its version and changes the cache identity.

A hit re-reads the PostgreSQL originals and their recorded provenance under the
profile lock. Candidates must still be pending, belong to this profile, and have
the matching cache origin and expiry. Replayed hypotheses retain their original
scores, personal references and priority, but receive new IDs for the new message.
Accepted memory is checked again after the Redis read, before replay.

Rejecting either an original or any replayed copy excludes that original's lineage
from further hits in the same cache entry. Other eligible alternatives remain
available. If none remain, the request can generate a new set. Refusal is not a
global ban on wording that the model might independently generate later.

Acceptance or correction creates the usual PCL reference, which precedes cache
lookup on the next compatible selection. Neither caching nor displaying a phrase
learns or validates it. Withdrawing or changing a memory reference blocks the
first acceptance of a dependent, still-pending memory hypothesis; rejection stays
available. An independently accepted later message remains its own reference.

## Explicit retry and availability

“Proposer d’autres phrases” sends `refresh: true` to the existing interpretation
endpoint. This bypasses direct memory reuse and the pending cache for that request,
while still supplying accepted history to the provider. It does not change an
existing human decision or automatically accept the result. The normal button
uses `refresh: false`, which is also the API default.

The optional “Sur quoi cette proposition s’appuie-t-elle ?” explanation identifies
cached pending choices. Remembered proposals use the existing personal-memory
label. Browser storage continues to retain IDs rather than message text.

When Redis is absent, malformed or unavailable, direct PostgreSQL memory reuse
still works; other requests generate normally or use the existing literal fallback.
A failed cache write does not make an AI response fail and is never presented as
a successful cache hit. Clearing a profile's transient namespace removes its cache.
Profile restore remaps recorded cache lineage IDs, but restores no Redis entries.

Concurrent misses may generate independently; distributed request coalescing is
not part of this increment. Cache matching is deliberately conservative when the
profile's selected memory or settings change.

## Verification

PostgreSQL scenarios cover cross-message replay, rejected copies, memory priority,
reference withdrawal, meaning changes, exact order/repetitions/context, malformed
entries, profile isolation, fixed expiry, explicit refresh, Redis outages and an
acceptance that occurs during a Redis read. A combined PostgreSQL/Redis scenario
checks the actual stored payload and non-sliding TTL. Browser CI exercises the
real Redis/FakeProvider path, correction into memory, explicit refresh and reopening
the result on a mobile viewport, without implicit acceptance.
