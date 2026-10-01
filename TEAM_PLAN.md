# Team Plan: Abhedya-Chakra (3 people, working in parallel)

The detailed plan is in [`plan/`](plan/). If this summary and those files disagree, `plan/` wins.

| Person | Brief | Owns | Jury weight carried |
|---|---|---|---|
| **A** (main PC, integrator) | [plan/A_ENGINE.md](plan/A_ENGINE.md) | Ingest, validation, graph, victim trace, ring, API wiring, merges, demo machine | 40% trace + 10% engineering |
| **B** | [plan/B_DETECTION.md](plan/B_DETECTION.md) | Features, risk score, exports, ground truth + evaluation, synthetic test data | 30% precision/recall |
| **C** | [plan/C_UI_DOCS.md](plan/C_UI_DOCS.md) | React + Cytoscape UI, case diary, per-bank notices, LLM narrator + validator | 20% documents + the visual part of the 40% |

**Everyone reads:** [plan/00_OVERVIEW.md](plan/00_OVERVIEW.md) (repo layout, execution order, contracts, API, sample trace, timeline) and [DATA_HANDLING.md](DATA_HANDLING.md).

**Milestones** (hours from start):

| Milestone | Hour | What's done |
|---|---|---|
| M0 | 1 | Repo + contracts pushed |
| M1 | 6 | Trace live, detection v1, UI and documents on the sample trace |
| M2 | 14 | UI on the live API, risk on the full file, documents end to end |
| M3 | 22 | Full run on the main PC |
| Freeze | 28 | Bug fixes and rehearsal only |
