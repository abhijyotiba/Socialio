# =============================================================================
# Dockerfile for the SocialOS Worker (FastAPI)
# =============================================================================
# Scraping is delegated to the Firecrawl API, so the container does NOT need
# Playwright or a browser. Image stays small and the build stays fast.

FROM python:3.12-slim

# Create a non-root user with a real home directory so any tool that looks at
# $HOME (uv, pip cache, etc.) has a writable spot.
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

# Install uv (fast Python package manager) as root.
RUN pip install --no-cache-dir uv

# Copy dependency manifests first so Docker can cache this layer.
COPY pyproject.toml uv.lock ./

# Install only production dependencies.
RUN uv sync --frozen --no-dev

# Copy the rest of the application source code.
COPY . .

# Hand ownership of the app directory to the non-root user.
RUN chown -R appuser:appuser /app

# Put the venv on PATH so `uvicorn` resolves without invoking `uv` at runtime.
ENV PATH="/app/.venv/bin:$PATH"

# Switch to non-root for runtime.
USER appuser

# Cloud Run injects $PORT at runtime (usually 8080).
# Render and local dev default to 8000.
# The `sh -c` wrapper lets us expand the $PORT env variable at container start.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
