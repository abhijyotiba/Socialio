from fastapi import APIRouter, Request

from auth import verify_cron
from cron import jobs
from db.client import service_client

router = APIRouter(prefix="/cron")


@router.post("/publish-due")
async def publish_due(request: Request):
    verify_cron(request)
    svc = await service_client()
    return await jobs.run_publish_due(svc)


@router.post("/pull-metrics")
async def pull_metrics(request: Request):
    verify_cron(request)
    svc = await service_client()
    return await jobs.run_pull_metrics(svc)


@router.post("/token-expiry-check")
async def token_expiry_check(request: Request):
    verify_cron(request)
    svc = await service_client()
    return await jobs.run_token_expiry_check(svc)


@router.post("/cleanup-orphaned-media")
async def cleanup_orphaned_media(request: Request):
    verify_cron(request)
    svc = await service_client()
    return await jobs.run_cleanup_orphaned_media(svc)


@router.post("/refill-and-schedule")
async def refill_and_schedule(request: Request):
    verify_cron(request)
    svc = await service_client()
    return await jobs.run_refill_and_schedule(svc)
