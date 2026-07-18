"""Platform adapter seam.

Importing this package registers every concrete adapter (LinkedIn, X) so
``registry.get_adapter`` / ``all_platforms`` resolve without further wiring.
"""

from adapters.platforms import linkedin, x  # noqa: F401 — import-for-registration
from adapters.platforms.base import PlatformAdapter, PlatformCapabilities
from adapters.platforms.registry import all_platforms, get_adapter

__all__ = [
    "PlatformAdapter",
    "PlatformCapabilities",
    "all_platforms",
    "get_adapter",
]
