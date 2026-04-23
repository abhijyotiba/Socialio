from fastapi import FastAPI

from routes.ingest import router as ingest_router
from routes.generate import router as generate_router

app = FastAPI(title="SocialOS Worker", version="0.1.0")
app.include_router(ingest_router)
app.include_router(generate_router)


@app.get("/health")
def health():
    return {"status": "ok"}
