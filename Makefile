.PHONY: setup profile test lint format clean

setup:
	cd backend && uv sync

profile:
	cd backend && uv run python -m mazda_dash.profile ../data ../docs/profile

test:
	cd backend && uv run pytest

lint:
	cd backend && uv run ruff check .

format:
	cd backend && uv run ruff format .

clean:
	rm -rf docs/profile backend/.pytest_cache backend/.ruff_cache
