# =============================================================================
# Dockerfile for the SocialOS Worker (FastAPI + Playwright)
# =============================================================================

# Use Microsoft's Playwright-ready Python image — includes system Chromium deps.
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Create a non-root user for security (best practice for containers).
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# Install uv (fast Python package manager) as root.
RUN pip install uv

# Copy dependency manifests first so Docker can cache this layer.
COPY pyproject.toml uv.lock ./

# Install only production dependencies.
RUN uv sync --frozen --no-dev

# Install Chromium browser (this must run as root because it installs system packages).
RUN uv run playwright install chromium --with-deps

# Copy the rest of the application source code.
COPY . .

# Hand ownership of the app directory to the non-root user.
RUN chown -R appuser:appuser /app

# Switch to non-root for runtime.
USER appuser

# Cloud Run injects $PORT at runtime (usually 8080).
# Render and local dev default to 8000.
# The `sh -c` wrapper lets us expand the $PORT env variable at container start.
CMD ["sh", "-c", "uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
