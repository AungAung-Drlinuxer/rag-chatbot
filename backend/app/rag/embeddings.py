"""Embeddings integration — Ollama embedder + PGVector store (owned by rag/).

The corpus is `it_help_chatbot_kb` in PostgreSQL+pgvector (no external vector
DB). `add_texts` is the single write path used by ingestion/seed scripts.
"""
from __future__ import annotations

from app.core.config import SETTINGS

COLLECTION_NAME = "it_help_chatbot_kb"


def get_embeddings():
    from langchain_ollama import OllamaEmbeddings

    return OllamaEmbeddings(model=SETTINGS.embedding_model, base_url=SETTINGS.ollama_url)


def get_vectorstore():
    from langchain_community.vectorstores import PGVector

    return PGVector(
        connection_string=SETTINGS.database_url,
        embedding_function=get_embeddings(),
        collection_name=COLLECTION_NAME,
    )


def add_texts(texts: list[str], metadatas: list[dict[str, str]]) -> list[str]:
    """Embed + insert chunk texts into pgvector (called from the ingest/seed scripts)."""
    return get_vectorstore().add_texts(texts, metadatas=metadatas)
