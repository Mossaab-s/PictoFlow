"""Application-facing provider failures with no raw requests or responses."""


class ProviderError(RuntimeError):
    """An optional provider operation could not be completed."""


class ProviderUnavailableError(ProviderError):
    """The selected provider is unavailable."""


class ProviderDisabledError(ProviderUnavailableError):
    """AI operations are explicitly disabled."""


class ProviderFixtureNotFound(ProviderError):
    """No configured fake response matches this exact request."""


class ProviderPayloadError(ProviderError):
    """Request/response schema or provenance is invalid."""


class ProviderConfigurationError(ProviderError):
    """Local provider configuration is invalid."""


class ProviderUnsupportedCapability(ProviderError):
    """The configured provider does not expose this optional operation."""
