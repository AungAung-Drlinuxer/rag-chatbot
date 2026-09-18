# Semantica spike

An evaluation of [Semantica](https://github.com/semantica-agi/semantica) against this estate's
own knowledge base — built, measured, and surfaced in the app so the decision can be made on
numbers rather than on the vendor's description.

**Verdict so far: the plumbing works and the extraction is the problem.** Details below.

---

## What was built

| Piece | Where | Notes |
|---|---|---|
| Graph builder + JSON API | `spike_pipeline.py` | deterministic extraction, no LLM |
| Image | `Dockerfile` | `python:3.12-slim`, CPU torch |
| Deployment + Service | `10-deployment.yaml` | separate pod, **not** part of the backend |
| Read-only proxy | `backend/app/api/semantica_spike.py` | admin-only |
| UI | `desktop/src/features/semantica/` | page + `d3-force` graph + harness |

Two tables are written to the existing CNPG database, `semantica_entities` and
`semantica_relations`. Nothing else in the app reads them.

### Removing it

1. `kubectl -n rag-chatbot delete -f 10-deployment.yaml`
2. delete `backend/app/api/semantica_spike.py`, its two `main.py` lines, and
   `desktop/src/features/semantica/` + the four wiring lines (router, App, sidebar)
3. `DROP TABLE semantica_entities, semantica_relations;`

No other code path touches it.

---

## Measured results

Build over the live knowledge base — **229 articles, 0 errors**:

```
entities      2,144
relations     1,540
labels        PERSON 1966 · DATE 157 · UNKNOWN 18 · GPE 3
time          1,764 s  (~29 min, pattern extraction, 2 cores pegged)
provenance    2,144 / 2,144 entities carry page ids and source URLs
```

### The extraction result is the finding

An IT-operations knowledge base produced **1,966 entities labelled PERSON — 92% of the graph**,
and almost none of them are people:

| Entity | Labelled | Actually |
|---|---|---|
| Incident Manager | PERSON | a role in a runbook |
| Shield Advanced | PERSON | an AWS service |
| Management Console | PERSON | a UI |
| Safety Warning Do | PERSON | a sentence fragment |
| Escalation Criteria Escalate | PERSON | a heading fragment |
| 5432 | DATE | a port number |

The extractor joins adjacent heading words into single entities, so relations read like
`"Owner Platform Team Review Information Last" —[related_to]→ "2026"`, and `related_to` is
effectively the only predicate.

**This is the `pattern` extractor, not Semantica's best path.** `pattern` is regex-based and has
no domain model, so on IT prose it matches capitalised-word patterns and calls them persons.
Semantica also offers `ml` (spaCy NER) and `llm` methods, which were **not** evaluated here —
see *Not evaluated*.

### What does work

* **Provenance is real.** Every entity resolves to the KB page ids and source URLs that produced
  it — e.g. the entity `2026` maps to 60 articles and 60 URLs. Nothing in the app can do that
  today: `audit_log` records what the system decided, not which documents produced a fact.
* **The service is cheap and stable** — 768Mi–3Gi, ~2 cores while building, then idle. 1/1 Ready
  in ~10 s, no restarts.
* **A separate pod keeps the dependency cost out of the backend** — `pip install semantica`
  resolves to **155 packages**, including `torch`, `transformers`, `spacy`, `opencv-python`,
  `librosa`, `gensim`, `faiss-cpu`, and pins `httpx<0.29.0` — a hard ceiling on a dependency the
  backend's MCP client needs. As its own image it costs nothing to the app.

### Cost that is worth knowing before a second attempt

* **The image is 4.59 GB** (CPU torch alone is most of it).
* **Extraction is superlinear in article length.** The 25-article block containing the KB's
  largest article (15,905 chars) took ~4 minutes on its own; small articles take milliseconds.
  Extraction cost tracks the few long documents, not the article count.
* **`ml` without the model installed is the worst of both worlds** — it fails to load spaCy per
  article, falls back to `pattern` each time, and reports `ml` in the log. That is what turned
  the first run into 29 minutes of confusion. The pod now defaults to `pattern` and says so.

---

## Two mistakes made here, kept because they are the useful part

### 1. A read transaction blocked the backend's startup migration

The first version opened one Postgres connection for the whole pipeline. A plain
`SELECT ... FROM kb_meta` therefore stayed **idle in transaction for ~10 minutes**, holding
`AccessShareLock` on `kb_meta`. The backend's startup migration
(`ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS body TEXT`) needs `AccessExclusiveLock`, so it
queued behind it — and every pod behind that queued behind the same lock:

```
pid 5075 | idle in transaction | 9m40s | SELECT page_id, title, body FROM kb_meta   <- the spike
pid 5079 | BLOCKED by 5075 | ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS body TEXT
pid 5082 | BLOCKED by 5079 | ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta TEXT
```

The app hung at `Waiting for application startup`, failed its liveness probe, and was killed;
its replacement hit the same lock. The rolling deploy never converged and the estate sat at
`backend 1/2`. **Rolling the backend back to the previous image did not help** — which is the
tell that the cause is external to the app.

Fixed by reading on a short-lived `autocommit` connection that closes before extraction begins,
and by setting `idle_in_transaction_session_timeout = '60s'` so this class of mistake is
self-limiting. **A read is not free: `ACCESS SHARE` blocks `ACCESS EXCLUSIVE`.** Never hold a
read transaction across a long computation.

### 2. Building inside startup needs a probe window longer than the build

The build runs ~29 minutes; the pod's `startupProbe` allowed 10. The pod was killed mid-build
and restarted into the same build, forever. The server now starts **first** and the build runs
in a background thread, so `startupProbe` was removed entirely and the pod is Ready in ~10 s
while the graph is still being built.

The first version also created its tables inside the final `save()`, so for the entire build
every read endpoint answered 500 while the service was in fact healthy and working. `ensure_schema()`
now runs before the build, so reads return empty results — which is the truth.

---

## UI

`Context Graph` in the sidebar (admin only), and `/api/semantica/*` on the backend.

* A force-directed view (`d3-force` + SVG) coloured by extracted label, sized by mentions.
* Selecting a node shows its **provenance** (source URLs and KB page ids) and its connections —
  the part of this spike actually worth looking at.
* A banner states plainly that this is an evaluation surface and nothing depends on it.

Rendered and measured at both widths via `desktop/scripts/semantica_harness_shot.mjs`, which
uses payloads captured from the live service (`desktop/public/semantica_fixture.json`) rather
than invented rows:

```
desktop  scrollW=1440 viewW=1440  nodes=80 lines=74 tables=2  jsErrors=[]
mobile   scrollW=390  viewW=390   nodes=80 lines=74 tables=2  jsErrors=[]
```

Getting to `scrollW == viewW` at 390px took two fixes worth recording:

* a fixed-width filter input (176px) sat in a `shrink-0` flex row that cannot wrap and widened
  the whole card to 442px — it lives in the card body now;
* grid items default to `min-width: auto`, so the truncated (`white-space: nowrap`) provenance
  URLs set each column's **min-content** width and the page grew to 462px the moment an entity
  was selected. `min-w-0` on the grid children restores shrinking. The overflow only appeared
  after a node was clicked, which is why measuring the initial render was not enough.

---

## Not evaluated

* **`ml` (spaCy NER) and `llm` extraction.** The pod runs `pattern`. `en_core_web_sm` is not in
  the image; install it and set `SEMANTICA_METHOD=ml` before concluding anything about
  Semantica's quality — the noise above is the regex extractor's, not the framework's.
* **Deterministic reasoning** (forward chaining, Rete, Datalog, SPARQL), **SHACL/OWL governance**,
  **conflict detection**, **entity resolution**, **time travel**, and **graph storage backends**.
  None were exercised. `[graph-apache-age]` would need the AGE extension, which this Postgres
  does not have.
* **Incrementality.** The graph is built once from a full pass. Whether it can be kept in sync
  with a changing knowledge base was not tested.

## Fair statement of where this leaves the decision

The infrastructure questions are answered: it installs, it runs on-prem as its own pod, it reads
real data, it produces real provenance, and it can be removed cleanly. The open question is
extraction quality on IT prose — and that must be answered with `ml`, not with the pattern
extractor, before this is judged either way.
