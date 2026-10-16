import re
from pathlib import Path

from app.domain.pcl.pictograms import PictogramKey, pictogram_reference


def test_shared_catalog_keys_are_supported_by_the_api_without_changing_reference_namespace():
    root = Path(__file__).resolve().parents[2]
    keys = []
    for name in ("pictograms.ts", "daily-pictograms.ts"):
        source = (root / "admin/src/lib" / name).read_text(encoding="utf-8")
        keys.extend(re.findall(r'\bkey:\s*"([a-z_]+)"', source))
    assert len(keys) == len(set(keys)) == 140
    assert set(keys) == {key.value for key in PictogramKey}
    assert all(
        pictogram_reference(PictogramKey(key)) == f"pictoflow:pictogram:v1:{key}" for key in keys
    )
