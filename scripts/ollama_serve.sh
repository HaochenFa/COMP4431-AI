#!/usr/bin/env bash
# Local Ollama server for Trailhead on port 11435, next to (not replacing) the Ollama menu-bar app on 11434.
#
# The agent's prompt (system + safety + tool schemas + skills + results) runs 10-15k tokens, and Ollama's
# OpenAI-compatible endpoint ignores num_ctx, so the context length has to be set on the server or
# prompts are silently truncated. q8_0 KV cache + flash attention halve the cache's memory, so the
# chat model (qwen3:8b) and the embedder (bge-m3) both stay loaded on an 18 GB Mac.
set -euo pipefail
export OLLAMA_HOST=127.0.0.1:11435
export OLLAMA_CONTEXT_LENGTH=${OLLAMA_CONTEXT_LENGTH:-32768}
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_KEEP_ALIVE=${OLLAMA_KEEP_ALIVE:-30m}
exec ollama serve
