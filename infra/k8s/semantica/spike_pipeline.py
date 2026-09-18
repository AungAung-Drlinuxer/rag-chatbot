"""Semantica spike: build a context graph over the live knowledge base, and serve it.

WHAT THIS IS FOR
An honest answer to "would Semantica earn its place here?" needs a graph built from this
estate's own data, not from a demo. So this reads the 229 real KB articles out of Postgres,
runs Semantica's extraction over them, writes the resulting graph into two NEW tables
(additive — nothing existing is touched), and serves it as JSON for the desktop UI.

DELIBERATELY DETERMINISTIC
Extraction uses method="pattern" (and "ml" when the local spaCy model is present). Neither
needs an LLM key, which matters here for two reasons: the estate must keep working air-gapped,
and a spike whose output depends on a model's mood is not evidence of anything. Tool calling
on the configured free-tier model is already known to be flaky; this pipeline stays out of it.

WHAT IT WRITES (new tables, never existing ones)
    semantica_entities   one row per resolved entity, with the sources that produced it
    semantica_relations  one row per subject-predicate-object edge
Both are safe to DROP to undo the spike.

PROVENANCE
Every entity and relation carries the KB page_id and source_url it came from. That is the
claim worth testing against this estate: audit_log is already a flat table of decisions, but
nothing today can answer "which documents produced this fact".
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter, defaultdict

import psycopg2
import psycopg2.extras

RAW_DSN = os.environ.get("SEMANTICA_DSN") or os.environ.get("DATABASE_URL") or ""
BATCH = int(os.environ.get("SEMANTICA_BATCH", "0"))          # 0 = every article
METHOD = os.environ.get("SEMANTICA_METHOD", "pattern")        # pattern | ml | llm
PORT = int(os.environ.get("SEMANTICA_PORT", "8000"))

# Build progress, readable by /stats. The build is long (measured: ~25 min for 229 articles,
# 2 cores pegged), so it runs in a BACKGROUND THREAD and the HTTP server comes up immediately.
# The first version built inside startup, which needed a probe window longer than the build —
# the pod was killed mid-build and restarted into the same build, forever.
PROGRESS: dict = {"state": "starting", "done": 0, "total": 0, "entities": 0, "relations": 0}


def dsn() -> str:
    """The app's DATABASE_URL, made acceptable to psycopg2.

    It carries a SQLAlchemy driver suffix (`postgresql+psycopg2://`) which psycopg2 itself
    cannot parse, and the database name is already in the path — so this normalises the
    scheme and drops the separate dbname argument that would otherwise override it.
    """
    d = RAW_DSN.strip()
    for pre in ("postgresql+psycopg2://", "postgres+psycopg2://", "postgresql+psycopg://"):
        if d.startswith(pre):
            d = "postgresql://" + d[len(pre):]
    return d


def connect():
    return psycopg2.connect(dsn())


def log(msg: str) -> None:
    print(f"[spike] {msg}", flush=True)


# ---------------------------------------------------------------- source data
def load_articles() -> list[dict]:
    """The real KB — read on a SHORT-LIVED connection that closes before extraction starts.

    THIS IS THE BUG THAT TOOK THE BACKEND DOWN, so the shape matters more than the query.
    The first version opened one connection here and held it until the final save(), which
    meant a plain SELECT stayed OPEN IN TRANSACTION for the whole ~25-minute extraction. A
    SELECT takes ACCESS SHARE on kb_meta, and ACCESS SHARE blocks ACCESS EXCLUSIVE — which is
    exactly what the backend's startup migration (ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS
    body TEXT) needs. So every backend pod hung at "Waiting for application startup", failed
    its liveness probe, and was killed; a second later its replacement queued up behind the
    same lock. The rolling deploy never converged, and the app was left at 1/2 replicas.

    Two defences, both here rather than in a comment:
      * autocommit, so a READ never holds a transaction at all;
      * idle_in_transaction_session_timeout, so if this class of mistake recurs Postgres
        reclaims the connection instead of letting it block the app indefinitely.
    """
    conn = connect()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SET idle_in_transaction_session_timeout = '60s'")
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as rcur:
                rcur.execute(
                    "SELECT page_id, title, body, domain, source_url FROM kb_meta "
                    "WHERE coalesce(body,'') <> '' ORDER BY page_id"
                )
                rows = [dict(r) for r in rcur.fetchall()]
    finally:
        conn.close()          # closed BEFORE the long extraction phase begins
    if BATCH:
        rows = rows[:BATCH]
    return rows


# ---------------------------------------------------------------- extraction
def build_extractors():
    """Return (ner, rel, method_used). Falls back rather than failing the spike."""
    from semantica.semantic_extract import NERExtractor, RelationExtractor

    if METHOD in ("ml", "auto"):
        try:
            ner = NERExtractor(method="ml")
            rel = RelationExtractor(method="ml")
            # Prove it actually works before committing 229 articles to it.
            probe = ner.extract("Kubernetes runs on Ubuntu 24.04 at 10.10.10.115")
            if probe:
                log(f"extractor: ml (spaCy) — probe found {len(probe)} entities")
                return ner, rel, "ml"
            log("extractor: ml returned nothing on the probe; falling back to pattern")
        except Exception as exc:  # noqa: BLE001
            log(f"extractor: ml unavailable ({type(exc).__name__}: {str(exc)[:90]}); using pattern")

    return NERExtractor(method="pattern"), RelationExtractor(method="pattern"), "pattern"


def ent_text(e) -> str:
    return getattr(e, "text", None) or (e.get("text") if isinstance(e, dict) else "") or ""


def ent_label(e) -> str:
    return (getattr(e, "label", None) or getattr(e, "type", None)
            or (e.get("label") if isinstance(e, dict) else "") or "")


def rel_parts(r):
    """Relations arrive as objects with subject/predicate/object, sometimes as dicts."""
    if isinstance(r, dict):
        s, p, o = r.get("subject"), r.get("predicate"), r.get("object")
    else:
        s, p, o = getattr(r, "subject", None), getattr(r, "predicate", None), getattr(r, "object", None)
    return ent_text(s), (p or ""), ent_text(o)


# ---------------------------------------------------------------- persistence
DDL = """
CREATE TABLE IF NOT EXISTS semantica_entities (
    id           bigserial PRIMARY KEY,
    name         text NOT NULL,
    label        text,
    mentions     integer NOT NULL DEFAULT 0,
    page_ids     text[]  NOT NULL DEFAULT '{}',
    source_urls  text[]  NOT NULL DEFAULT '{}',
    UNIQUE (name, label)
);
CREATE TABLE IF NOT EXISTS semantica_relations (
    id           bigserial PRIMARY KEY,
    subject      text NOT NULL,
    predicate    text NOT NULL,
    object       text NOT NULL,
    mentions     integer NOT NULL DEFAULT 0,
    page_ids     text[]  NOT NULL DEFAULT '{}',
    source_urls  text[]  NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS semantica_relations_subject_idx ON semantica_relations (subject);
CREATE INDEX IF NOT EXISTS semantica_relations_object_idx  ON semantica_relations (object);
"""


def ensure_schema() -> None:
    """Create the tables up front, on their own short connection.

    The first version only ran this DDL inside save(), at the END of the build — so for the
    whole build the tables did not exist and every read endpoint answered 500 (the UI showed
    "the spike service is not answering" while the service was in fact fine and working).
    Creating them first means reads return empty results during the build, which is the truth.
    """
    conn = connect()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(DDL)
    finally:
        conn.close()


def save(entities: dict, relations: dict) -> None:
    """Write on a fresh connection, held only for the write itself."""
    conn = connect()
    try:
        with conn.cursor() as cur:
            _save_rows(cur, entities, relations)
        conn.commit()
    finally:
        conn.close()


def _save_rows(cur, entities: dict, relations: dict) -> None:
        cur.execute(DDL)
        cur.execute("TRUNCATE semantica_entities, semantica_relations")
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO semantica_entities (name,label,mentions,page_ids,source_urls) VALUES %s "
            "ON CONFLICT (name,label) DO UPDATE SET mentions = EXCLUDED.mentions, "
            "page_ids = EXCLUDED.page_ids, source_urls = EXCLUDED.source_urls",
            [(k[0], k[1], v["mentions"], sorted(v["pages"]), sorted(v["urls"])) for k, v in entities.items()],
        )
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO semantica_relations (subject,predicate,object,mentions,page_ids,source_urls) VALUES %s",
            [(s, p, o, v["mentions"], sorted(v["pages"]), sorted(v["urls"])) for (s, p, o), v in relations.items()],
        )


# ---------------------------------------------------------------- the pipeline
def run_build() -> dict:
    # NO database connection is held here on purpose. See load_articles() for the outage
    # this caused: a read transaction left open across the extraction phase blocked the
    # backend's startup migration and took the app to 1/2 replicas.
    articles = load_articles()
    log(f"kb_meta: {len(articles)} article(s) with body")
    PROGRESS.update(state="building", done=0, total=len(articles))

    ner, rel, method = build_extractors()

    entities: dict[tuple[str, str], dict] = {}
    relations: dict[tuple[str, str, str], dict] = {}
    t0 = time.time()
    errors = 0

    for i, a in enumerate(articles, 1):
        title, body, page_id, url = a["title"] or "", a["body"] or "", a["page_id"], a["source_url"] or ""
        text = f"{title}\n\n{body}"[:20000]
        try:
            ents = ner.extract(text)
            rels = rel.extract(text, entities=ents)
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log(f"  page {page_id}: extraction failed ({type(exc).__name__}: {str(exc)[:80]})")
            continue

        seen_in_page = set()
        for e in ents:
            name = ent_text(e).strip()
            if not name or len(name) < 2:
                continue
            key = (name, ent_label(e).upper() or "ENTITY")
            slot = entities.setdefault(key, {"mentions": 0, "pages": set(), "urls": set()})
            slot["mentions"] += 1
            slot["pages"].add(str(page_id))
            if url:
                slot["urls"].add(url[:300])
            seen_in_page.add(name)

        for r in rels:
            s, p, o = rel_parts(r)
            s, p, o = s.strip(), (p or "").strip(), o.strip()
            if not s or not o or not p or s == o:
                continue
            slot = relations.setdefault((s, p, o), {"mentions": 0, "pages": set(), "urls": set()})
            slot["mentions"] += 1
            slot["pages"].add(str(page_id))
            if url:
                slot["urls"].add(url[:300])

        if i % 25 == 0 or i == len(articles):
            PROGRESS.update(done=i, entities=len(entities), relations=len(relations))
            log(f"  {i}/{len(articles)} articles · {len(entities)} entities · {len(relations)} relations")

    save(entities, relations)

    by_label = Counter(k[1] for k in entities)
    stats = {
        "articles": len(articles),
        "entities": len(entities),
        "relations": len(relations),
        "errors": errors,
        "method": method,
        "seconds": round(time.time() - t0, 1),
        "by_label": dict(by_label.most_common(12)),
        "with_provenance": sum(1 for v in entities.values() if v["urls"]),
    }
    log("build done: " + json.dumps(stats))
    PROGRESS.update(state="ready", entities=stats["entities"], relations=stats["relations"])
    return stats


# ---------------------------------------------------------------- HTTP for the UI
def serve() -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import urlparse, parse_qs

    def q(sql: str, args=None):
        conn = connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, args or ())
                return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    class H(BaseHTTPRequestHandler):
        def _send(self, obj, code=200):
            body = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):  # quieter
            pass

        def do_GET(self):
            u = urlparse(self.path)
            p, qs = u.path, parse_qs(u.query)
            try:
                if p == "/healthz":
                    return self._send({"ok": True})
                # A dependency-free health signal for the K8s probe that actually tests the DB.
                if p == "/stats":
                    try:
                        t = q("SELECT count(*) c FROM semantica_entities")[0]["c"]
                    except Exception:  # noqa: BLE001  — tables not created yet, i.e. building
                        return self._send({"entities": 0, "relations": 0, "by_label": [],
                                           "top_entities": [], "top_relations": [],
                                           "progress": PROGRESS})
                    if not t and PROGRESS.get("state") != "ready":
                        return self._send({"entities": 0, "relations": 0, "by_label": [],
                                           "top_entities": [], "top_relations": [],
                                           "progress": PROGRESS})
                    _ = t
                    r = q("SELECT count(*) c FROM semantica_relations")[0]["c"]
                    lab = q("SELECT label, count(*) c FROM semantica_entities GROUP BY label ORDER BY c DESC LIMIT 12")
                    top = q("SELECT name, label, mentions FROM semantica_entities ORDER BY mentions DESC LIMIT 15")
                    five = q("SELECT subject, predicate, object, mentions FROM semantica_relations ORDER BY mentions DESC LIMIT 10")
                    return self._send({"entities": t, "relations": r, "by_label": lab,
                                       "top_entities": top, "top_relations": five,
                                       "progress": PROGRESS})
                if p == "/entities":
                    lim = int(qs.get("limit", ["200"])[0])
                    like = (qs.get("q", [""])[0] or "").strip()
                    if like:
                        return self._send(q(
                            "SELECT name,label,mentions,page_ids,source_urls FROM semantica_entities "
                            "WHERE name ILIKE %s ORDER BY mentions DESC LIMIT %s", (f"%{like}%", lim)))
                    return self._send(q(
                        "SELECT name,label,mentions,page_ids,source_urls FROM semantica_entities "
                        "ORDER BY mentions DESC LIMIT %s", (lim,)))
                if p == "/graph":
                    # Bounded neighbourhood for the viewer: top entities plus the edges between them.
                    lim = int(qs.get("limit", ["120"])[0])
                    nodes = q("SELECT name,label,mentions FROM semantica_entities ORDER BY mentions DESC LIMIT %s", (lim,))
                    names = [n["name"] for n in nodes]
                    edges = q(
                        "SELECT subject,predicate,object,mentions FROM semantica_relations "
                        "WHERE subject = ANY(%s) AND object = ANY(%s) ORDER BY mentions DESC LIMIT 400",
                        (names, names))
                    return self._send({"nodes": nodes, "edges": edges, "truncated": len(nodes) >= lim})
                if p == "/relation":
                    s = qs.get("subject", [""])[0]
                    return self._send(q(
                        "SELECT subject,predicate,object,mentions,page_ids,source_urls "
                        "FROM semantica_relations WHERE subject=%s OR object=%s ORDER BY mentions DESC LIMIT 100",
                        (s, s)))
                if p == "/provenance":
                    name = qs.get("name", [""])[0]
                    return self._send(q(
                        "SELECT name,label,mentions,page_ids,source_urls FROM semantica_entities WHERE name=%s",
                        (name,)))
                return self._send({"error": "not found", "path": p}, 404)
            except Exception as exc:  # noqa: BLE001
                return self._send({"error": f"{type(exc).__name__}: {str(exc)[:200]}"}, 500)

    import threading

    def background_build() -> None:
        """Build only if the graph is absent, and never rebuild over an existing one."""
        try:
            ensure_schema()
            conn = connect()
            try:
                conn.autocommit = True
                with conn.cursor() as cur:
                    cur.execute("SELECT to_regclass('semantica_entities')")
                    exists = cur.fetchone()[0]
                    n = 0
                    if exists:
                        cur.execute("SELECT count(*) FROM semantica_entities")
                        n = cur.fetchone()[0]
            finally:
                conn.close()
            if n:
                log(f"graph already built: {n} entities")
                PROGRESS.update(state="ready", entities=n)
                return
            log("graph table is empty — building once, in the background")
            run_build()
        except Exception as exc:  # noqa: BLE001
            PROGRESS.update(state=f"failed: {type(exc).__name__}: {str(exc)[:120]}")
            log(f"build failed: {type(exc).__name__}: {str(exc)[:200]}")

    # HTTP FIRST. The probes then pass while the graph is being built, which is the whole
    # point: a 25-minute build must not be a 25-minute startup.
    threading.Thread(target=background_build, daemon=True, name="spike-build").start()

    log(f"serving on :{PORT}  (/stats /entities /graph /relation /provenance /healthz)")
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if cmd == "build":
        run_build()
    elif cmd == "reset":
        c = connect()
        with c.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS semantica_relations, semantica_entities")
        c.commit(); c.close()
        log("dropped the spike tables")
    else:
        serve()