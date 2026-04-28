import time
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from auth import verify_hmac
from pipeline import analyze, regenerate
from pipeline import generate as gen_pipeline

router = APIRouter()


class GenerateRequest(BaseModel):
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


# ─── Regenerate (Phase 7) ────────────────────────────────────────────────────


class RegenerateRequest(BaseModel):
    workspace_id: str
    variant_id: str
    platform: Literal["linkedin", "x"]
    current_body: str = Field(min_length=1)
    instruction: str = Field(min_length=1, max_length=500)
    brand_system_prompt: str = Field(min_length=1)
    summary: str | None = None


class RegenerateResponse(BaseModel):
    body: str
    stage_timings: dict[str, int]


@router.post("/generate/regenerate", response_model=RegenerateResponse)
async def regenerate_route(
    req: RegenerateRequest, request: Request
) -> RegenerateResponse:
    body = await request.body()
    await verify_hmac(request, body)

    t0 = _ms()
    new_body = await regenerate.regenerate_variant(
        platform=req.platform,
        current_body=req.current_body,
        instruction=req.instruction,
        brand_system_prompt=req.brand_system_prompt,
        summary=req.summary,
    )
    t1 = _ms()

    return RegenerateResponse(
        body=new_body,
        stage_timings={"regenerating": t1 - t0},
    )
