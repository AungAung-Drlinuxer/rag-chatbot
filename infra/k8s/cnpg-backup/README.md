# CNPG point-in-time backup (Option C — external S3)

## State before this work

```
spec.backup                       empty
Backup CR                          none
ScheduledBackup CR                 none
firstRecoverabilityPoint           empty      <- the honest indicator
lastArchivedWal                    empty      <- nothing had ever been archived
status.conditions ContinuousArchiving = True  <- A FALSE SIGNAL
```

`archive_mode=on` was set but there was no object store, so every WAL segment was
discarded. The `ContinuousArchiving: True` condition reports "Continuous archiving is
working" while `firstRecoverabilityPoint` and `lastArchivedWal` are both empty — trust
those two fields, not the condition. **Effective RPO was infinite**: neither node loss
nor a mistaken `DELETE` was recoverable. HA (3 instances, synchronous) protects against a
node dying; it does not protect against a logical error, which is the failure this estate
has already experienced once.

## State after the preparation in this directory

```
Barman Cloud plugin      Running in cnpg-system (v0.6.0, registered and listening :9090)
TLS for the plugin       issued and mounted (not via cert-manager — see below)
ObjectStore CRD          installed
S3 credentials           NOT YET — this is the only missing piece
```

### The plugin is not from the upstream manifest verbatim

Upstream's `manifest.yaml` ships cert-manager `Certificate`/`Issuer` objects. Installing
cert-manager would add a cluster-wide operator and its CRDs to production for the sake of
two certificates in one namespace, so the certs are issued by
`10-issue-plugin-certs.sh` instead and applied as plain Secrets.

**The cost of that choice:** no automatic renewal. The certs last 90 days
(`notAfter=Dec 17 2026` from the run on Sep 18 2026) and then the plugin stops working.
Re-run `10-issue-plugin-certs.sh` before then — it is idempotent — or install cert-manager
and apply upstream's Certificate objects instead.

## What is still needed: one bucket and its keys

Nothing else. Everything after this is mechanical.

### 1. Create the bucket

Any S3-compatible store. `s3.amazonaws.com` is already reachable from a pod in this
cluster (verified: HTTP 307), so a cloud bucket needs no network change.

```
bucket:     <your bucket>
prefix:     rag-chatbot-postgres
endpoint:   <provider endpoint>          # omit for AWS in its default region
region:     <region>
```

### 2. Create the credentials secret

Run this yourself — the values do not belong in a chat transcript or in git:

```bash
kubectl -n rag-chatbot create secret generic cnpg-backup-s3 \
  --from-literal=ACCESS_KEY_ID='...' \
  --from-literal=SECRET_ACCESS_KEY='...' \
  --from-literal=REGION='...' \
  --dry-run=client -o yaml | kubectl apply -f -
```

The access key needs exactly four permissions on that one prefix and nothing else:

```
s3:GetObject  s3:PutObject  s3:DeleteObject  s3:ListBucket
```

### 3. Apply the rest (in this order)

```bash
# point the ObjectStore at the bucket — edit destinationPath/endpointURL first
kubectl apply -f 30-objectstore.yaml

# tell the cluster to use the plugin as its WAL archiver
kubectl -n rag-chatbot patch clusters.postgresql.cnpg.io postgres-ha --type merge -p '
spec:
  plugins:
    - name: barman-cloud.cloudnative-pg.io
      isWALArchiver: true
      parameters:
        barmanObjectName: cnpg-backup-store'

# the schedule, LAST so the first run has a destination
kubectl apply -f 40-scheduledbackup.yaml
```

### 4. Prove it, do not assume it

```bash
# a real backup on demand
kubectl -n rag-chatbot create -f - <<'YAML'
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: postgres-ha-manual-verify
  namespace: rag-chatbot
spec:
  cluster: {name: postgres-ha}
  method: plugin
  pluginConfiguration: {name: barman-cloud.cloudnative-pg.io}
YAML

kubectl -n rag-chatbot get backup postgres-ha-manual-verify -w
```

Then confirm the two fields that actually mean something:

```bash
kubectl -n rag-chatbot get clusters.postgresql.cnpg.io postgres-ha \
  -o jsonpath='{.status.firstRecoverabilityPoint} {.status.lastArchivedWal}{"\n"}'
```

Both must be populated. A backup that reports `completed` while
`firstRecoverabilityPoint` is still empty has not produced a restore point.

Finally, the only test that counts — restore into a throwaway cluster and read a row
back. A backup nobody has restored is a hypothesis, not a backup.

## Sizing

```
current database   30Gi per instance x3 (actual data is far smaller)
full backup        ~200-500 MB compressed
WAL                continuous, compressed
retention 14d      a 20-50 GiB bucket is comfortable
```
