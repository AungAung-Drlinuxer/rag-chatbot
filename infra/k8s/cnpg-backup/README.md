# CNPG point-in-time backup — Garage (self-hosted S3)

**Status: WORKING AND RESTORE-TESTED.** A base backup plus continuous WAL archiving to
Garage, with a verified restore into a throwaway cluster.

## What was wrong before

```
spec.backup                       empty
Backup CR                          none
ScheduledBackup CR                 none
archive_mode                       on, but nothing to archive to
```

`archive_mode=on` was set while no object store existed, so every WAL segment was
discarded and `status.conditions` still reported `ContinuousArchiving: True`
("Continuous archiving is working"). **Effective RPO was infinite.**

HA (3 instances, synchronous replication) protects against a node dying. It does not
protect against a logical error — and this estate has already lost configuration rows to a
mistaken delete once. That is the failure this directory exists to survive.

## Two corrections to earlier guidance in this repo

Both were mine and both were wrong; recording them because the wrong version is the kind
of thing that gets copied forward.

### 1. cert-manager is a REQUIRED prerequisite, not an optional convenience

I first issued the plugin's two TLS secrets by hand with `openssl`
(`10-issue-plugin-certs.sh`, now superseded) to avoid adding a cluster-wide operator.
Attaching the plugin then failed with:

```
while querying plugin identity: rpc error: code = Unavailable desc = connection error:
desc = "error reading server preface: remote error: tls: certificate required"
```

