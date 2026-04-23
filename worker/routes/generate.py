import time
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from auth import verify_hmac
from pipeline import analyze
from pipeline import generate as gen_pipeline

router = APIRouter()


class GenerateRequest(BaseModel):
    job_id: str
    workspace_id: str
    extracted_title: str
    extracted_text: str
    brand_system_prompt: str
    platforms: list[Literal["linkedin", "x"]]


class VariantOutput(BaseModel):
    platform: str
    body: str


class GenerateResponse(BaseModel):
    summary: str
    variants: list[VariantOutput]
    stage_timings: dict[str, int]


def _ms() -> int:
    return int(time.monotonic() * 1000)


@router.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest, request: Request) -> GenerateResponse:
    body = await request.body()
    await verify_hmac(request, body)

    t0 = _ms()
    summary = await analyze.summarize(req.extracted_title, req.extracted_text)
    t1 = _ms()

    raw_variants = await gen_pipeline.generate_variants(
        summary=summary,
        brand_system_prompt=req.brand_system_prompt,
        platforms=req.platforms,
    )
    t2 = _ms()

    return GenerateResponse(
        summary=summary,
        variants=[VariantOutput(**v) for v in raw_variants],
        stage_timings={
            "analyzing": t1 - t0,
            "generating": t2 - t1,
        },
    )
