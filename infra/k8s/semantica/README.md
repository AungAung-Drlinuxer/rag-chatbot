# Semantica spike

An evaluation of [Semantica](https://github.com/semantica-agi/semantica) against this estate's
own knowledge base — built, measured, and surfaced in the app so the decision is made on
numbers rather than on the vendor's description.

**Verdict: the infrastructure questions are answered, and the answer is yes. Extraction quality
depends entirely on which extractor you pick — `ml` is far better than `pattern`, and neither is
turnkey on this corpus.** Details below.

---

## What was built

| Piece | Where | Notes |
|---|---|---|
| Graph builder + JSON API | `spike_pipeline.py` | two extractors, no LLM |
| Image | `Dockerfile` | `python:3.12-slim`, CPU torch, spaCy `en_core_web_sm` |
| Deployment + Service | `10-deployment.yaml` | separate pod, **not** part of the backend |
| Read-only proxy | `backend/app/api/semantica_spike.py` | admin-only, `?method=` |
| UI | `desktop/src/features/semantica/` | page + `d3-force` graph + extractor switch |

Two tables are written to the existing CNPG database, `semantica_entities` and
`semantica_relations`. **Both extractors live in those tables, separated by a `method` column**,
so they can be compared in the UI rather than one replacing the other. Nothing else in the app
reads them.

### Removing it

1. `kubectl -n rag-chatbot delete -f 10-deployment.yaml`
2. delete `backend/app/api/semantica_spike.py`, its two `main.py` lines, and
   `desktop/src/features/semantica/` + the four wiring lines (router, App, sidebar)
3. `DROP TABLE semantica_entities, semantica_relations;`

No other code path touches it.

---

## Measured results — both extractors, same 229 articles, 0 errors

|  | `pattern` (regex) | `ml` (spaCy `en_core_web_sm`) |
|---|---|---|
| entities | 2,144 | **2,871** |
| relations | 1,540 | **3,774** |
| distinct labels | 4 | **12** |
| labels | PERSON 1966 (92%) · DATE 157 · UNKNOWN 18 · GPE 3 | ORG 1186 (41%) · PERSON 610 · MONEY 234 · CARDINAL 198 · DATE 143 · GPE 122 · WORK_OF_ART 108 · PRODUCT 94 · NORP 44 · TIME 25 · LOC 25 · LAW 25 |
| distinct predicates | 2 (`related_to`, `located_in`) | ~60 (`create`, `configure`, `allow`, `store`, `use`, `located_in`, …) |
| build time | 1,764 s (29 min) | 3,128 s (52 min) |
| provenance | 2,144 / 2,144 | 2,871 / 2,871 |

### What each one actually produces

`pattern`, top entities — heading fragments labelled as people:

```
Safety Warning Do              [PERSON] x38
Escalation Criteria Escalate   [PERSON] x36
Diagnosis Steps Record         [PERSON] x30
Resolution Steps If            [PERSON] x25
```

`ml`, top entities — **real infrastructure names**:

```
AWS        [ORG] x248      GuardDuty  [PRODUCT] x109
IP         [ORG] x160      IAM        [ORG] x93
S3         [ORG] x123      VPC        [ORG] x72
```

and real relationships, which is the thing a vector index cannot give you:

```
AWS        --[Create]-->  IAM
AWS        --[use]-->     GuardDuty
CloudTrail --[data…]-->   AWS
```

`ml` on the entity `AWS` resolves to **248 mentions across 54 articles**, each with its source
URL — that is the provenance claim, and it holds.

### What is still wrong in `ml`

Choosing `ml` does not make the graph correct; it makes it useful. Measured noise:

* **183 of 2,871 entities (6.4%) are markdown markers.** `###` is the single most-mentioned
  entity in the whole graph (x285) and `####` is fourth (x219). Extraction runs over raw
  markdown, so heading markers become entities. Stripping markdown first is the obvious fix.
* **Generic counters rank as high as services** — `760` x283, `one` x77, `first` x74, `two` x70.
* **`MONEY` is misfiring** — 234 entities, mostly those same markdown markers.
* **Predicates carry sentence debris** — next to real verbs there is `bash`, `echo`, `\*\*Kafka`.
* **The knowledge base contains Burmese text**, which spaCy has no model for: `ကို` appears as a
  `CARDINAL` x70 and predicates include `ဒါက`, `များကို`, `၊`. Any extraction over this KB has to
  decide what to do with mixed-language content.

### The real cost driver: a handful of long documents

Extraction cost is **superlinear in article length**, for both extractors. The KB's longest
articles (15,905 and 12,860 characters) each caused a multi-minute stall while the other 200-odd
articles take milliseconds; both builds were dominated by about five documents. The progress
line only fires every 25 articles, which is why those stalls looked like hangs — per-article
timing should be logged before the next run.

### Infrastructure facts, all measured

* **Provenance is real**, end to end, at both extractors.
* **Separate pod, no coupling** — `pip install semantica` resolves to **155 packages** and pins
  `httpx<0.29.0`, a hard ceiling on a dependency the backend's MCP client shares. As its own
  image the app pays nothing. Cost: a **4.59 GB** image (CPU torch is most of it).
* **Cheap at rest** — 16 Mi idle, ~2 cores while building, 1/1 Ready in ~10 s, 0 restarts.

---

## Four mistakes made here, kept because they are the useful part

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
its replacement hit the same lock. The estate sat at `backend 1/2`. **Rolling the backend back
to the previous image did not help** — which is the tell that the cause is external.

Fixed by reading on a short-lived `autocommit` connection that closes before extraction begins,
plus `idle_in_transaction_session_timeout = '60s'`. **A read is not free: `ACCESS SHARE` blocks
`ACCESS EXCLUSIVE`.**

### 2. Building inside startup needs a probe window longer than the build

The build runs 29–52 minutes; the pod's `startupProbe` allowed 10. The pod was killed mid-build
and restarted into the same build, forever. The server now starts **first** and the build runs in
a background thread, so `startupProbe` was removed and the pod is Ready in ~10 s while the graph
is still building. Progress is reported through `/stats` so the UI can say what is happening.

Related: the first version created its tables inside the final `save()`, so for the whole build
every read endpoint answered 500 while the service was healthy and working. `ensure_schema()`
runs before the build now, so reads return empty results — which is the truth.

### 3. A schema statement that depended on a migration that had not run

Adding the `method` column worked, then stopped working. The `DDL` string created
`CREATE INDEX ... ON semantica_entities (method)` **before** `ensure_schema()` ran the
`ALTER TABLE ... ADD COLUMN`. On this database the tables already existed, so
`CREATE TABLE IF NOT EXISTS` was a no-op and the index statement failed with
`column "method" does not exist` — **aborting the batch before the ALTER**. The build then died
with the same error. A migration-dependent statement must run after the migration, never in the
initial schema DDL.

A related trap in the same area: `TRUNCATE` in the save path. Harmless with one extractor, it
would have silently deleted the `pattern` graph the moment a second one existed. Writes now
delete `WHERE method = %s`.

### 4. An extractor that cannot load its model is worse than the fallback

The first run set `SEMANTICA_METHOD=ml` with no spaCy model in the image. `NERExtractor(method="ml")`
does not fail — it fails to load **per article**, silently falls back to `pattern`, and the run
still reports `ml`. The probe meant to catch that (`ner.extract(...)` returns entities) **passed**,
because the fallback returned entities. That turned a seconds-long extraction into 29 minutes of
confusion and produced numbers labelled `ml` that were really the regex extractor's.

The gate is now `spacy.load("en_core_web_sm")` directly, and the log records the model version
and probe output, so an `ml` run cannot silently be a `pattern` run.

---

## UI

`Context Graph` in the sidebar (admin only), backed by `/api/semantica/*`.

* An **extractor switch** showing each one's entity count, so the comparison above is visible in
  the product and not only in this file.
* A force-directed view (`d3-force` + SVG) coloured by extracted label, sized by mentions.
  80 nodes / **378 edges** for `ml` versus 74 for `pattern` — the density difference is the
  relations difference, made visible.
* Selecting a node shows its **provenance** (source URLs and KB page ids) and its connections.
* A banner states plainly that this is an evaluation surface and nothing depends on it.

Rendered and measured at both widths via `desktop/scripts/semantica_harness_shot.mjs`, on payloads
captured from the live service (`desktop/public/semantica_fixture.json`):

```
desktop  scrollW=1440 viewW=1440  nodes=80 lines=378 tables=2  jsErrors=[]
mobile   scrollW=390  viewW=390   nodes=80 lines=378 tables=2  jsErrors=[]
```

Reaching `scrollW == viewW` at 390px took two fixes worth recording:

* a fixed-width filter input (176px) sat in a `shrink-0` flex row that cannot wrap and widened the
  whole card to 442px — it lives in the card body now;
* grid items default to `min-width: auto`, so the truncated (`white-space: nowrap`) provenance
  URLs set each column's **min-content** width and the page grew to 462px **the moment an entity
  was selected**. `min-w-0` on the grid children restores shrinking. The overflow only appeared
  after a node was clicked, which is why measuring the first paint was not enough.

---

## Still not evaluated

* **`llm` extraction** (`SEMANTICA_METHOD=llm`). Untested — it moves the cost from CPU to tokens
  and gives up the deterministic no-LLM property that makes this layer attractive.
* **Markdown stripping before extraction**, the obvious fix for the 6.4% marker noise.
* **Deterministic reasoning** (forward chaining, Rete, Datalog, SPARQL), **SHACL/OWL governance**,
  **conflict detection**, **entity resolution**, **time travel**, **graph analytics**, and
  **graph storage backends**. None exercised. `[graph-apache-age]` would need the AGE extension,
  which this Postgres does not have.
* **Incrementality.** Both graphs are full passes. Keeping a graph in sync with a changing KB —
  the thing that would make this usable in production — is untested, and the long-document cost
  above is the reason it needs testing.
* **Mixed-language handling** for the Burmese content in the KB.

## Where this leaves the decision

The infrastructure case is settled: it installs, runs on-prem as one small pod, reads real data,
produces real provenance, supports two extractors side by side, and can be removed cleanly. The
`ml` graph is genuinely useful — `AWS`, `GuardDuty`, `IAM`, `VPC` with real relationships between
them, which is more than the vector index can express.

What it is **not** is turnkey. Raw markdown becomes entities, generic counters rank as high as
services, and the predicate set needs curating. On this corpus it is a platform to build on, not
a product to switch on — and the next honest step is markdown stripping plus per-article timing,
not another feature.
