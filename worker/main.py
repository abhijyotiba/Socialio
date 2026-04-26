import asyncio
import sys

from fastapi import FastAPI

from routes.ingest import router as ingest_router
from routes.generate import router as generate_router

if sys.platform == "win32":
    # Playwright relies on subprocess support, which requires the Proactor loop on Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

app = FastAPI(title="SocialOS Worker", version="0.1.0")
app.include_router(ingest_router)
app.include_router(generate_router)


@app.get("/health")
def health():
    return {"status": "ok"}
