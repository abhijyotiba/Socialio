from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import verify_hmac, verify_user
from db import content_cells as db_cells
from db import content_ideas as db_ideas
from db import brand_configs as db_brand
from db import ingestion as db_ingestion
from db.client import rls_client
from db.workspaces import get_workspace_id_for_user
from pipeline.atomize import extract_ideas
from pipeline.matrix import expand_idea_to_cells

log = structlog.get_logger()
router = APIRouter(prefix="/content-engine")


async def run_atomize(
    client: Any,
    workspace_id: str,
    persona_id: str,
    ingestion_job_id: str,
    title: str,
    text: str,
    brand_system_prompt: str,
    platforms: list[str],
) -> dict:
    """Stage A + matrix materialize. Pure orchestration over the tested units."""
    ideas = await extract_ideas(title, text, brand_system_prompt)
    if not ideas:
        return {"ideas_extracted": 0, "cells_materialized": 0}

    saved = await db_ideas.create_content_ideas(
        client,
        [
            {
                "workspace_id": workspace_id,
                "ingestion_job_id": ingestion_job_id,
                "essence": i["essence"],
                "idea_type": i["idea_type"],
                "source_quote": i["source_quote"],
                "strength": i["strength"],
                "suitable_formats": i["suitable_formats"],
                "suitable_angles": i["suitable_angles"],
            }
            for i in ideas
        ],
    )

    cells: list[dict] = []
    for idea in saved:
        for cell in expand_idea_to_cells(idea, platforms):
            cells.append(
                {
                    "workspace_id": workspace_id,
                    "persona_id": persona_id,
                    "ingestion_job_id": ingestion_job_id,
                    "idea_id": cell["idea_id"],
                    "format": cell["format"],
                    "angle": cell["angle"],
                    "platform": cell["platform"],
                    "matrix_cell_hash": cell["matrix_cell_hash"],
                    "status": "planned",
                }
            )

    materialized = await db_cells.materialize_cells(client, cells)
    return {
        "ideas_extracted": len(saved),
        "cells_materialized": len(materialized),
    }


class AtomizeRequest(BaseModel):
    ingestion_job_id: str
    persona_id: str
    platforms: list[str]


@router.post("/atomize")
async def atomize(req: AtomizeRequest, request: Request) -> dict:
    body = await request.body()
    await verify_hmac(request, body)
    claims, token = await verify_user(request)

    client = await rls_client(token)
    workspace_id = await get_workspace_id_for_user(client, claims["sub"])
    if not workspace_id:
        raise HTTPException(status_code=403, detail="Workspace not found")

    job = await db_ingestion.get_job(client, req.ingestion_job_id)
    if not job or job.get("workspace_id") != workspace_id:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    if not (job.get("extracted_text") or "").strip():
        raise HTTPException(status_code=409, detail="Asset has no extracted text yet")

    brand = await db_brand.get_brand_config_for_persona(client, req.persona_id)
    if not (brand and brand.get("custom_system_prompt")):
        raise HTTPException(
            status_code=400,
            detail="Set up your brand voice before atomizing assets.",
        )

    return await run_atomize(
        client=client,
        workspace_id=workspace_id,
        persona_id=req.persona_id,
        ingestion_job_id=req.ingestion_job_id,
        title=job.get("extracted_title") or "",
        text=job["extracted_text"],
        brand_system_prompt=brand["custom_system_prompt"],
        platforms=req.platforms,
    )
