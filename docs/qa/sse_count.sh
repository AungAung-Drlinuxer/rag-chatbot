#!/bin/bash
TOKEN=$(curl -sk https://api.drlinuxer.com/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"ui-reviewer","password":"UiReview!x72"}' | python -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
curl -skN --max-time 90 https://api.drlinuxer.com/api/chat \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"What is the process to restart nginx?","session_id":"sse-count-3"}' > /tmp/sse_raw3.txt 2>&1
echo "stage events:"
grep -o '"detail": "[^"]*"' /tmp/sse_raw3.txt | head -12
echo "total event lines: $(grep -c '^event:' /tmp/sse_raw3.txt)"