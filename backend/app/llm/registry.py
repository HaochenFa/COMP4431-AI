"""Build a Provider from a named profile in config.yaml (selected by LLM_PROFILE)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from .anthropic_messages import AnthropicProvider
from .base import Provider
from .embeddings import Embedder
from .openai_chat import OpenAIChatProvider
from .openai_responses import OpenAIResponsesProvider

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config.yaml"
_PROVIDERS = {"anthropic": AnthropicProvider, "openai_chat": OpenAIChatProvider, "openai_responses": OpenAIResponsesProvider}


def load_profiles(path: Path = CONFIG_PATH) -> dict[str, Any]:
    return yaml.safe_load(path.read_text())


def build_provider(profile: str | None = None, path: Path = CONFIG_PATH) -> Provider:
    cfg = load_profiles(path)
    name = profile or os.getenv("LLM_PROFILE") or cfg["default_profile"]
    try:
        spec = dict(cfg["profiles"][name])
    except KeyError:
        raise SystemExit(f"Unknown LLM profile {name!r}; choose one of {sorted(cfg['profiles'])}") from None
    kind = spec.pop("provider")
    if kind not in _PROVIDERS:
        raise SystemExit(f"Profile {name!r}: provider must be one of {sorted(_PROVIDERS)}")
    if key_env := spec.pop("api_key_env", None):
        spec["api_key"] = os.getenv(key_env)
    return _PROVIDERS[kind](**spec)


def build_embedder(path: Path = CONFIG_PATH) -> Embedder:
    spec = dict(load_profiles(path)["embeddings"])
    if key_env := spec.pop("api_key_env", None):
        spec["api_key"] = os.getenv(key_env)
    return Embedder(**spec)
