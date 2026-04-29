import pytest
from fastapi.testclient import TestClient

from digital_twin.main import app


@pytest.fixture
def client():
    return TestClient(app)