The upstream installation guide lists **cert-manager as a required check** ("Both checks
are required before proceeding"), and `manifest.yaml` ships `Certificate` + `Issuer`
objects. The trust relationship is mutual — the operator must present a client
certificate the plugin can verify against the same CA — and hand-made certs do not
establish it. cert-manager v1.21.2 is now installed and owns both certificates, which also
restores automatic renewal (the hand-rolled certs would have expired Dec 17 2026 and
silently killed the plugin).

`10-issue-plugin-certs.sh` is kept only as the record of a dead end. Do not run it; it
deletes the cert-manager-managed secrets' contents if it is run after the fact.

### 2. `firstRecoverabilityPoint` and `lastArchivedWal` are never set for plugins

The Cluster CRD says so itself:

```
firstRecoverabilityPoint:  "Deprecated: the field is not set for backup plugins."
lastArchivedWal:           "Deprecated: the field is not set for backup plugins."
lastSuccessfulBackup:      "Deprecated: the field is not set for backup plugins."
firstRecoverabilityPointByMethod / lastSuccessfulBackupByMethod — same
```

Earlier notes in this repo told the reader to watch those two fields as "the honest
indicators". That was true for the in-tree `spec.backup.barmanObjectStore` path and is
**wrong for the plugin path** — they stay empty forever, by design. Watching them means
concluding a healthy backup is broken.

What the plugin path does set:

```
status.pluginStatus   = [{name: barman-cloud.cloudnative-pg.io, version: 0.6.0,
                          capabilities: [TYPE_RECONCILER_HOOKS, TYPE_LIFECYCLE_SERVICE]}]
```

## Verify it this way instead

Three layers, weakest to strongest. Only the third proves anything.

**1. The Backup object**

```bash
kubectl -n rag-chatbot get backup.postgresql.cnpg.io manual-verify-1 \
  -o jsonpath='{.status.phase} {.status.backupId} {.status.error}{"\n"}'
# completed 20260918T121505
```

**2. Objects actually in the bucket** — `completed` means the operator saw a clean exit,
not that bytes landed:

```bash
aws --endpoint-url https://s3.drlinuxer.com s3 ls \
  s3://production-backups/rag-chatbot-postgres/ --recursive --human-readable
```

```output
  30.7 MiB  postgres-ha/base/20260918T121505/data.tar.gz
   1.4 KiB  postgres-ha/base/20260918T121505/backup.info
  16.2 KiB  postgres-ha/wals/0000000300000004/0000000300000004000000F5.gz
```

**3. A real restore.** This is the only test that counts. Measured on 2026-09-18:

```bash
# cluster restore-verify, bootstrap.recovery + externalClusters[].plugin
kubectl -n rag-chatbot exec restore-verify-1 -c postgres -- \
  psql -U postgres -d assistant -tAc "select count(*) from langchain_pg_embedding;"
```

```
table                      production   restored
kb_meta                           229        229   match
users                               5          5   match
classifier_domains                 11         11   match
chat_messages                     502        502   match
langchain_pg_embedding           1002       1002   match
```

Then delete the test cluster. A backup nobody has restored is a hypothesis.

## Garage: three provider-specific facts that each break the backup alone

Garage is S3-compatible but not AWS, and the differences show up as misleading errors.
All three were found by probing the live endpoint, not from the generic S3 example.

**1. Region is `garage`.** A `GET /` against the endpoint returns
`<Region>garage</Region>`. boto3 signs every request with the configured region, so
`us-east-1` produces `SignatureDoesNotMatch`. The Secret's `REGION` must be exactly
`garage`.

**2. Checksum headers.** Recent boto3 enables S3 data-integrity protections that Garage
does not implement (upstream: plugin-barman-cloud#393). Handled in `30-objectstore.yaml`
with `instanceSidecarConfiguration.env`:

```yaml
AWS_REQUEST_CHECKSUM_CALCULATION: when_required
AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
```

Without it the first backup fails with an `x-amz-content-sha256` error that reads like bad
credentials. Confirmed the installed v0.6.0 CRD supports
`instanceSidecarConfiguration`.

**3. Path-style needs no flag.** barman-cloud addresses path-style whenever `endpointURL`
is set, which is why upstream labels its DigitalOcean Spaces example path-style with
nothing to configure. `destinationPath` is `s3://<bucket>/<prefix>` and `endpointURL`
carries no bucket.

Also verified: `s3.drlinuxer.com` → `10.10.10.16`, reachable from a pod, TLS verifies
cleanly (`ssl_verify_result=0`), so no `endpointCA` is needed.

## Files

```
10-issue-plugin-certs.sh            DEAD END — superseded by cert-manager. Do not run.
15-verify-garage-credentials.sh     PUT/GET/HEAD/DELETE against Garage using the Secret
                                    (envFrom maps CNPG's key names to AWS_* — aws-cli
                                    ignores ACCESS_KEY_ID, which looks like a bad key)
16-diagnose-garage-get.sh           isolates a GET/HEAD 400 by varying one factor at a time
20-s3-credentials.secret.example.yaml   template; create the real Secret with kubectl
30-objectstore.yaml                 Garage-specific ObjectStore (region + checksum env)
40-scheduledbackup.yaml             daily 02:00 Asia/Yangon = "0 30 19 * * *" (UTC)
```

## Current configuration

```
ObjectStore    cnpg-backup-store     s3://production-backups/rag-chatbot-postgres
endpoint       https://s3.drlinuxer.com        region garage        retention 14d
Cluster        spec.plugins[0] = barman-cloud.cloudnative-pg.io, isWALArchiver: true
archive_command  /controller/manager wal-archive --log-destination /controller/log/postgres.json %p
ScheduledBackup  postgres-ha-nightly           "0 30 19 * * *"  -> 02:00 Asia/Yangon
Secret         rag-chatbot/cnpg-backup-s3      ACCESS_KEY_ID / SECRET_ACCESS_KEY / REGION
cert-manager   v1.21.2 in cert-manager ns, owns barman-cloud-{server,client}-tls
```

Sizing: 30.7 MiB base backup compressed, ~16-20 KiB per WAL segment, 14-day retention —
a 20-50 GiB bucket is comfortable.

## Restoring into production (PITR)

```yaml
spec:
  bootstrap:
    recovery:
      source: origin
      # recoveryTarget: {targetTime: "2026-09-18 12:00:00+06:30"}   # omit for "latest"
  externalClusters:
    - name: origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: cnpg-backup-store
          serverName: postgres-ha
```

Point `targetTime` at any moment inside the retention window, run this against a **new**
cluster name first, compare the data, and only then cut over.
