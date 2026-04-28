"""Voice analysis route. Takes pasted samples → returns structured profile + rendered system prompt."""

import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth import verify_hmac
from pipeline import voice_profile as vp

router = APIRouter()


class AnalyzeRequest(BaseModel):
    workspace_id: str
    brand_name: str
    samples: list[str] = Field(min_length=1, max_length=15)
    tone_tags: list[str] = Field(default_factory=list)
    platform_mix: dict[str, int] | None = None


class AnalyzeResponse(BaseModel):
    profile: dict[str, Any]
    system_prompt: str
    stage_timings: dict[str, int]


def _ms() -> int:
    return int(time.monotonic() * 1000)


@router.post("/voice/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    body = await request.body()
    await verify_hmac(request, body)

    t0 = _ms()
    try:
        profile = await vp.analyze_samples(
            samples=req.samples,
            platform_hints=req.platform_mix,
        )
    except ValueError as exc:
        # 422 — analysis ran but the LLM returned something we couldn't validate.
        # Distinct from 502 (LLM provider down) which adapters/llm.py raises.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    t1 = _ms()

    system_prompt = vp.render_system_prompt(
        profile,
        brand_name=req.brand_name,
        tone_tags=req.tone_tags,
    )
    t2 = _ms()

    return AnalyzeResponse(
        profile=profile.model_dump(mode="json"),
        system_prompt=system_prompt,
        stage_timings={
            "analyzing": t1 - t0,
            "rendering": t2 - t1,
        },
    )
