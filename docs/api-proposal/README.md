# Contract spike — not a production API

This directory is an independently typechecked, pure TypeScript proposal. Production imports none of it. No renderer, transport, server legality, persistence, replay or migration capability is implemented here.

The [canonical API contracts](../ENGINE_API_CONTRACTS.md) define the wider proposal and its implementation gates.

First public migration: `PublicDecisionV1` = commands or finite-choice. `NumberDecisionPrototype` is gated until amount domains, typed action construction and authoritative server validation are integrated. Structured card-and-target candidates are explicit prototypes; they cannot be passed as an executable V1 decision.

Run from repository root:

```sh
web/node_modules/.bin/tsc -p docs/api-proposal/tsconfig.json
node --experimental-strip-types docs/api-proposal/decision.test.ts
```

The strict compiler check includes five negative `@ts-expect-error` fixtures. The runtime file runs 22 pure checks. It deliberately uses no dependency installs or test-runner changes.

## Decisions exercised

- Finite decisions carry a complete `variants` relation with `initialValues`, reconciliation and unavailable-submit policy, not `dependsOn` hints or an implicit Cartesian product. One tuple maps to exactly one command. Distinct actions with identical display labels remain distinct through IDs and a variant dimension, or are offered directly as commands.
- On edit, pin the explicitly changed field even if it is a later field. Consider only complete rows with enabled options and actions. Grow a supported prefix in declared field order: preserve each previous value if feasible; otherwise immediately commit the first supported option in declared option order. Later fields cannot change that prefix. Relation insertion order has no significance. An unsupported edit returns null. Structural default validity is separate from current eligibility: disabled defaults remain valid, all-disabled decisions return unavailable, and pure initialization/replacement honors reset/preserve policy.
- Descriptor validation never invokes action factories. Numeric materialization happens only after a current-offer and domain check at submission. The production controller must still capture intent/context, own its transport port and perform authoritative guarded dispatch; this helper is not that controller.
- Finite commands keep explicit intents. No single remaining command is promoted to primary automatically.
- Numeric values use safe integers. Stepped domain congruence uses an explicit origin and exact BigInt arithmetic. Exceptional short all-in is a separate offered command, not an interpolation point in a raise range.
- Visible card references carry projection scope. Anonymous backs carry no reference. Unknown-count piles carry no count. These compile-time shapes do not establish projection security: the server projection/serialization, diagnostics, DOM, accessibility, caches and replay must all be tested separately. A CardRef scope string is not a security credential.
- Ready/pending/failed evaluation results are explicit. A current-context check rejects replies from obsolete attempts, drafts, environment, presentation or privacy generation. This is a correlation guard, not server authorization or a complete evaluation scheduler. Candidate tokens are opaque; only an authoritative backend can bind and validate them against the exact candidate and revision.
- Compile-time Hoola fixtures represent card ordering, target endpoint and wildcard role in one candidate; OneCard fixtures represent seven-plus-suit coupling and separate ordinary/catch opportunities; poker fixtures represent multiple pools and split awards. These are representability examples, not counted runtime game-family tests or proof of joint-domain validation.

## Remaining integration work

`validateDecision` is a semantic validator for typed descriptors, not a JSON decoder. Untrusted external objects require a strict codec that rejects unknown/irrelevant fields; `never` currently enforces those distinctions only at TypeScript boundaries. Real validators also need unique/nonempty scope/opportunity identities, resource-reference integrity and bounded descriptor sizes.

The independently shaped `Offer` is intentionally not the production `ActionOffer`: production number actions currently use min/max/step/initial without this explicit domain/origin contract. Adapters must validate that conversion rather than cast. The numerical/reconciliation subset does not validate readable labels/accessibility/disabled reasons: labels remain optional here and must be mandatory/validated in production UI-facing descriptors. Public API finalization must align those, branded scope/reference construction and typed game action bindings with the canonical proposal. `submit.unavailable` is represented but no rendering behavior is implemented.

Do not count these checks as server, browser, privacy, race arbitration, motion or persistence acceptance. The four family fixtures demonstrate representability only; they do not prove complete support for those games or all variants.
