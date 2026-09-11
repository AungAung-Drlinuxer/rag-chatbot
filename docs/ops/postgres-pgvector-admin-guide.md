# PostgreSQL + pgvector Database Administrator (DBA) Management Guide

**Platform:** RKE2 Kubernetes (`drlinuxer-prod`)  
**Namespace:** `rag-chatbot`  
**Operator:** CloudNativePG (CNPG) v1  
**Database:** `assistant`  
**Engine:** PostgreSQL 16.4 (`ghcr.io/cloudnative-pg/postgresql:16.4`)  
**Extensions:** `vector` 0.8.0  
**Storage:** 30Gi `truenas-iscsi` per instance  
**Connection Pooler:** PgBouncer (2 instances, Transaction Mode)  

---

## 1. Architecture Overview

```
                      [ Client Applications ]
                     (Backend, Celery Worker)
                                │
                                ▼ (Port 5432)
                 [ Service: postgres-ha-pooler ]
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
 [ Pod: postgres-ha-pooler-1 ]         [ Pod: postgres-ha-pooler-2 ]
 (PgBouncer - Transaction Mode)        (PgBouncer - Transaction Mode)
             │                                     │
             └──────────────────┬──────────────────┘
                                ▼
                   [ Service: postgres-ha-rw ]
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 [ postgres-ha-1 ]       [ postgres-ha-2 ]       [ postgres-ha-3 ]
 (Primary / RW)          (Standby / Read)        (Standby / Read)
   30Gi iSCSI              30Gi iSCSI              30Gi iSCSI
        │ Streaming Replication │ Streaming Replication │
        └───────────────────────┴───────────────────────┘
```

---

## 2. Cluster Health & Daily Operations

### 2.1 Kubernetes & CNPG Status Commands

```bash
# Check CNPG Cluster status and replication health
kubectl -n rag-chatbot get cluster postgres-ha
kubectl -n rag-chatbot describe cluster postgres-ha

# View PostgreSQL & PgBouncer Pods
kubectl -n rag-chatbot get pods -l cnpg.io/cluster=postgres-ha
kubectl -n rag-chatbot get pooler postgres-ha-pooler

# Direct PSQL access to Primary Instance
kubectl -n rag-chatbot exec -it postgres-ha-1 -c postgres -- psql -U postgres -d assistant
```

### 2.2 Replication & High Availability Check

Run inside PostgreSQL:
```sql
-- Check connected standby instances and replication lag
SELECT 
    client_addr, 
    application_name, 
    state, 
    sync_state, 
    sync_priority,
    pg_wal_lsn_diff(pg_current_wal_lsn(), write_lsn) AS write_lag_bytes,
    pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn) AS flush_lag_bytes,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;
```

---

## 3. pgvector & RAG Index Architecture

The primary vector repository is stored in `public.langchain_pg_embedding`.

### 3.1 Table Schema
* `uuid` (UUID, Primary Key)
* `collection_id` (UUID)
* `embedding` (`vector(768)`) - Nomic-Embed-Text 768-dimensional float32 vector
* `document` (`varchar`) - Chunk text content
* `cmetadata` (`json`) - Source metadata (domain, page_id, title, url, chunk_id)
* `tsv` (`tsvector`) - Tokenized text for Full-Text Search (FTS)

### 3.2 Indexes on Vector Table
1. **B-Tree Index:** `langchain_pg_embedding_pkey` on `uuid`
2. **GIN Index (Keyword / BM25 search):**
   ```sql
   CREATE INDEX langchain_pg_embedding_tsv_idx 
   ON public.langchain_pg_embedding 
   USING gin (tsv);
   ```
3. **HNSW Vector Index (Semantic Similarity):**
   ```sql
   CREATE INDEX langchain_pg_embedding_hnsw_idx 
   ON public.langchain_pg_embedding 
   USING hnsw (embedding vector_cosine_ops) 
   WITH (m = 16, ef_construction = 64);
   ```

---

## 4. Query Tuning & Performance Optimization

### 4.1 HNSW Runtime Parameters
HNSW speed vs accuracy trade-off is controlled per-session or globally:
```sql
-- Default is 40. Higher values increase recall (accuracy) at the expense of latency.
-- Production recommendation: 64 to 100 for enterprise RAG.
SET hnsw.ef_search = 64;
```

