import asyncio
import logging
import sys

import structlog
from fastapi import FastAPI

from routes.ingest import router as ingest_router
from routes.generate import router as generate_router
from routes.voice import router as voice_router

if sys.platform == "win32":
    # Playwright relies on subprocess support, which requires the Proactor loop on Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

logging.basicConfig(format="%(message)s", level=logging.INFO)
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="%H:%M:%S"),
        structlog.dev.ConsoleRenderer(colors=sys.stdout.isatty()),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    logger_factory=structlog.PrintLoggerFactory(),
)

app = FastAPI(title="SocialOS Worker", version="0.1.0")
app.include_router(ingest_router)
app.include_router(generate_router)
app.include_router(voice_router)


@app.get("/health")
def health():
    return {"status": "ok"}
