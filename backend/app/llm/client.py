"""Streaming + token-usage helpers for the LLM layer.

We stream the chat model DIRECTLY (not through the `prompt | llm | StrOutputParser`
LCEL chain) because StrOutputParser strips the AIMessageChunk to a plain string and
loses `usage_metadata`. `stream_with_usage` replicates the prompt inline and keeps
each chunk accessible for `extract_usage`.
"""
from __future__ import annotations

from collections.abc import Iterable

from app.llm.models import UsageDict
from app.llm.prompts import SYSTEM_PROMPT


def extract_usage(chunk) -> UsageDict:
    """Pull a normalized {input,output,total} usage dict from an AIMessageChunk.

    LangChain places token usage either on `usage_metadata` (preferred, set when
    the chat model was configured with `stream_usage=True`) or under
    `response_metadata.usage` (Anthropic). We try both.
    """
    if chunk is None:
        return None
    meta = getattr(chunk, "usage_metadata", None)
    if meta and (meta.get("input_tokens") or meta.get("output_tokens") or meta.get("total_tokens")):
        return {
            "input_tokens": int(meta.get("input_tokens") or 0),
            "output_tokens": int(meta.get("output_tokens") or 0),
            "total_tokens": int(meta.get("total_tokens") or 0),
        }
    rm = getattr(chunk, "response_metadata", None) or {}
    usage = rm.get("usage") if isinstance(rm, dict) else None
    if usage and (usage.get("input_tokens") or usage.get("output_tokens") or usage.get("total_tokens")):
        return {
            "input_tokens": int(usage.get("input_tokens") or 0),
            "output_tokens": int(usage.get("output_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or (usage.get("input_tokens", 0) + usage.get("output_tokens", 0))),
        }
    return None


# Back-compat alias (tests import the underscored name).
_extract_usage = extract_usage


def format_messages(question: str, context: str):
    from langchain_core.prompts import ChatPromptTemplate

    prompt = ChatPromptTemplate.from_messages([("system", SYSTEM_PROMPT), ("human", "{question}")])
    return prompt.format_messages(question=question, context=context)


def stream_with_usage(llm, question: str, context: str) -> Iterable[tuple[str, UsageDict]]:
    """Stream the chat model and yield (token, usage). `usage` is non-None on the
    LAST pair (a zero-length sentinel)."""
    msg = format_messages(question, context)
    last_usage: UsageDict = None
    for chunk in llm.stream(msg):
        text = getattr(chunk, "content", "") or ""
        u = extract_usage(chunk)
        if u:
            last_usage = u
        if text:
            yield text, None
    if last_usage is not None:
        yield "", last_usage
