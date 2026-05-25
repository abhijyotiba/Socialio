import asyncio
import logging
import sys

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from routes.ingest import router as ingest_router
from routes.campaigns import router as campaigns_router
from routes.personas import router as personas_router
from routes.posts import router as posts_router
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


# Normalize error bodies to { "error": ... } so the web frontend's `data.error`
# contract holds across every endpoint the worker serves.
@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(_request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(
    _request: Request, exc: RequestValidationError
):
    return JSONResponse(status_code=400, content={"error": "Invalid request"})


app.include_router(ingest_router)
app.include_router(campaigns_router)
app.include_router(personas_router)
app.include_router(posts_router)
app.include_router(voice_router)


@app.get("/health")
def health():
    return {"status": "ok"}
