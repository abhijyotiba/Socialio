import os

# Set dummy env vars before any module is imported.
# Tests that import from pipeline.* or config indirectly trigger Settings()
# instantiation; these stubs satisfy the required fields without a real .env.
os.environ.setdefault("WORKER_SHARED_SECRET", "test-secret-000")
os.environ.setdefault("CLOUDINARY_CLOUD_NAME", "test-cloud")
os.environ.setdefault("CLOUDINARY_API_KEY", "test-key")
os.environ.setdefault("CLOUDINARY_API_SECRET", "test-secret")
