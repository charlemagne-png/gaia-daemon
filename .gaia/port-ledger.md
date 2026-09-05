# Upstream port ledger

Contract → append-only; prior rows immutable. Verdicts → `STEAL` · `REJECT` · `ALREADY-PORTED` · `OURS-STRONGER`.

| date | feature | theirs commits | our landing commit | verdict class |
|---|---|---|---|---|
| 2026-09-05 | unified sidebar tree design | `7c7e831`, `2e5795d`, `a37afc6`, `e9cb2ad`, `267c61c` | `a081741` | STEAL |
| 2026-09-05 | funnel v2 → contract-before-exec + boot sweep + successor seals stolen; 250 ms polling rejected | `1a1a6e0`, `042dc1a`, `0fa5a20..5fa4f65` | `659b5a0..1560cb1` | STEAL |
