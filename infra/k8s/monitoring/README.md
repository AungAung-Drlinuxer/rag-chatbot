# Observability & Monitoring Setup (LGMT Stack)

This directory contains the Kubernetes manifests to deploy cluster telemetry agents that export logs, metrics, and traces to the external LGMT host (`10.10.10.18`).

## Architecture

```text
[ drlinuxer-prod RKE2 Cluster ]
  │
  ├── 01-kube-state-metrics.yaml  (K8s objects state: pods, nodes, deployments)
  ├── 02-node-exporter.yaml       (Host hardware metrics: CPU, RAM, Disk, Network)
  └── 03-grafana-alloy.yaml       (Unified telemetry agent DaemonSet)
        ├── Scrapes KSM + Node Exporter + cAdvisor ──► Prometheus (http://10.10.10.18:9090/api/v1/write)
        └── Scrapes /var/log/pods/*/*/*.log       ──► Loki       (http://10.10.10.18:3100/loki/api/v1/push)

[ rag-chatbot Backend ]
  └── OpenTelemetry SDK           (Traces per chat query) ──► Tempo (http://10.10.10.18:4318/v1/traces)
```

## Quick Deployment

```bash
# Apply the complete monitoring stack via Kustomize:
kubectl apply -k infra/k8s/monitoring/

# Verify running pods in monitoring namespace:
kubectl -n monitoring get pods -o wide
```

## External LGMT Endpoints (10.10.10.18)

- **Grafana Web UI:** `http://10.10.10.18:3000` (User: `admin` / Password: `[CONFIGURED]`)
  - Dashboards:
    - *IT Help Chatbot - Observability & LGMT:* `/d/apjntq/rag-chatbot-observability-and-lgmt`
    - *IT Help Chatbot - APM & Tracing (RAG Deep Dive):* `/d/az9v2m/rag-chatbot-apm-and-tracing-rag-deep-dive`
- **Prometheus:** `http://10.10.10.18:9090`
- **Loki:** `http://10.10.10.18:3100`
- **Tempo:** `http://10.10.10.18:3200` (Search / HTTP) & `http://10.10.10.18:4318` (OTLP receiver)
