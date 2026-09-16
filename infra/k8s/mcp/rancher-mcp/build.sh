#!/usr/bin/env bash
# Build + publish rancher-mcp.
#
# There is no upstream published image, so this repo owns the build. The npm
# package is a thin JS wrapper around a native Go binary; the Dockerfile is
# multi-stage and ships only the binary (see the note in that file).
set -euo pipefail
VER="${1:?usage: build.sh <version>  e.g. build.sh 1.0.2}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
IMG="harbor.drlinuxer.com/rag-chatbot/rancher-mcp:${VER}"
echo "building $IMG"
docker build -t "$IMG" .
docker push "$IMG"
docker images "$IMG" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
echo
echo "deploy:  kubectl apply -f 20-rbac.yaml && kubectl apply -f 10-deployment.yaml"
