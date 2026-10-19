"""Configurable Chat Completions JSON adapter without vendor SDK or PCL access."""

import json
from copy import deepcopy

from pydantic import TypeAdapter

from app.ai.contracts import Key, ProviderMetadata
from app.ai.errors import ProviderConfigurationError, ProviderPayloadError
from app.ai.providers.http import (
    OPERATIONS,
    RESPONSES,
    HTTPProvider,
    instruction,
    parse,
    proposal_schema,
    system_instruction,
)


class OpenAICompatibleProvider(HTTPProvider):
    health_path = "/models"
    capabilities = OPERATIONS

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        response_format: str = "json_object",
        temperature: float | None = 0.2,
        **kwargs,
    ):
        try:
            self._model = TypeAdapter(Key).validate_python(model)
        except ValueError:
            raise ProviderConfigurationError("A valid configured model is required") from None
        if response_format not in ("json_object", "json_schema"):
            raise ProviderConfigurationError("Compatible response format is invalid")
        self._response_format = response_format
        if temperature is not None and (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or not 0 <= temperature <= 2
        ):
            raise ProviderConfigurationError("Compatible temperature is invalid")
        self._temperature = temperature
        super().__init__(base_url, **kwargs)

    @property
    def provider_id(self):
        return "openai-compatible"

    def headers(self):
        return (
            {"Authorization": f"Bearer {self._api_key.get_secret_value()}"} if self._api_key else {}
        )

    async def call(self, operation: str, request):
        schema = proposal_schema(operation, strict=self._response_format == "json_schema")
        response_format = {"type": "json_object"}
        if self._response_format == "json_schema":
            if operation == "interpret":
                # A nested union encodes the cross-field invariant in the transport schema.
                definitions = schema.pop("$defs", {})
                proposed, refused = deepcopy(schema), deepcopy(schema)
                proposed["properties"]["status"] = {"type": "string", "enum": ["proposal"]}
                proposed["properties"]["candidates"]["minItems"] = 1
                refused["properties"]["status"] = {"type": "string", "enum": ["not_understood"]}
                refused["properties"]["candidates"]["maxItems"] = 0
                schema = {
                    "type": "object",
                    "properties": {"result": {"anyOf": [proposed, refused]}},
                    "required": ["result"],
                    "additionalProperties": False,
                    "$defs": definitions,
                }
            response_format = {
                "type": "json_schema",
                "json_schema": {"name": f"pictoflow_{operation}", "strict": True, "schema": schema},
            }
        result = await self.exchange(
            "POST",
            "/chat/completions",
            payload={
                "model": self._model,
                "stream": False,
                "messages": [
                    {"role": "system", "content": system_instruction(operation)},
                    {
                        "role": "user",
                        "content": instruction(
                            operation,
                            request,
                            include_preamble=False,
                            schema=schema,
                            include_schema=self._response_format != "json_schema",
                        ),
                    },
                ],
                "response_format": response_format,
                **(
                    {"temperature": self._temperature}
                    if operation == "interpret" and self._temperature is not None
                    else {}
                ),
            },
        )
        try:
            choice = result["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError
            content = choice["message"]["content"]
            if not isinstance(content, str):
                raise ValueError
            if self._response_format == "json_schema" and operation == "interpret":
                output = json.loads(content)
                if not isinstance(output, dict) or set(output) != {"result"}:
                    raise ValueError
                content = output["result"]
            proposal = parse(RESPONSES[operation], content)
            usage = result.get("usage") or {}
            metadata = ProviderMetadata(
                provider_id=self.provider_id,
                selected_model=self._model,
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
            )
            return RESPONSES[operation].model_validate(
                {**proposal.model_dump(), "metadata": metadata}
            )
        except (KeyError, IndexError, TypeError, ValueError):
            raise ProviderPayloadError("Compatible completion envelope is invalid") from None
