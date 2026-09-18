#!/usr/bin/env bash
# Prove the Garage credentials work BEFORE wiring them into CNPG.
#
# WHY TEST FIRST: if the key is wrong, the bucket is not granted, or the region string
# does not match, a CNPG backup fails with an opaque error — after the cluster has already
# been changed. This exercises exactly what barman will do (PUT, GET, DELETE, LIST against
# the real endpoint) while the cluster is still untouched.
#
# The credentials come from the Secret via envFrom, so they never appear in this script,
# on a command line, or in the transcript.
#
# NOTE ON THE FIRST ATTEMPT: the pod YAML was piped through an UNQUOTED heredoc, so the
# outer shell expanded `$ENDPOINT`/`$REGION` before kubectl ever saw it — producing an
# "EP: unbound variable" from the outer `set -u` and an empty manifest. The YAML is now a
# file, which removes the class of bug entirely rather than escaping around it.
set -euo pipefail
NS=rag-chatbot
POD=garage-cred-check
ENDPOINT="https://s3.drlinuxer.com"
BUCKET="production-backups"
PREFIX="rag-chatbot-postgres"
# A Windows-visible temp dir. TMPDIR is /tmp in this MSYS shell, but kubectl is a NATIVE
# binary and MSYS paths are not translated for it — it reports the file as missing. Use a
# real Windows path instead.
WORK="$(mktemp -d "${LOCALAPPDATA:-$HOME}/Temp/garage-cred-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "=== 1. secret shape (which keys exist, and the region, never the secrets) ==="
kubectl -n "$NS" get secret cnpg-backup-s3 -o jsonpath='{.data}' | python -c "
import sys, json
d = json.loads(sys.stdin.read() or '{}')
for k in sorted(d):
    print(f'   {k:20} set ({len(d[k])} b64 chars)')
"
printf '   REGION value        : '
kubectl -n "$NS" get secret cnpg-backup-s3 -o jsonpath='{.data.REGION}' | base64 -d
echo

echo "=== 2. exercise the credentials the way barman will ==="
cat > "$WORK/pod.yaml" <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: garage-cred-check
  namespace: rag-chatbot
spec:
  restartPolicy: Never
  containers:
    - name: aws
      image: amazon/aws-cli:2.17.0
      # The Secret uses CNPG's key names (ACCESS_KEY_ID / SECRET_ACCESS_KEY / REGION),
      # which is what the ObjectStore CR references by name. aws-cli expects the AWS_*
      # spelling, so they are mapped explicitly rather than via envFrom — envFrom would
      # inject ACCESS_KEY_ID, which aws-cli ignores.
      env:
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef: {name: cnpg-backup-s3, key: ACCESS_KEY_ID}
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef: {name: cnpg-backup-s3, key: SECRET_ACCESS_KEY}
        - name: AWS_DEFAULT_REGION
          valueFrom:
            secretKeyRef: {name: cnpg-backup-s3, key: REGION}
        - name: AWS_EC2_METADATA_DISABLED
          value: "true"
      command: ["/bin/sh", "-c"]
      args:
        - |
          set -e
          EP="https://s3.drlinuxer.com"
          export AWS_DEFAULT_REGION="$REGION"
          echo "  region in use : $REGION"
          echo "  --- LIST bucket (proves key + grant + region) ---"
          aws --endpoint-url "$EP" s3 ls "s3://production-backups/" && echo "  LIST ok" || echo "  LIST FAILED"
          echo "  --- PUT probe object ---"
          echo "probe $(date -u +%FT%TZ)" > /tmp/p.txt
          aws --endpoint-url "$EP" s3 cp /tmp/p.txt "s3://production-backups/rag-chatbot-postgres/_probe.txt" \
            && echo "  PUT ok" || echo "  PUT FAILED"
          echo "  --- GET it back ---"
          aws --endpoint-url "$EP" s3 cp "s3://production-backups/rag-chatbot-postgres/_probe.txt" - \
            && echo "  GET ok" || echo "  GET FAILED"
          echo "  --- DELETE it ---"
          aws --endpoint-url "$EP" s3 rm "s3://production-backups/rag-chatbot-postgres/_probe.txt" \
            && echo "  DELETE ok" || echo "  DELETE FAILED"
          echo "  --- checksum workaround (the x-amz-content-sha256 class of failure) ---"
          AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
            aws --endpoint-url "$EP" s3 cp /tmp/p.txt "s3://production-backups/rag-chatbot-postgres/_probe2.txt" \
            && echo "  PUT with checksum=when_required ok" || echo "  PUT with workaround FAILED"
          aws --endpoint-url "$EP" s3 rm "s3://production-backups/rag-chatbot-postgres/_probe2.txt" >/dev/null 2>&1 || true
YAML

kubectl -n "$NS" delete pod "$POD" --ignore-not-found >/dev/null 2>&1
kubectl -n "$NS" apply -f "$WORK/pod.yaml" >/dev/null
kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$POD" --timeout=180s >/dev/null 2>&1 \
  || kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Failed pod/"$POD" --timeout=10s >/dev/null 2>&1 || true
kubectl -n "$NS" logs "$POD" 2>&1 | tail -22
echo
echo "=== 3. cleanup ==="
kubectl -n "$NS" delete pod "$POD" --wait=false >/dev/null 2>&1
echo "   probe pod removed"
