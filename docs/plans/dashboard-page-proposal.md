# Desktop App — Dashboard Page Design Proposal (Section-by-Section)

> Status: PROPOSAL (no code changes yet — awaiting approval)
> Date: 2026-09-10
> Context: "ဘာတွေထားသင့်လဲ" — what belongs on the desktop Dashboard page for an
> on-prem enterprise IT assistant, for BOTH end users and admins.

---

## Current State Audit (what exists today)

| Section | Status | Issue |
|---|---|---|
| KPI: Total Conversations, Resolved by Bot, Escalated to Tickets, Active Users | ✅ real data from `/api/dashboard/stats` | ⚠️ Change % (`+18.6%`, `+22.4%`, `−8.3%`, `+12.7%`) are **hard-coded fake numbers** — violates the no-mock-data rule |
| Conversations over time chart | ✅ real (`/api/dashboard/conversations`) | OK |
| Domains breakdown | ✅ real (`/api/dashboard/domains`) | OK |
| Recent conversations | ✅ real | OK |
| Recent tickets | ✅ real (Jira + OpenProject merged) | OK |
| System health | ⚠️ `/api/dashboard/health` | "All systems operational" badge is **static** — always green regardless of actual health |
| — | — | ❌ No security visibility (guardrails shipped in v1.1.4–1.1.6 but dashboard doesn't show them) |
| — | — | ❌ No RBAC awareness — a normal User sees the same admin-ish dashboard |

---

## Proposed Section Layout (top → bottom)

### Section 1 — KPI Row (6 cards, role-aware)

Keep 4 existing + add 2, and FIX the fake percentages:

| Card | Value source | Change % fix |
|---|---|---|
| Total Conversations (7d) | `stats.total_conversations` ✅ | Compute real delta: `count(this week) vs count(prev week)` — backend already has the query shape; needs one extra query |
| Resolved by Bot | `stats.resolved_by_bot` ✅ | Same real-delta approach |
| Escalated to Tickets | `stats.escalated_to_tickets` ✅ | Same |
| Active Users | `stats.active_users` ✅ | Same |
| **NEW: KB Articles** | `stats.kb_pages` (already returned but unused!) | Show article count + last-sync freshness instead of % |
| **NEW: Attacks Blocked (7d)** | `audit_log WHERE action LIKE 'guardrail%' AND created_at >= now()-7d` | Security visibility where it belongs — admins only |

**Rule:** if a real delta cannot be computed, **show nothing** (hide the change pill) — never fake numbers.

### Section 2 — Operational Charts Row (3 columns, existing + 1 upgrade)

1. **Conversations over time** (keep) — real series
2. **Domain distribution** (keep) — real series
3. **NEW: Confidence & Gate trend** — from `chat_messages.meta` JSON: how many
   answers passed the 0.75 gate vs cautioned, daily. This is the single best
   "is the assistant trustworthy" at-a-glance metric and the data already exists.

### Section 3 — Lists Row (existing)

1. **Recent conversations** (keep)
2. **Recent tickets** (keep — Jira + OpenProject unified with source badges)

### Section 4 — System Health (upgrade, not replace)

Current rows (database/redis/ollama/rerank/LDAP/Jira...) keep, but:

- **Fix the static badge**: "All systems operational" must be computed from the
  actual health payload (green only if all `healthy`).
- Add **Guardrail service row** — reflects input-screening activity, links to
  Grafana security row.
- Add **Grafana deep-link button** (top-right of the card) — jumps to the
  Platform Health dashboard for the full picture; desktop dashboard stays light,
  Grafana stays the deep-dive tool (already built — avoid duplicating it).

### Section 5 — Quick Actions (NEW, small)

A compact row of role-filtered shortcuts (reduces navigation clicks):

- Everyone: **Ask a question** (→ Chat), **Browse knowledge** (→ Knowledge)
- Knowledge Manager: **Sync KB now**, **Create article**
- Admin: **Users**, **Audit log**, **Integrations**

RBAC-driven (`perms` object already available in the page) — Users never see
admin shortcuts. This directly serves the "self-service admin" goal.

---

## What NOT to put on this page (and why)

| Tempting item | Why it's excluded |
|---|---|
| Full Grafana embed (iframe) | Grafana dashboards already exist, are heavy, and need auth — a deep-link is better; embedding duplicates maintenance |
| Token/cost metrics | LLM cost belongs to Grafana LLM Observability; showing cost to end users creates anxiety with no action they can take |
| Prometheus raw metrics | Wrong audience — this page is business-level |
| Traces / Service Graph | Deep-debugging tool, not a dashboard landing widget |
| Live pod CPU/memory | Infra concern; System Health rows + Grafana cover it |
| Feedback sentiment charts (nice-to-have later) | Data volume still small; defer until meaningful sample exists |

---

## Data-source summary (all real, nothing mocked)

| Data | Source | Status |
|---|---|---|
| KPI stats + real deltas | `/api/dashboard/stats` + 1 new prev-week query | 1 small backend addition |
| KB article count + freshness | `stats.kb_pages` + `kb_meta.last_synced` | already in DB |
| Attacks blocked (7d) | `audit_log` | table exists |
| Gate pass/caution trend | `chat_messages.meta->decision` | data exists |
| Service health | `/api/dashboard/health` | exists; fix badge logic |
| Quick actions | existing routes | frontend only |

---

## Implementation estimate

| Phase | Work |
|---|---|
| 1 | Remove fake % pills; backend adds prev-week deltas (real change %) |
| 2 | Add KB Articles + Attacks Blocked KPIs (admin-only for the security one) |
| 3 | Fix health badge logic + add Grafana deep-link + guardrail row |
| 4 | Quick Actions row (RBAC-filtered) + Gate trend chart |

**Say "Ok" (or pick phases) and I'll implement.**
