#!/usr/bin/env bash
# Create a least-privilege READ-ONLY Postgres role for the MCP connector.
#
# WHY A CURATED TABLE LIST AND NOT "GRANT SELECT ON ALL TABLES"
# The app database holds `local_user_credentials.password_hash`, `api_keys.key_hash`
# and `system_settings` (which stores provider tokens). A DB tool can run arbitrary SQL,
# so "read-only" is not enough on its own — the role must not be able to SEE those
# tables at all. SELECT is therefore granted on an explicit allowlist of structural and
# operational tables, and everything holding secrets or personal conversation content is
# excluded. Extending the list is a deliberate act, not a default.
set -euo pipefail
NS=rag-chatbot
POD=postgres-ha-1
DB=assistant
ROLE=mcp_reader

# Random password generated IN the pod and written straight into a Secret; it is never
# printed and never reaches this transcript.
#
# NOTE: `kubectl exec` must take -i wherever a heredoc is piped in. Without it stdin is
# not forwarded, psql sees an empty script, exits 0, and the run looks successful while
# creating nothing — which is exactly what happened on the first attempt.
PW="$(kubectl -n $NS exec $POD -c postgres -- sh -c 'head -c 32 /dev/urandom | base64 | tr -d "=+/" | head -c 32')"

kubectl -n $NS exec -i $POD -c postgres -- psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN
    ALTER ROLE $ROLE WITH LOGIN PASSWORD '$PW';
  ELSE
    CREATE ROLE $ROLE WITH LOGIN PASSWORD '$PW';
  END IF;
END
\$\$;

-- Nothing by default; CONNECT plus an explicit table allowlist.
REVOKE ALL ON SCHEMA public FROM $ROLE;
GRANT CONNECT ON DATABASE $DB TO $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;

DO \$\$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'classifier_domains',    -- knowledge domains and their keywords
    'kb_meta',               -- knowledge-base article metadata
    'langchain_pg_collection', -- KB collections
    'departments', 'department_members',
    'app_groups', 'app_group_members',
    'rbac_matrix',           -- role -> capability map
    'jira_tickets',          -- escalation tickets
    'approvals',             -- escalation approvals
    'feedback'               -- answer ratings
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO $ROLE', t);
    END IF;
  END LOOP;
END
\$\$;

-- Belt and braces: if any of these ever gain SELECT via a future default privilege,
-- revoke it immediately.
DO \$\$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'local_user_credentials','api_keys','system_settings','users','user_settings',
    'user_permission_overrides','audit_log','chat_messages','chat_sessions',
    'chat_attachments','ticket_attachments','ticket_comments','runtime_kv',
    'checkpoints','checkpoint_blobs','checkpoint_writes','checkpoint_migrations'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM $ROLE', t);
    END IF;
  END LOOP;
END
\$\$;

-- No writes anywhere, and no future-default surprises.
ALTER ROLE $ROLE SET default_transaction_read_only = on;
SQL

# Verify from the database's own point of view, not from the grant statements.
echo "--- effective privileges ---"
kubectl -n $NS exec $POD -c postgres -- psql -U postgres -d "$DB" -Atc \
  "SELECT 'allowed: '||count(*) FROM information_schema.role_table_grants
    WHERE grantee='$ROLE' AND privilege_type='SELECT'"
kubectl -n $NS exec $POD -c postgres -- psql -U postgres -d "$DB" -Atc \
  "SELECT 'denied : '||string_agg(table_name, ', ' ORDER BY table_name)
     FROM information_schema.tables t
    WHERE t.table_schema='public'
      AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                      WHERE g.grantee='$ROLE' AND g.table_name=t.table_name)"

# Store the DSN in a Secret. The value is assembled in-cluster and never echoed.
kubectl -n $NS create secret generic postgres-mcp-credentials \
  --from-literal=DATABASE_URI="postgresql://$ROLE:$PW@postgres-ha-rw.$NS.svc.cluster.local:5432/$DB" \
  --dry-run=client -o yaml | kubectl apply -f -
echo "secret postgres-mcp-credentials applied (value not shown)"
