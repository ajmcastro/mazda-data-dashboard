"""Print the OpenAPI schema (used to generate the frontend types)."""

import json

from .app import app

print(json.dumps(app.openapi(), indent=2))
