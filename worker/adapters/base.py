class PublishError(Exception):
    """Raised when a platform publish/upload call fails. error_code mirrors the
    web classifiers (TOKEN_EXPIRED / RATE_LIMITED / CONTENT_POLICY / SERVER_ERROR
    / UNKNOWN) so the route can map TOKEN_EXPIRED → 401, others → 502."""

    def __init__(self, message: str, error_code: str):
        super().__init__(message)
        self.error_code = error_code
