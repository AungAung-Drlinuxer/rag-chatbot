/**
 * Render harness for the Tickets page — real component, real stylesheet, stubbed API.
 *
 * The fixture is shaped like `/api/tickets` and includes what the table has to survive:
 * 23 rows (so the pager is exercised), every status and priority, unassigned tickets,
 * overdue/soon due dates, and one very long subject.
 */
import "./styles.css";

import { createRoot } from "react-dom/client";
import TicketsPage from "./features/tickets/pages/TicketsPage";

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();

const SEED = [
  ["VPN drops every 20 minutes", "open", "high", "Network", "alice", null],
  ["Printer on floor 3 jams", "pending", "medium", "System", "bob", "carol"],
  ["PostgreSQL deadlock during month-end report", "resolved", "critical", "Database", "dave", "erin"],
  ["MFA prompt loop after password reset", "open", "critical", "Identity", "frank", null],
  ["Laptop battery swelling — replacement needed", "open", "high", "System", "grace", "carol"],
  ["Shared drive permissions missing for Finance", "closed", "low", "Identity", "heidi", "erin"],
  ["Kubernetes ingress returns 502 intermittently", "pending", "high", "Kubernetes", "ivan", null],
  ["Email quarantined messages not releasing", "open", "medium", "Email", "judy", "carol"],
  ["Conference room display will not connect", "pending", "low", "System", "ken", null],
  ["Oracle listener refuses connections from app tier", "open", "high", "Database", "laura", "erin"],
  ["Suspicious login alerts for service account", "open", "critical", "Identity", "mallory", null],
  ["Onboarding laptop not joined to the domain", "resolved", "medium", "System", "niaj", "carol"],
  ["VPN client crashes on macOS Sonoma", "open", "medium", "Network", "olivia", null],
  ["Slow query after index rebuild", "pending", "high", "Database", "peggy", "erin"],
  ["Cannot access Jira from the office network", "open", "low", "Network", "quinn", null],
  ["Mailbox full warnings for the shared inbox", "resolved", "low", "Email", "rupert", "carol"],
  ["Backup job fails nightly with timeout", "open", "critical", "System", "sybil", null],
  ["New starter needs Adobe licence", "closed", "low", "General", "trent", "carol"],
  ["Wi-Fi authenticates but no internet in building B", "pending", "medium", "Network", "uma", null],
  ["Invoice export produces an empty file", "open", "medium", "Database", "victor", "erin"],
  ["Password expiry notice never arrives", "resolved", "medium", "Identity", "wendy", "carol"],
  ["Docking station only detects one monitor", "open", "low", "System", "xavier", null],
  ["A very long subject line that has to truncate cleanly instead of pushing the status column out of alignment", "pending", "low", "General", "yara", "carol"],
] as const;

const TICKETS = SEED.map(([subject, status, priority, category, requester, assignee], i) => ({
  id: `IT-${100 + i}`,
  subject,
  description: `Fixture description for ${subject}.`,
  status,
  priority,
  category,
  requester,
  assignee,
  due_date: i % 4 === 0 ? iso(-2) : i % 4 === 1 ? iso(1) : null,
  created_at: iso(-(i + 3)),
  updated_at: iso(-i / 3),
}));

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (path === "/api/tickets") return json({ tickets: TICKETS });
  if (path === "/api/ticket-destinations") return json({ destinations: [{ key: "jira", label: "Jira", configured: true }] });
  if (path === "/api/domains") return json({ domains: [] });
  if (path.endsWith("/comments")) return json({ comments: [] });
  if (path.endsWith("/attachments")) return json({ attachments: [] });
  if (path.includes("assignable")) return json({ users: [{ username: "carol", email: null, role: "agent" }] });
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
  <TicketsPage role="admin" userName="alice" onToast={() => {}} />,
);
