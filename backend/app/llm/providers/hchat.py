"""H-Chat + local-Ollama chain builders (LangChain LCEL runnables).

`hchat_provider` selects the client: `anthropic` (H-Chat/Claude-compatible) or
`openai` (OpenAI-compatible gateways, e.g. OpenRouter). Local Ollama is the
on-prem CPU fallback. Each builder returns a `prompt | llm | StrOutputParser`
chain; `get_chat_model()` variants return the bare chat model for streaming
callers that must read `usage_metadata` off the raw chunks.
"""
from __future__ import annotations

from app.core.config import SETTINGS
from app.llm.prompts import SYSTEM_PROMPT


def _prompt():
    from langchain_core.prompts import ChatPromptTemplate

    return ChatPromptTemplate.from_messages([("system", SYSTEM_PROMPT), ("human", "{question}")])


def _chat_model(kind: str):
    """Build the bare chat model for a provider kind: 'anthropic' | 'openai' | 'ollama'."""
    if kind == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=SETTINGS.hchat_model,
            api_key=SETTINGS.hchat_api_key,
            base_url=SETTINGS.hchat_base_url,
            streaming=True,
            max_tokens=SETTINGS.llm_max_tokens,
            temperature=0.4,
            stream_usage=True,  # ask the provider to include usage on the final chunk.
            # NOTE: do NOT pass `extra_body={"stream_options": ...}` for OpenRouter —
            # that key is rejected by their gateway (`Provider returned error`).
        )
    if kind == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs: dict = {"model": SETTINGS.hchat_model, "max_tokens": 1024, "streaming": True}
        if SETTINGS.hchat_base_url:
            kwargs["base_url"] = SETTINGS.hchat_base_url
        return ChatAnthropic(**kwargs)
    # local Ollama fallback (CPU, on-prem)
    from langchain_ollama import ChatOllama

    return ChatOllama(model=SETTINGS.fallback_llm_model, base_url=SETTINGS.ollama_url,
                      streaming=True, temperature=0.1)


def build_anthropic():
    from langchain_core.output_parsers import StrOutputParser

    return _prompt() | _chat_model("anthropic") | StrOutputParser()


def build_openai():
    """OpenAI-compatible primary. `stream_usage` triggers a final usage chunk so the
    token pill under the answer reflects real counts instead of the `ctx≈` fallback."""
    from langchain_core.output_parsers import StrOutputParser

    return _prompt() | _chat_model("openai") | StrOutputParser()


def build_local_ollama():
    from langchain_core.output_parsers import StrOutputParser

    return _prompt() | _chat_model("ollama") | StrOutputParser()


def primary_kind() -> str:
    """Which primary client the configured provider maps to."""
    return "openai" if SETTINGS.hchat_provider == "openai" else "anthropic"
