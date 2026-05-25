from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from auth import verify_hmac, verify_user
from db import brand_configs as db_brand
from db import personas as db_personas
from db import prompt_versions as db_prompts
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from pipeline import voice_profile as vp

router = APIRouter()


async def _authorize(request: Request, body: bytes) -> tuple[Any, str, dict]:
    await verify_hmac(request, body)
    claims, token = await verify_user(request)
    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")
    return client, workspace_id, claims


async def _resolve_persona_id(
    client: Any, workspace_id: str, requested: str | None
) -> str:
    if requested:
        return requested
    default = await db_personas.get_default_persona(client, workspace_id)
    persona_id = default.get("id") if default else None
    if not persona_id:
        raise HTTPException(status_code=400, detail="No persona found")
    return persona_id


# ─── Manual brand config save ────────────────────────────────────────────────


class BrandConfigRequest(BaseModel):
    brand_name: str = Field(min_length=1)
    industry: str | None = None
    website_url: str | None = None
    tone_tags: list[str]
    system_prompt: str = Field(min_length=1)
    persona_id: str | None = None


@router.post("/brand/config")
async def save_brand_config(req: BrandConfigRequest, request: Request) -> dict:
    client, workspace_id, claims = await _authorize(request, await request.body())
    persona_id = await _resolve_persona_id(client, workspace_id, req.persona_id)

    prompt_version = await db_prompts.create_prompt_version(
        client, workspace_id, req.system_prompt, claims["sub"], "manual"
    )
    brand_config = await db_brand.upsert_brand_config(
        client,
        {
            "workspace_id": workspace_id,
            "persona_id": persona_id,
            "brand_name": req.brand_name,
            "industry": req.industry or None,
            "website_url": req.website_url or None,
            "tone_tags": req.tone_tags,
            "custom_system_prompt": req.system_prompt,
            "current_prompt_version_id": prompt_version["id"],
        },
    )
    return {
        "workspace_id": workspace_id,
        "current_prompt_version_id": brand_config["current_prompt_version_id"],
        "version_number": prompt_version["version_number"],
    }


# ─── Voice profile (analyze samples in-process, then persist) ────────────────


class BrandDetails(BaseModel):
    brand_name: str = Field(min_length=1)
    industry: str | None = None
    website_url: str | None = None
    tone_tags: list[str] | None = None


class VoiceProfileRequest(BaseModel):
    samples: list[str] = Field(min_length=3, max_length=15)
    platform_mix: dict[str, int] | None = None
    persona_id: str | None = None
    brand_details: BrandDetails | None = None

    @field_validator("samples")
    @classmethod
    def _validate_samples(cls, value: list[str]) -> list[str]:
        for sample in value:
            if not (20 <= len(sample) <= 3000):
                raise ValueError("each sample must be 20–3000 characters")
        if sum(len(s) for s in value) > 30_000:
            raise ValueError("Total samples exceed 30 KB")
        return value


@router.post("/brand/voice-profile")
async def analyze_voice_profile(req: VoiceProfileRequest, request: Request) -> dict:
    client, workspace_id, claims = await _authorize(request, await request.body())
    persona_id = await _resolve_persona_id(client, workspace_id, req.persona_id)

    existing = await db_brand.get_brand_config_for_persona(client, persona_id)
    details = req.brand_details
    brand_name = (
        (details.brand_name.strip() if details else "")
        or ((existing or {}).get("brand_name") or "").strip()
        or "your brand"
    )
    tone_tags = (
        (details.tone_tags if details else None)
        or (existing or {}).get("tone_tags")
        or []
    )

    try:
        profile = await vp.analyze_samples(
            samples=req.samples,
            platform_hints=req.platform_mix,
        )
    except ValueError as exc:
        # Analyzer ran but produced something unvalidatable → 422 (vs 502 for a
        # provider outage raised below).
        raise HTTPException(
            status_code=422,
            detail="Couldn't read the voice profile from those samples. Try with different posts.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail="Voice analysis is temporarily unavailable. Please try again.",
        ) from exc

    system_prompt = vp.render_system_prompt(
        profile, brand_name=brand_name, tone_tags=tone_tags
    )
    profile_json = profile.model_dump(mode="json")

    await db_brand.set_voice_profile_for_persona(client, persona_id, profile_json)
    prompt_version = await db_prompts.create_prompt_version(
        client, workspace_id, system_prompt, claims["sub"], "voice_profile"
    )
    await db_brand.upsert_brand_config(
        client,
        {
            "workspace_id": workspace_id,
            "persona_id": persona_id,
            "brand_name": (details.brand_name if details else None)
            or (existing or {}).get("brand_name")
            or brand_name,
            "industry": (details.industry or None)
            if details and details.industry is not None
            else (existing or {}).get("industry"),
            "website_url": (details.website_url or None)
            if details and details.website_url is not None
            else (existing or {}).get("website_url"),
            "tone_tags": tone_tags,
            "custom_system_prompt": system_prompt,
            "current_prompt_version_id": prompt_version["id"],
        },
    )

    return {
        "profile": profile_json,
        "system_prompt": system_prompt,
        "version_number": prompt_version["version_number"],
    }
