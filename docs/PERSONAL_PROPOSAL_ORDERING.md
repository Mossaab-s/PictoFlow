# Showing personal hypotheses before generic alternatives

When a model returns both a generic sentence and a more flexible sentence grounded
in an accepted association from the active profile, PictoFlow presents the eligible
personal hypothesis first. For example:

```text
Accepted association: "Maman, papa, j’aime manger à la maison. Je suis content."

Model proposals                    Displayed choices
generic, confidence 0.98       ->   1. personal, confidence 0.65
personal, confidence 0.99           2. generic, confidence 0.98
```

The personal score remains capped at the configured confirmation threshold. Its
position expresses relevance to this profile, not greater certainty about the
person’s intention. The handling state follows the first eligible choice; a
personal hypothesis at the confirmation threshold still requires confirmation.

Priority applies only to hypotheses that pass the existing grounding checks using
an accepted reference actually supplied to the provider. Generic candidates do not
receive priority merely because their request included personal examples. No
prompt, vocabulary filter, reference selection rule or confidence threshold changes.

Candidates below the refusal threshold remain excluded. Within each group, the
existing confidence and identifier ordering remains deterministic. The three-choice
limit applies after priority, and eligible generic alternatives remain available
within that limit. Without an eligible personal hypothesis, ordering is unchanged.

All displayed candidates remain proposals. Position never triggers speech,
acceptance or learning. The person can choose, correct or reject any available
choice, including selecting a generic alternative after rejecting the personal one.
The existing reference checks still run before persistence and first acceptance.

This change cannot recover a personal sentence that the provider did not generate,
or one rejected by the existing grounding controls. It does not establish semantic
accuracy for long selections; those cases still require evaluation.
