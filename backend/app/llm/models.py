"""LLM data types."""
from __future__ import annotations

from typing import TypedDict


class TokenUsage(TypedDict):
    input_tokens: int
    output_tokens: int
    total_tokens: int


# What stream_answer yields as the second tuple element on the final pair
# (None on all content tokens). `dict | None` kept as the loose wire type.
UsageDict = TokenUsage | None
