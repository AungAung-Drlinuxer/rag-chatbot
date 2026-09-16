#!/usr/bin/env bash
# Build rerank-svc. The source files are numbered (01-app.py, 02-Dockerfile,
# 03-pyproject.toml, 04-uv.lock) but the Dockerfile expects UNPREFIXED names
# (app.py, pyproject.toml, uv.lock) in the build context — there was no build
# script in the repo, so this was being done by hand and a missed rename fails
# with "failed to compute cache key: /uv.lock not found".
set -euo pipefail
VER="${1:?usage: build.sh <version>  e.g. build.sh 1.0.2}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

cleanup() { rm -f app.py pyproject.toml uv.lock Dockerfile; }
trap cleanup EXIT

cp 01-app.py        app.py
cp 03-pyproject.toml pyproject.toml
cp 04-uv.lock       uv.lock

IMG="harbor.drlinuxer.com/rag-chatbot/rerank-svc:${VER}"
echo "building $IMG"
docker build -f 02-Dockerfile -t "$IMG" .
docker push "$IMG"
docker images "$IMG" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'