import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_atomize_orchestration_extracts_materializes_and_counts():
    # Drive the orchestration function directly (route auth is covered by the
    # shared auth tests; here we test the engine logic).
    from routes.content_engine import run_atomize

    fake_ideas = [{
        "essence": "e", "idea_type": "claim", "source_quote": "q",
        "strength": 4, "suitable_formats": ["hot_take"], "suitable_angles": ["expert"],
    }]
    fake_client = AsyncMock()

    with patch("routes.content_engine.extract_ideas", new_callable=AsyncMock) as mock_extract, \
         patch("routes.content_engine.db_ideas.create_content_ideas", new_callable=AsyncMock) as mock_save_ideas, \
         patch("routes.content_engine.db_cells.materialize_cells", new_callable=AsyncMock) as mock_mat:
        mock_extract.return_value = fake_ideas
        mock_save_ideas.return_value = [{**fake_ideas[0], "id": "idea-1"}]
        mock_mat.return_value = [{"id": "cell-1"}]

        result = await run_atomize(
            client=fake_client,
            workspace_id="w1",
            persona_id="p1",
            ingestion_job_id="job-1",
            title="T",
            text="some asset text",
            brand_system_prompt="brand",
            platforms=["linkedin"],
        )

    assert result["ideas_extracted"] == 1
    assert result["cells_materialized"] == 1
    # 1 idea x 1 format x 1 angle x 1 platform = 1 cell sent to materialize
    sent_cells = mock_mat.call_args[0][1]
    assert len(sent_cells) == 1
    assert sent_cells[0]["status"] == "planned"
    assert sent_cells[0]["idea_id"] == "idea-1"
    assert sent_cells[0]["workspace_id"] == "w1"
    assert sent_cells[0]["persona_id"] == "p1"
    assert sent_cells[0]["matrix_cell_hash"]


@pytest.mark.asyncio
async def test_atomize_with_no_ideas_materializes_nothing():
    from routes.content_engine import run_atomize
    fake_client = AsyncMock()
    with patch("routes.content_engine.extract_ideas", new_callable=AsyncMock) as mock_extract, \
         patch("routes.content_engine.db_ideas.create_content_ideas", new_callable=AsyncMock) as mock_save, \
         patch("routes.content_engine.db_cells.materialize_cells", new_callable=AsyncMock) as mock_mat:
        mock_extract.return_value = []
        result = await run_atomize(
            client=fake_client, workspace_id="w1", persona_id="p1",
            ingestion_job_id="job-1", title="T", text="text",
            brand_system_prompt="b", platforms=["linkedin"],
        )
    assert result["ideas_extracted"] == 0
    assert result["cells_materialized"] == 0
    mock_save.assert_not_called()
    mock_mat.assert_not_called()


@pytest.mark.asyncio
async def test_cadence_payload_validation_rejects_bad_platform():
    from routes.content_engine import CadenceRequest
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        CadenceRequest(persona_id="p1", platform="facebook", posts_per_week=3,
                       autopilot_enabled=False, active=True)


@pytest.mark.asyncio
async def test_cadence_payload_validation_rejects_out_of_range_cadence():
    from routes.content_engine import CadenceRequest
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        CadenceRequest(persona_id="p1", platform="linkedin", posts_per_week=99,
                       autopilot_enabled=False, active=True)


@pytest.mark.asyncio
async def test_cadence_payload_accepts_valid():
    from routes.content_engine import CadenceRequest
    req = CadenceRequest(persona_id="p1", platform="linkedin", posts_per_week=5,
                         autopilot_enabled=True, active=True)
    assert req.posts_per_week == 5
    assert req.platform == "linkedin"
    assert req.low_reservoir_threshold == 5  # default
