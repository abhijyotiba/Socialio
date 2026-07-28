"""Shared types for LLM adapters. Keep this module dependency-free — it is
imported by both groq.py and gemini.py."""

from dataclasses import dataclass


@dataclass
class GenerateResult:
    """Output of a single LLM call, including token usage for cost tracking."""

    body: str
    prompt_tokens: int = 0
    output_tokens: int = 0
