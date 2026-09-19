
"""Delete the broken backend:1.6.101 artifact from Harbor, after proving it is what it is.

WHY THIS EXISTS: a build whose failure was masked by `cmd | tail` (set -e does not see pipe
failures) pushed and DEPLOYED a backend whose module could not even be imported. Nothing
references it now, but a broken tag sitting in a registry is a foot-gun — the next person to
`kubectl set image ...:1.6.101` gets a broken pod with a 200 on /health.

Guards, in order:
  1. the credential comes from the docker helper and is never printed;
  2. the artifact must carry EXACTLY the tag being removed (a shared digest would take other
     tags with it);
  3. the digest must not be referenced by any running workload — checked by the caller;
  4. --confirm is required, so an accidental run lists and exits.
"""
import base64, json, os, ssl, subprocess, sys, urllib.request, urllib.error

HOST, PROJECT, REPO = "harbor.drlinuxer.com", "rag-chatbot", "backend"
TAG = sys.argv[1] if len(sys.argv) > 1 else "1.6.101"
CONFIRM = "--confirm" in sys.argv

raw = subprocess.run(["docker-credential-desktop", "get"], input=HOST,
                     capture_output=True, text=True, timeout=30)
cred = json.loads(raw.stdout)
user, secret = cred.get("Username", ""), cred.get("Secret", "")
del raw, cred
headers = {"Accept": "application/json"}
if user in ("<token>", ""):
    headers["Authorization"] = "Bearer " + secret
else:
    headers["Authorization"] = "Basic " + base64.b64encode(f"{user}:{secret}".encode()).decode()
del secret
ctx = ssl.create_default_context()

def api(path, method="GET"):
    req = urllib.request.Request(f"https://{HOST}/api/v2.0{path}", headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(body) if body.strip().startswith(("{", "[")) else body)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300].decode("utf-8", "replace")
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

# --- what is in the registry ----------------------------------------------------------
# Paged: Harbor caps page_size at 100 and this repository has more than that. An
# unpaged listing silently under-reports and can miss the artifact being searched for.
def all_artifacts():
    out, page = [], 1
    while True:
        st, chunk = api(f"/projects/{PROJECT}/repositories/{REPO}/artifacts"
                        f"?page_size=100&page={page}&with_tag=true")
        if st != 200:
            print("list failed:", st, chunk)
            sys.exit(1)
        if not chunk:
            return out
        out.extend(chunk)
        if len(chunk) < 100:
            return out
        page += 1

arts = all_artifacts()
total_mb = sum((a.get("size") or 0) for a in arts) / 1e6
print(f"{PROJECT}/{REPO}: {len(arts)} artifacts, {total_mb/1000:.1f} GB total")
print("  newest 6:", [t.get("name") for a in arts[:6] for t in (a.get("tags") or [])])

target = next((a for a in arts if TAG in [t.get("name") for t in (a.get("tags") or [])]), None)
if not target:
    print(f"{TAG} is not present — nothing to do."); sys.exit(0)

digest = target["digest"]
tags = [t.get("name") for t in (target.get("tags") or [])]
print(f"target: {digest}\n  tags on this digest: {tags}")
if tags != [TAG]:
    print(f"REFUSING: deleting this digest would also remove {[t for t in tags if t != TAG]}")
    sys.exit(3)

if not CONFIRM:
    print(f"\nDRY RUN — re-run with --confirm to delete {TAG}.")
    sys.exit(0)

st, out = api(f"/projects/{PROJECT}/repositories/{REPO}/artifacts/{digest}", "DELETE")
print("DELETE ->", st, "(202 = accepted)" if st == 202 else out)

# --- prove it is gone -----------------------------------------------------------------
arts2 = all_artifacts()
left = [t.get("name") for a in arts2 for t in (a.get("tags") or []) if t.get("name") == TAG]
print(f"re-list -> {len(arts2)} artifacts, {TAG} present: {bool(left)}")
print("RESULT:", "deleted ✅" if not left else "STILL PRESENT ❌")
