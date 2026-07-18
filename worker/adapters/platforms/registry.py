from __future__ import annotations

from adapters.platforms.base import PlatformAdapter, PlatformCapabilities

_REGISTRY: dict[str, PlatformAdapter] = {}


def register(adapter: PlatformAdapter) -> None:
    """Register a platform adapter under its capabilities slug. Called at import
    time by each concrete adapter module."""
    _REGISTRY[adapter.capabilities().slug] = adapter


def get_adapter(slug: str) -> PlatformAdapter:
    """Return the adapter for ``slug``. Raises ``KeyError`` for an unknown
    platform — the caller maps that to a 400/404."""
    return _REGISTRY[slug]


def all_platforms() -> list[str]:
    """Registered platform slugs, sorted for deterministic output."""
    return sorted(_REGISTRY)


def capabilities(slug: str) -> PlatformCapabilities:
    """Return the ``PlatformCapabilities`` for ``slug`` (``KeyError`` if unknown)."""
    return _REGISTRY[slug].capabilities()


# Adding a platform later:
#   1. Create ``adapters/platforms/<slug>.py`` with a ``PlatformAdapter``
#      subclass that delegates to the platform's free functions in
#      ``adapters/<slug>.py`` and calls ``register(<Slug>Adapter())`` at import.
#   2. Import that module in ``adapters/platforms/__init__.py`` so registration
#      runs on package import.
#   3. Add one ``platforms`` table row for the slug (Task 2).
# No other edits are required — every dispatch path resolves through the
# registry, so callers stay platform-agnostic.
