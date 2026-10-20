"""Operational singleton; never part of a PCL/profile export or semantic history."""

from pydantic import SecretStr
from sqlalchemy import select, text

from app.ai.configuration import ConfigurationView, ProviderOptions, resolve_change
from app.infrastructure.postgres.access import Accounts
from app.infrastructure.postgres.models import ProviderConfigurationRow


class ProviderConfigurations:
    def __init__(self, factory, defaults):
        self.factory = factory
        self.defaults = defaults

    def current(self, session):
        row = session.get(ProviderConfigurationRow, 1)
        if row is None:
            return ProviderOptions.from_settings(self.defaults), self.defaults.provider_api_key, 0
        return (
            ProviderOptions.model_validate(row.configuration),
            SecretStr(row.api_key) if row.api_key else None,
            row.version,
        )

    def view(self):
        with self.factory() as session:
            options, key, version = self.current(session)
            return ConfigurationView(
                **options.model_dump(),
                version=version,
                source="admin" if version else "environment",
                api_key_configured=bool(key),
            )

    def preview(self, change):
        with self.factory() as session:
            options, key, version = self.current(session)
            options, key = resolve_change(change, options, key, version)
            return options.settings(self.defaults, key)

    def save(self, change, actor_id):
        with self.factory.begin() as session:
            # Includes first creation; a missing singleton row cannot be SELECT FOR UPDATE locked.
            session.execute(text("SELECT pg_advisory_xact_lock(742019110)"))
            options, key, version = self.current(session)
            options, key = resolve_change(change, options, key, version)
            row = session.get(ProviderConfigurationRow, 1)
            if row is None:
                row = ProviderConfigurationRow(id=1)
                session.add(row)
            row.configuration = options.model_dump(mode="json")
            row.api_key = key.get_secret_value() if key else None
            row.version = version + 1
            row.updated_by = actor_id
            Accounts.event(
                session,
                "provider_configuration_changed",
                actor_id,
                detail=f"version {version + 1}; {options.provider}",
            )
            return ConfigurationView(
                **options.model_dump(),
                version=version + 1,
                source="admin",
                api_key_configured=bool(key),
            )

    def override(self):
        return self.override_snapshot()[0]

    def override_snapshot(self):
        with self.factory() as session:
            row = session.scalar(select(ProviderConfigurationRow))
            if row is None:
                return None, 0
            options, key, version = self.current(session)
            return options.settings(self.defaults, key), version
