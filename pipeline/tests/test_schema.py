import json

from reconstruct.models import CamerasFile, EntitiesFile, EventsFile, Manifest, TracksFile
from reconstruct.validate import validate_package

_MODELS = {
    "manifest.json": Manifest,
    "tracks.json": TracksFile,
    "entities.json": EntitiesFile,
    "events.json": EventsFile,
    "cameras.json": CamerasFile,
}


def test_schema_round_trip(package):
    errors = validate_package(package)
    assert errors == []
    for filename, model in _MODELS.items():
        original = json.loads((package / filename).read_text())
        parsed = model.model_validate(original)
        again = json.loads(parsed.model_dump_json())
        assert model.model_validate(again) == parsed


def test_invalid_impact_time_is_rejected(package, tmp_path):
    manifest = json.loads((package / "manifest.json").read_text())
    manifest["impact_time_s"] = "soon"
    target = tmp_path / "manifest.json"
    target.write_text(json.dumps(manifest))
    from reconstruct.validate import _schema_errors

    errors = _schema_errors("manifest.json", json.loads(target.read_text()))
    assert errors