### 4.2 Query Plan Verification (EXPLAIN ANALYZE)
Verify that PostgreSQL uses the HNSW index rather than performing a sequential table scan:
```sql
EXPLAIN ANALYZE
SELECT 
    uuid, 
    document, 
    1 - (embedding <=> '[0.012, -0.045, ...]'::vector) AS cosine_similarity
FROM public.langchain_pg_embedding
WHERE cmetadata->>'domain' = 'network'
ORDER BY embedding <=> '[0.012, -0.045, ...]'::vector
LIMIT 5;
```
*Expected execution path:* `Index Scan using langchain_pg_embedding_hnsw_idx`

### 4.3 Reciprocal Rank Fusion (RRF) Hybrid Search
Combining Full-Text Search (`tsvector`) and Vector Search (`embedding`):
```sql
WITH vector_search AS (
    SELECT uuid, ROW_NUMBER() OVER (ORDER BY embedding <=> :query_vec) as rank
    FROM langchain_pg_embedding
    LIMIT 20
),
keyword_search AS (
    SELECT uuid, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', :query_text)) DESC) as rank
    FROM langchain_pg_embedding
    WHERE tsv @@ plainto_tsquery('english', :query_text)
    LIMIT 20
)
SELECT 
    COALESCE(v.uuid, k.uuid) AS uuid,
    COALESCE(1.0 / (60 + v.rank), 0.0) + COALESCE(1.0 / (60 + k.rank), 0.0) AS rrf_score
FROM vector_search v
FULL OUTER JOIN keyword_search k ON v.uuid = k.uuid
ORDER BY rrf_score DESC
LIMIT 5;
```

---

## 5. Routine Maintenance & Housekeeping

### 5.1 VACUUM & ANALYZE
Dead tuples degrade HNSW search speed. Ensure statistics are updated:
```sql
-- Update statistics for vector column and document tables
ANALYZE langchain_pg_embedding;

-- Deep clean without table lock
VACUUM (VERBOSE, ANALYZE) langchain_pg_embedding;
```

### 5.2 Re-indexing HNSW (When KB grows significantly)
If large batches of documents are inserted (e.g., thousands of Confluence/Wiki pages):
```sql
-- Rebuild index concurrently without blocking read/write traffic
REINDEX INDEX CONCURRENTLY langchain_pg_embedding_hnsw_idx;
```

### 5.3 Memory Configuration Guidelines (`postgresql.conf`)
Current Cluster Baseline:
* `shared_buffers = 1GB` (Target: 25% of Pod RAM limit)
* `work_mem = 16MB` (Standard queries)
* `maintenance_work_mem = 512MB` (Critical: HNSW builds require adequate maintenance memory)
* `max_connections = 200` (Managed via PgBouncer Pooler)

---

## 6. Backup, Recovery & Failover

### 6.1 Database Dump & Logical Backup
To perform an on-demand logical backup of the assistant database:
```bash
kubectl -n rag-chatbot exec postgres-ha-1 -c postgres -- \
  pg_dump -U postgres -d assistant -Fc -f /tmp/assistant_backup.dump

# Copy backup dump to local machine or backup server
kubectl -n rag-chatbot cp postgres-ha-1:/tmp/assistant_backup.dump ./assistant_backup_$(date +%F).dump
```

### 6.2 Manual Switchover (Planned Failover)
If the primary node needs maintenance:
```bash
# Using CNPG kubectl plugin or annotating the cluster
kubectl cnpg promote postgres-ha -n rag-chatbot postgres-ha-2
```

---

## 7. Troubleshooting Runbook

| Symptom | Root Cause | Remediation |
|---|---|---|
| `504 Gateway Timeout` on Vector Search | Sequential scan triggered instead of HNSW | Run `ANALYZE langchain_pg_embedding;` and check `EXPLAIN ANALYZE`. Verify `hnsw.ef_search` is not excessively high (>500). |
| `ERROR: memory required for HNSW build exceeds maintenance_work_mem` | Index build needs more memory | Increase `maintenance_work_mem` to `1GB` or `2GB` temporarily for the session. |
| `Pooler CrashLoopBackOff` | PgBouncer deployment detached from CNPG CR | Ensure `Pooler` Custom Resource exists in namespace `rag-chatbot` linking to cluster `postgres-ha`. |
| Replication lag increasing on standby | Network saturation or long-running transaction | Check `pg_stat_replication` and terminate blocking queries using `pg_terminate_backend(pid)`. |
