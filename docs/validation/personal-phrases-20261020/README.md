# Synthetic Qwen probe records — 20 October 2026

See the [method, findings and limitations](../../PERSONAL_PHRASE_EVALUATION.md).

| Report | Purpose |
| --- | --- |
| [baseline-schema.json](baseline-schema.json) | Original prompt, configured strict JSON, two calls |
| [baseline-object-burst.json](baseline-object-burst.json) | Original prompt, JSON object, thirteen calls including observed 429s |
| [expanded-guidance.json](expanded-guidance.json) | First expanded instruction, five spaced calls |
| [expanded-guidance-v2.json](expanded-guidance-v2.json) | Longer exploratory instruction, fourteen spaced calls |
| [final-compact-guidance.json](final-compact-guidance.json) | Shipped compact instruction, fourteen spaced calls |
| [prompts.json](prompts.json) | Exact instructions and SHA-256 fingerprints for every phase |

All words, accepted histories, identifiers and reported texts are synthetic.
No user-profile data, API credentials, arbitrary headers or raw error bodies
are included. No experiment automatically accepted a new interpretation or
changed the deployed configuration. The initial records have fewer diagnostic
fields because instrumentation was expanded during the investigation; absent
fields are unknown, not reconstructed HTTP observations.

Pipeline baseline: `9f871b20cac4e9a15e3ab460e5818fd1d7404d24` (after PR #108).
The model is stochastic. These captures document these calls and do not establish
a general accuracy rate. All phases, including unsuccessful ones, remain available
so that the final result can be reviewed without selecting only favourable cases.
