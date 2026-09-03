/** Chat streaming contract — the ONLY place SSE events are interpreted.
 *
 * Backend /api/chat/stream emits: meta → stage* → token* → (approval_request)? → done
 * This module maps raw events to typed callbacks; the page wires them to state.
 * Keeping the parsing here means the HITL (LangGraph interrupt) contract, the
 * confidence/sources meta shape, and token accumulation live in ONE file.
 */
import { streamChat } from "@/features/chat/api";

export type StreamHandlers = {
  onMeta: (meta: any) => void;
  onToken: (token: string) => void;
  onStage: (detail: string) => void;
  onApprovalRequest: (data: any) => void;
  onDone: (d: any) => void;
};

export async function runChatStream(
  question: string,
  sessionId: string,
  history: { role: string; content: string }[],
  h: StreamHandlers
): Promise<string> {
  let streamed = "";
  await streamChat(question, sessionId, history, (e) => {
    if (e.event === "meta") {
      h.onMeta(e.data ?? {});
    } else if (e.event === "token") {
      const token =
        typeof e.data === "string"
          ? e.data
          : (e.data?.token ?? e.data?.text ?? "");
      streamed += token;
      h.onToken(token);
    } else if (e.event === "stage") {
      h.onStage(e.data?.detail || e.data?.stage || "");
    } else if (e.event === "approval_request") {
      h.onApprovalRequest(e.data);
    } else if (e.event === "done") {
      h.onDone(e.data ?? {});
    }
  });
  return streamed;
}
