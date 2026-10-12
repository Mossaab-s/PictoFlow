"""Exercise every domain module in a fresh interpreter without site packages."""

import subprocess
import sys
from pathlib import Path


def test_domain_imports_with_only_standard_library() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    script = """
import importlib
import pkgutil
import sys

sys.path.insert(0, sys.argv[1])

# Block even the first attempt to import an outer layer, including lazy imports
# made while discovering or importing submodules.
class BlockOuterLayers:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith((
            "app.api", "app.application", "app.infrastructure", "app.ai",
            "app.config", "app.main", "admin",
            "httpx", "requests", "urllib.request", "http.client",
        )):
            raise ImportError(f"Domain imported an outer layer: {fullname}")

sys.meta_path.insert(0, BlockOuterLayers())
import app.domain
for module in pkgutil.walk_packages(app.domain.__path__, "app.domain."):
    importlib.import_module(module.name)
assert "app.domain.pcl" in sys.modules
from app.domain.pcl.examples import noise_scenario
from app.domain.pcl.entities import ValidationEvent, TargetType, ValidationAction
state = noise_scenario()
assert state.interpretations[0].validated_text is None
event = ValidationEvent(profile_id=state.profile.id, target_type=TargetType.INTERPRETATION,
                        target_id=state.interpretations[0].id, action=ValidationAction.CONFIRM)
confirmed = state.record_interpretation_feedback(event)
assert confirmed.interpretations[0].validated_text == state.interpretations[0].text
"""
    result = subprocess.run(
        [sys.executable, "-I", "-S", "-c", script, str(backend_root)],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
