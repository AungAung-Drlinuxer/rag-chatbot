#!/usr/bin/env bash
# Issue the two TLS secrets the Barman Cloud plugin needs, WITHOUT cert-manager.
#
# WHY NOT JUST INSTALL CERT-MANAGER
# The plugin's upstream manifest ships cert-manager Certificate/Issuer objects. Installing
# cert-manager would add a cluster-wide operator and its CRDs to a production cluster for
# the sake of two certificates in one namespace. Generating them here keeps the footprint
# to a namespace and makes the whole thing reversible with two `kubectl delete secret`.
#
# THE COST OF THAT CHOICE, STATED PLAINLY
# There is no automatic renewal. Upstream sets duration 2160h (90 days) and renewBefore
# 360h (15 days). Without cert-manager these expire after 90 days and the plugin stops
# working — so this script must be re-run on a schedule. It is idempotent; re-running
# replaces both secrets. See the renewal note printed at the end.
#
# The specs mirror the manifest exactly:
#   server: CN=barman-cloud,        SAN DNS:barman-cloud, EKU serverAuth
#   client: CN=barman-cloud-client,                       EKU clientAuth
# Both signed by one throwaway CA, and each secret carries ca.crt because the plugin
# verifies its peer against it.
set -euo pipefail
NS=cnpg-system
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

DAYS=90

# --- CA ---------------------------------------------------------------------
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt \
  -days "$DAYS" -subj "/CN=cnpg-system-barman-cloud-ca" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1

issue() {  # issue <name> <CN> <eku> [san]
  local name="$1" cn="$2" eku="$3" san="${4:-}"
  openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" \
    -subj "/CN=$cn" >/dev/null 2>&1
  local ext="extendedKeyUsage=$eku"
  if [ -n "$san" ]; then ext="$ext\nsubjectAltName=DNS:$san"; fi
  printf '%b\n' "[v3]\n$ext\nkeyUsage=digitalSignature,keyEncipherment" > "$name.ext"
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$name.crt" -days "$DAYS" -extfile "$name.ext" -extensions v3 >/dev/null 2>&1
}

issue barman-cloud-server barman-cloud serverAuth barman-cloud
issue barman-cloud-client barman-cloud-client clientAuth

# --- secrets ----------------------------------------------------------------
for pair in "barman-cloud-server-tls:barman-cloud-server" \
            "barman-cloud-client-tls:barman-cloud-client"; do
  secret="${pair%%:*}"; base="${pair##*:}"
  kubectl -n "$NS" create secret generic "$secret" \
    --from-file=tls.crt="$base.crt" \
    --from-file=tls.key="$base.key" \
    --from-file=ca.crt=ca.crt \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "  applied secret/$secret"
done

# --- confirm what was actually issued ---------------------------------------
echo "--- verification ---"
for pair in "barman-cloud-server-tls:barman-cloud-server" \
            "barman-cloud-client-tls:barman-cloud-client"; do
  secret="${pair%%:*}"; base="${pair##*:}"
  echo "  $secret"
  openssl x509 -in "$base.crt" -noout -subject -issuer -dates -ext extendedKeyUsage 2>/dev/null \
    | sed 's/^/     /'
done
echo
echo "RENEWAL: these expire in $DAYS days with no auto-renewal (cert-manager is not"
echo "installed). Re-run this script before then, or install cert-manager and apply the"
echo "upstream Certificate/Issuer objects instead."
