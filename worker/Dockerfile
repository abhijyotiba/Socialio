FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy
WORKDIR /app
RUN pip install uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen
RUN uv run playwright install chromium
COPY . .
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
