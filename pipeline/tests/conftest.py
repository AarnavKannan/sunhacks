import pytest

from reconstruct.build import build_package
from reconstruct.paths import default_config


@pytest.fixture(scope="session")
def package(tmp_path_factory):
    dest = tmp_path_factory.mktemp("scene") / "incident-demo"
    build_package(default_config(), out=dest)
    return dest
