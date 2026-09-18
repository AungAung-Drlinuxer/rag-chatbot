#!/usr/bin/env bash
# Diagnose the GET/HeadObject 400.
#
# LIST, PUT and DELETE all succeeded, but GET failed. That matters more than the others:
# a backup is only real if the restore path can READ the objects back, and barman's
# restore does GET/HEAD. So this isolates the cause instead of accepting a working-looking
# backup.
#
# Candidates, tested one at a time:
#   a) empty region — the first run exported AWS_DEFAULT_REGION="$REGION" while REGION was
#      not in the environment (it was set as AWS_DEFAULT_REGION), wiping it to ""
#   b) aws-cli 2.x checksum headers on GET/HEAD, which Garage does not implement
#   c) a Garage-side quirk on small objects / HEAD semantics
set -euo pipefail
NS=rag-chatbot
POD=garage-get-diag
WORK="$(mktemp -d "${LOCALAPPDATA:-$HOME}/Temp/garage-get-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/pod.yaml" <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: garage-get-diag
  namespace: rag-chatbot
spec:
  restartPolicy: Never
  containers:
    - name: aws
      image: amazon/aws-cli:2.17.0
      env:
        - name: AWS_ACCESS_KEY_ID
          valueFrom: {secretKeyRef: {name: cnpg-backup-s3, key: ACCESS_KEY_ID}}
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom: {secretKeyRef: {name: cnpg-backup-s3, key: SECRET_ACCESS_KEY}}
        - name: S3_REGION
          valueFrom: {secretKeyRef: {name: cnpg-backup-s3, key: REGION}}
        - name: AWS_EC2_METADATA_DISABLED
          value: "true"
      command: ["/bin/sh", "-c"]
      args:
        - |
          EP="https://s3.drlinuxer.com"
          B="s3://production-backups/rag-chatbot-postgres"
          echo "  S3_REGION from secret: '$S3_REGION'"
          echo "  1 MiB object so this is not a tiny-object edge case"
          head -c 1048576 /dev/urandom > /tmp/big.bin
          KEY="$B/_gettest.bin"

          echo "  --- A) with the CORRECT region, plain ---"
          AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url "$EP" s3 cp /tmp/big.bin "$KEY" >/dev/null 2>&1 \
            && echo "     PUT ok" || echo "     PUT FAILED"
          AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url "$EP" s3 cp "$KEY" /tmp/back.bin \
            && echo "     GET ok ($(wc -c </tmp/back.bin) bytes)" || echo "     GET FAILED"

          echo "  --- B) correct region + checksum=when_required ---"
          AWS_DEFAULT_REGION="$S3_REGION" AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
          AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
            aws --endpoint-url "$EP" s3 cp "$KEY" /tmp/back2.bin \
            && echo "     GET ok ($(wc -c </tmp/back2.bin) bytes)" || echo "     GET FAILED"

          echo "  --- C) head-object directly ---"
          AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url "$EP" s3api head-object --bucket production-backups --key rag-chatbot-postgres/_gettest.bin \
            >/dev/null 2>&1 && echo "     HEAD ok" || echo "     HEAD FAILED"

          echo "  --- D) a plain curl GET with sigv4 (what barman effectively does) ---"
          AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url "$EP" s3 presign "$KEY" --expires-in 300 > /tmp/url.txt 2>/dev/null
          if [ -s /tmp/url.txt ]; then
            echo "     presigned GET -> HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 15 "$(cat /tmp/url.txt)")"
          else
            echo "     could not presign"
          fi

          echo "  --- E) existing object in the bucket (payload.txt listed earlier) ---"
          AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url "$EP" s3 cp "s3://production-backups/payload.txt" /tmp/p2.bin \
            && echo "     GET payload.txt ok ($(wc -c </tmp/p2.bin) bytes)" || echo "     GET payload.txt FAILED"

          AWS_DEFAULT_REGION="$S3_REGION" aws --endpoint-url "$EP" s3 rm "$KEY" >/dev/null 2>&1 || true
YAML

kubectl -n "$NS" delete pod "$POD" --ignore-not-found >/dev/null 2>&1
kubectl -n "$NS" apply -f "$WORK/pod.yaml" >/dev/null
kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$POD" --timeout=200s >/dev/null 2>&1 \
  || kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Failed pod/"$POD" --timeout=10s >/dev/null 2>&1 || true
kubectl -n "$NS" logs "$POD" 2>&1 | tail -20
kubectl -n "$NS" delete pod "$POD" --wait=false >/dev/null 2>&1