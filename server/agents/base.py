"""Base agent class with role-aware, provider-switchable LLM support."""

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Load .env file if it exists (checks both server/.env and root MindEase/.env)
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    root_env = Path(__file__).parent.parent.parent / ".env"
    if root_env.exists():
        load_dotenv(root_env)
except ImportError:
    pass  # python-dotenv not installed, use system env vars


# Default model per provider. For Azure this is the *deployment name* you
# created in Azure AI Foundry (defaults to the model name, e.g. "gpt-5").
DEFAULT_DEDALUS_MODEL = "claude-sonnet-4-5"
DEFAULT_NVIDIA_MODEL = "moonshotai/kimi-k3"


def _azure_deployment() -> str:
    return os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5")


def _get_nvidia_api_key() -> str:
    """Extract NVIDIA API key from NVIDIA_API_KEY, NVD_API_KEY, or VITE_NVD_API_KEY."""
    return (
        os.environ.get("NVIDIA_API_KEY")
        or os.environ.get("NVD_API_KEY")
        or os.environ.get("VITE_NVD_API_KEY")
        or ""
    ).strip()



def _get_deepseek_api_key() -> str:
    return os.environ.get("DEEPSEEK_API_KEY", "").strip()

# GPT-5 reasoning tokens count against max_completion_tokens. Agents size
# max_tokens for the *visible* answer, so give the model extra room to think
# or it can return an empty message after exhausting the cap on reasoning.
_AZURE_REASONING_HEADROOM = 4096

# Reserve completion-budget space for reasoning before visible Manim code.
_DEEPSEEK_REASONING_HEADROOM = int(os.environ.get("DEEPSEEK_REASONING_HEADROOM", "12000"))

def _require_openai_env() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("LLM_PROVIDER=openai but OPENAI_API_KEY is not set.")


def _require_nvidia_env() -> None:
    if not _get_nvidia_api_key():
        raise RuntimeError(
            "LLM_PROVIDER=nvidia but NVIDIA API key is not set. "
            "Please set NVIDIA_API_KEY or VITE_NVD_API_KEY in .env."
        )



def _require_deepseek_env() -> None:
    if not _get_deepseek_api_key():
        raise RuntimeError("LLM_PROVIDER=deepseek but DEEPSEEK_API_KEY is not set.")


def _require_azure_env() -> None:
    missing = [
        k for k in ("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT")
        if not os.environ.get(k)
    ]
    if missing:
        raise RuntimeError(f"LLM_PROVIDER=azure but missing env vars: {', '.join(missing)}")


def _require_dedalus_env() -> None:
    if not os.environ.get("DEDALUS_API_KEY"):
        raise RuntimeError("LLM_PROVIDER=dedalus but DEDALUS_API_KEY is not set.")


def _detect_provider() -> str:
    """Resolve the LLM provider from env: LLM_PROVIDER wins, else auto-detect.
    Priority order: DeepSeek -> OpenAI -> Azure -> NVIDIA (Kimi-k3) -> Dedalus.
    """
    explicit = os.environ.get("LLM_PROVIDER", "").strip().lower()
    if explicit in ("deepseek", "openai", "azure", "nvidia", "nvd", "dedalus"):
        if explicit == "deepseek":
            _require_deepseek_env()
        elif explicit == "openai":
            _require_openai_env()
        elif explicit == "azure":
            _require_azure_env()
        elif explicit in ("nvidia", "nvd"):
            _require_nvidia_env()
            return "nvidia"
        elif explicit == "dedalus":
            _require_dedalus_env()
        return explicit
    if explicit:
        raise RuntimeError(
            f"Unknown LLM_PROVIDER={explicit!r}. Use 'deepseek', 'openai', 'azure', 'nvidia', or 'dedalus'."
        )

    # 1. Primary default when configured: DeepSeek (DEEPSEEK_API_KEY)
    if _get_deepseek_api_key():
        return "deepseek"

    # 2. Direct OpenAI (OPENAI_API_KEY)
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"

    # 3. Azure OpenAI (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT)
    if os.environ.get("AZURE_OPENAI_API_KEY") and os.environ.get("AZURE_OPENAI_ENDPOINT"):
        return "azure"

    # 4. Backup: NVIDIA (NVIDIA_API_KEY / NVD_API_KEY / VITE_NVD_API_KEY)
    if _get_nvidia_api_key():
        return "nvidia"

    # 5. Legacy fallback: Dedalus
    if os.environ.get("DEDALUS_API_KEY"):
        return "dedalus"

    raise RuntimeError(
        "No LLM provider configured. Please set DEEPSEEK_API_KEY (primary), "
        "OPENAI_API_KEY, "
        "AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT, or "
        "VITE_NVD_API_KEY / NVIDIA_API_KEY (backup)."
    )

def get_provider() -> str:
    """Get the current provider name (validates env on every call)."""
    return _detect_provider()


# ---------------------------------------------------------------------------
# Azure OpenAI (GPT-5 family) — billed against Azure / Microsoft credits
# ---------------------------------------------------------------------------

_azure_async_client = None
_azure_sync_client = None


def _langfuse_enabled() -> bool:
    """Langfuse tracing is on when both project keys are present in the env."""
    return bool(
        os.environ.get("LANGFUSE_PUBLIC_KEY")
        and os.environ.get("LANGFUSE_SECRET_KEY")
    )


def _openai_classes():
    """Return (OpenAI, AsyncOpenAI) classes.

    When Langfuse is configured, return its drop-in wrappers so every LLM call
    is traced automatically (model, token usage, cost, latency). The wrapper
    imports must happen AFTER env vars are loaded — hence the deferred import.
    Falls back to the plain SDK when Langfuse isn't configured (local dev).
    """
    if _langfuse_enabled():
        from langfuse.openai import AsyncOpenAI, OpenAI
    else:
        from openai import AsyncOpenAI, OpenAI
    return OpenAI, AsyncOpenAI


def _azure_base_url() -> str:
    endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
    return f"{endpoint}/openai/v1/"


def _get_azure_client():
    global _azure_async_client  # noqa: PLW0603 — lazy singleton cache
    if _azure_async_client is None:
        _, AsyncOpenAI = _openai_classes()
        _azure_async_client = AsyncOpenAI(
            base_url=_azure_base_url(),
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            timeout=300.0,  # 5 min — large paper summarization needs headroom
        )
    return _azure_async_client


def _get_azure_sync_client():
    global _azure_sync_client  # noqa: PLW0603 — lazy singleton cache
    if _azure_sync_client is None:
        OpenAI, _ = _openai_classes()
        _azure_sync_client = OpenAI(
            base_url=_azure_base_url(),
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            timeout=300.0,
        )
    return _azure_sync_client


def _azure_model(model: str | None) -> str:
    """Map a requested model to an Azure deployment name.

    Claude model names (the old Dedalus defaults) map to the configured
    GPT-5 deployment; explicit gpt-* names pass through.
    """
    if not model or model.startswith("claude") or "/" in model:
        return _azure_deployment()
    return model


def _azure_request_kwargs(
    model: str, prompt: str, system_prompt: str, max_tokens: int, json_mode: bool = False
) -> dict:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    kwargs: dict = {
        "model": model,
        "messages": messages,
        "max_completion_tokens": max_tokens + _AZURE_REASONING_HEADROOM,
    }
    if json_mode:
        # The API then guarantees a parseable JSON object — ~4% of papers lost
        # a section's candidates and ~6% a planned visualization to unparseable
        # output (unescaped backslashes, stray quotes) before this.
        kwargs["response_format"] = {"type": "json_object"}
    # minimal | low | medium | high — low keeps the pipeline fast/cheap
    kwargs["reasoning_effort"] = os.environ.get("AZURE_OPENAI_REASONING_EFFORT", "low")
    return kwargs


# ---------------------------------------------------------------------------
# Direct OpenAI (primary provider)
# ---------------------------------------------------------------------------

_openai_async_client = None
_openai_sync_client = None


def _get_openai_client():
    global _openai_async_client  # noqa: PLW0603 — lazy singleton cache
    if _openai_async_client is None:
        _, AsyncOpenAI = _openai_classes()
        _openai_async_client = AsyncOpenAI(
            api_key=os.environ["OPENAI_API_KEY"],
            base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            timeout=300.0,
        )
    return _openai_async_client


def _get_openai_sync_client():
    global _openai_sync_client  # noqa: PLW0603 — lazy singleton cache
    if _openai_sync_client is None:
        OpenAI, _ = _openai_classes()
        _openai_sync_client = OpenAI(
            api_key=os.environ["OPENAI_API_KEY"],
            base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            timeout=300.0,
        )
    return _openai_sync_client


_deepseek_async_client = None
_deepseek_sync_client = None

# Allow a bounded longer request for reasoning-heavy scene generation.
_DEEPSEEK_CLIENT_TIMEOUT = float(os.environ.get("DEEPSEEK_TIMEOUT", "600"))


def _get_deepseek_client():
    global _deepseek_async_client
    if _deepseek_async_client is None:
        _, AsyncOpenAI = _openai_classes()
        _deepseek_async_client = AsyncOpenAI(
            base_url=os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
            api_key=_get_deepseek_api_key(),
            timeout=_DEEPSEEK_CLIENT_TIMEOUT,
        )
    return _deepseek_async_client


def _get_deepseek_sync_client():
    global _deepseek_sync_client
    if _deepseek_sync_client is None:
        OpenAI, _ = _openai_classes()
        _deepseek_sync_client = OpenAI(
            base_url=os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
            api_key=_get_deepseek_api_key(),
            timeout=_DEEPSEEK_CLIENT_TIMEOUT,
        )
    return _deepseek_sync_client


# ---------------------------------------------------------------------------
# NVIDIA NIM (Kimi-k3 / OpenAI-compatible endpoint)
# ---------------------------------------------------------------------------

_nvidia_async_client = None
_nvidia_sync_client = None


def _get_nvidia_client():
    global _nvidia_async_client  # noqa: PLW0603 — lazy singleton cache
    if _nvidia_async_client is None:
        key = _get_nvidia_api_key()
        if not key:
            raise RuntimeError("NVIDIA API key not set (checked NVIDIA_API_KEY, NVD_API_KEY, VITE_NVD_API_KEY)")
        _, AsyncOpenAI = _openai_classes()
        base_url = (
            os.environ.get("NVIDIA_BASE_URL")
            or os.environ.get("NVIDIA_API_BASE")
            or "https://integrate.api.nvidia.com/v1"
        ).rstrip("/")
        timeout = float(os.environ.get("NVIDIA_TIMEOUT", "180.0"))
        _nvidia_async_client = AsyncOpenAI(
            base_url=base_url,
            api_key=key,
            timeout=timeout,
        )
    return _nvidia_async_client


def _get_nvidia_sync_client():
    global _nvidia_sync_client  # noqa: PLW0603 — lazy singleton cache
    if _nvidia_sync_client is None:
        key = _get_nvidia_api_key()
        if not key:
            raise RuntimeError("NVIDIA API key not set (checked NVIDIA_API_KEY, NVD_API_KEY, VITE_NVD_API_KEY)")
        OpenAI, _ = _openai_classes()
        base_url = (
            os.environ.get("NVIDIA_BASE_URL")
            or os.environ.get("NVIDIA_API_BASE")
            or "https://integrate.api.nvidia.com/v1"
        ).rstrip("/")
        timeout = float(os.environ.get("NVIDIA_TIMEOUT", "180.0"))
        _nvidia_sync_client = OpenAI(
            base_url=base_url,
            api_key=key,
            timeout=timeout,
        )
    return _nvidia_sync_client


# ---------------------------------------------------------------------------
# Dedalus (legacy fallback)
# ---------------------------------------------------------------------------

_dedalus_runner = None


def _get_dedalus_runner():
    """Get or create the shared DedalusRunner instance."""
    global _dedalus_runner  # noqa: PLW0603 — lazy singleton cache
    if _dedalus_runner is None:
        from dedalus_labs import AsyncDedalus, DedalusRunner
        client = AsyncDedalus(
            timeout=300.0,  # 5 min — large paper summarization needs headroom
        )
        _dedalus_runner = DedalusRunner(client, verbose=False)
    return _dedalus_runner


def _dedalus_model(model: str) -> str:
    """Convert bare model name to Dedalus format (anthropic/model-name)."""
    if "/" in model:
        return model
    return f"anthropic/{model}"


def _get_client() -> None:
    """Compatibility shim: agents don't hold a direct SDK client."""
    return None


def _resolve_model_for_provider(provider: str, requested_model: str | None) -> str:
    """Map a model request to the appropriate model/deployment for the provider."""
    if provider == "azure":
        return _azure_model(requested_model)
    if provider == "openai":
        if requested_model and not requested_model.startswith(("claude", "moonshot", "anthropic")):
            return requested_model
        return os.environ.get("OPENAI_MODEL", "gpt-4o")
    if provider == "nvidia":
        if requested_model and requested_model.startswith("moonshotai/"):
            return requested_model
        return os.environ.get("NVIDIA_MODEL", DEFAULT_NVIDIA_MODEL)
    if provider == "deepseek":
        return os.environ.get("DEEPSEEK_MODEL", "deepseek-reasoner")
    if provider == "dedalus":
        return _dedalus_model(requested_model or DEFAULT_DEDALUS_MODEL)
    return requested_model or "gpt-4o"


def get_model_name(model: str | None = None) -> str:
    """Get the model name for the active provider."""
    provider = get_provider()
    return _resolve_model_for_provider(provider, model)


def _is_provider_configured(provider: str) -> bool:
    if provider == "openai":
        return bool(os.environ.get("OPENAI_API_KEY"))
    if provider == "azure":
        return bool(os.environ.get("AZURE_OPENAI_API_KEY") and os.environ.get("AZURE_OPENAI_ENDPOINT"))
    if provider == "nvidia":
        return bool(_get_nvidia_api_key())
    if provider == "deepseek":
        return bool(_get_deepseek_api_key())
    if provider == "dedalus":
        return bool(os.environ.get("DEDALUS_API_KEY"))
    return False


def _get_fallback_chain(primary_provider: str) -> list[str]:
    """
    Build ordered provider chain: primary -> backups in priority order.
    Fallback contract: DeepSeek -> OpenAI -> Azure -> NVIDIA (Kimi-k3) -> Dedalus.
    """
    priority_order = ["deepseek", "openai", "azure", "nvidia", "dedalus"]

    chain = [primary_provider]
    for p in priority_order:
        if p not in chain and _is_provider_configured(p):
            chain.append(p)

    return chain

def _configured_role_chain(preferred: tuple[str, ...]) -> list[str]:
    """Return only configured providers, preserving a role's declared order."""
    chain = [provider for provider in preferred if _is_provider_configured(provider)]
    if not chain:
        raise RuntimeError(f"None of the required providers are configured: {', '.join(preferred)}")
    return chain


# ---------------------------------------------------------------------------
# Standalone LLM call helpers (usable outside BaseAgent, e.g. validators)
# ---------------------------------------------------------------------------

def _with_trace_name(kwargs: dict, name: str | None) -> dict:
    """Attach a Langfuse generation name — only when tracing is on, since the
    plain OpenAI client rejects the unknown ``name`` kwarg."""
    if name and _langfuse_enabled():
        kwargs["name"] = name
    return kwargs


async def _execute_provider_call(
    provider: str,
    resolved_model: str,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    name: str | None,
    json_mode: bool,
) -> str:
    if provider in ("openai", "deepseek", "nvidia"):
        if provider == "openai":
            client = _get_openai_client()
        elif provider == "nvidia":
            client = _get_nvidia_client()
        else:
            client = _get_deepseek_client()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        token_cap = max_tokens
        if provider == "nvidia":
            nvidia_max = int(os.environ.get("NVIDIA_MAX_TOKENS", "16384"))
            token_cap = min(max(max_tokens, nvidia_max), 16384)
        elif provider == "deepseek" and "reasoner" in resolved_model:
            token_cap = max_tokens + _DEEPSEEK_REASONING_HEADROOM

        kwargs: dict[str, Any] = {
            "model": resolved_model,
            "messages": messages,
            "max_tokens": token_cap,
        }
        if json_mode and provider != "nvidia":
            kwargs["response_format"] = {"type": "json_object"}

        if provider == "nvidia":
            if os.environ.get("NVIDIA_SEED") is not None:
                kwargs["seed"] = int(os.environ["NVIDIA_SEED"])
            if os.environ.get("NVIDIA_TEMPERATURE") is not None:
                kwargs["temperature"] = float(os.environ["NVIDIA_TEMPERATURE"])
            if os.environ.get("NVIDIA_REASONING_EFFORT"):
                kwargs["reasoning_effort"] = os.environ["NVIDIA_REASONING_EFFORT"]

        stream_mode = (
            provider == "nvidia"
            and os.environ.get("NVIDIA_STREAM", "false").lower() in ("true", "1", "yes")
        )

        if stream_mode:
            kwargs["stream"] = True
            stream = await client.chat.completions.create(**_with_trace_name(kwargs, name))
            chunks = []
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    chunks.append(chunk.choices[0].delta.content)
            return "".join(chunks)
        else:
            resp = await client.chat.completions.create(**_with_trace_name(kwargs, name))
            return resp.choices[0].message.content or ""

    if provider == "azure":
        client = _get_azure_client()
        resp = await client.chat.completions.create(
            **_with_trace_name(
                _azure_request_kwargs(resolved_model, prompt, system_prompt, max_tokens, json_mode),
                name,
            )
        )
        return resp.choices[0].message.content or ""

    if provider == "dedalus":
        dedalus_model = _dedalus_model(resolved_model or DEFAULT_DEDALUS_MODEL)
        if json_mode:
            logger.warning("[LLM] json_mode requested but the Dedalus provider cannot enforce it; relying on the prompt")
        runner = _get_dedalus_runner()
        result = await runner.run(
            input=prompt,
            model=dedalus_model,
            instructions=system_prompt,
            max_tokens=max_tokens,
        )
        return result.final_output or ""

    raise RuntimeError(f"Unsupported provider: {provider}")


def _execute_provider_call_sync(
    provider: str,
    resolved_model: str,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    name: str | None,
    json_mode: bool,
) -> str:
    if provider in ("openai", "deepseek", "nvidia"):
        if provider == "openai":
            client = _get_openai_sync_client()
        elif provider == "nvidia":
            client = _get_nvidia_sync_client()
        else:
            client = _get_deepseek_sync_client()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        token_cap = max_tokens
        if provider == "nvidia":
            nvidia_max = int(os.environ.get("NVIDIA_MAX_TOKENS", "16384"))
            token_cap = min(max(max_tokens, nvidia_max), 16384)
        elif provider == "deepseek" and "reasoner" in resolved_model:
            token_cap = max_tokens + _DEEPSEEK_REASONING_HEADROOM

        kwargs: dict[str, Any] = {
            "model": resolved_model,
            "messages": messages,
            "max_tokens": token_cap,
        }
        if json_mode and provider != "nvidia":
            kwargs["response_format"] = {"type": "json_object"}

        if provider == "nvidia":
            if os.environ.get("NVIDIA_SEED") is not None:
                kwargs["seed"] = int(os.environ["NVIDIA_SEED"])
            if os.environ.get("NVIDIA_TEMPERATURE") is not None:
                kwargs["temperature"] = float(os.environ["NVIDIA_TEMPERATURE"])
            if os.environ.get("NVIDIA_REASONING_EFFORT"):
                kwargs["reasoning_effort"] = os.environ["NVIDIA_REASONING_EFFORT"]

        stream_mode = (
            provider == "nvidia"
            and os.environ.get("NVIDIA_STREAM", "false").lower() in ("true", "1", "yes")
        )

        if stream_mode:
            kwargs["stream"] = True
            stream = client.chat.completions.create(**_with_trace_name(kwargs, name))
            chunks = []
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    chunks.append(chunk.choices[0].delta.content)
            return "".join(chunks)
        else:
            resp = client.chat.completions.create(**_with_trace_name(kwargs, name))
            return resp.choices[0].message.content or ""

    if provider == "azure":
        client = _get_azure_sync_client()
        resp = client.chat.completions.create(
            **_with_trace_name(
                _azure_request_kwargs(resolved_model, prompt, system_prompt, max_tokens, json_mode),
                name,
            )
        )
        return resp.choices[0].message.content or ""

    if provider == "dedalus":
        import asyncio
        if json_mode:
            logger.warning("[LLM] json_mode requested but the Dedalus provider cannot enforce it; relying on the prompt")
        runner = _get_dedalus_runner()
        result = asyncio.run(runner.run(
            input=prompt,
            model=_dedalus_model(resolved_model or DEFAULT_DEDALUS_MODEL),
            instructions=system_prompt,
            max_tokens=max_tokens,
        ))
        return result.final_output or ""

    raise RuntimeError(f"Unsupported provider: {provider}")


async def call_llm(
    prompt: str,
    model: str | None = None,
    system_prompt: str = "",
    max_tokens: int = 4096,
    name: str | None = None,
    json_mode: bool = False,
    providers: tuple[str, ...] | None = None,
) -> str:
    """Async LLM call routed through the configured provider with automatic fallback:
    DeepSeek -> OpenAI -> NVIDIA (Kimi-k3) -> Dedalus.
    """
    primary_provider = get_provider() if providers is None else None
    chain = _get_fallback_chain(primary_provider) if primary_provider else _configured_role_chain(providers)
    input_words = len(prompt.split())
    last_error: Exception | None = None

    for i, provider in enumerate(chain):
        t0 = time.monotonic()
        resolved = _resolve_model_for_provider(provider, model)
        logger.info(
            f"[LLM] Attempt {i+1}/{len(chain)}: Calling {provider}/{resolved} "
            f"({input_words} input words, max_tokens={max_tokens})"
        )
        try:
            output = await _execute_provider_call(
                provider=provider,
                resolved_model=resolved,
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=max_tokens,
                name=name,
                json_mode=json_mode,
            )
            elapsed = time.monotonic() - t0
            logger.info(
                f"[LLM] {provider}/{resolved} responded in {elapsed:.1f}s "
                f"({len(output.split())} output words)"
            )
            return output
        except Exception as e:
            elapsed = time.monotonic() - t0
            last_error = e
            next_provider = chain[i + 1] if i + 1 < len(chain) else None
            if next_provider:
                logger.warning(
                    f"[LLM] {provider}/{resolved} FAILED after {elapsed:.1f}s: "
                    f"{type(e).__name__}: {e}. Falling back to {next_provider}..."
                )
            else:
                logger.error(
                    f"[LLM] {provider}/{resolved} FAILED after {elapsed:.1f}s: "
                    f"{type(e).__name__}: {e}. No more fallback providers available."
                )

    if last_error:
        raise last_error
    raise RuntimeError("No LLM provider available to execute call.")


def call_llm_sync(
    prompt: str,
    model: str | None = None,
    system_prompt: str = "",
    max_tokens: int = 4096,
    name: str | None = None,
    json_mode: bool = False,
    providers: tuple[str, ...] | None = None,
) -> str:
    """Sync LLM call routed through the configured provider with automatic fallback:
    DeepSeek -> OpenAI -> NVIDIA (Kimi-k3) -> Dedalus.
    """
    primary_provider = get_provider() if providers is None else None
    chain = _get_fallback_chain(primary_provider) if primary_provider else _configured_role_chain(providers)
    input_words = len(prompt.split())
    last_error: Exception | None = None

    for i, provider in enumerate(chain):
        t0 = time.monotonic()
        resolved = _resolve_model_for_provider(provider, model)
        logger.info(
            f"[LLM] Attempt {i+1}/{len(chain)}: Calling {provider}/{resolved} "
            f"({input_words} input words, max_tokens={max_tokens})"
        )
        try:
            output = _execute_provider_call_sync(
                provider=provider,
                resolved_model=resolved,
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=max_tokens,
                name=name,
                json_mode=json_mode,
            )
            elapsed = time.monotonic() - t0
            logger.info(
                f"[LLM] {provider}/{resolved} responded in {elapsed:.1f}s "
                f"({len(output.split())} output words)"
            )
            return output
        except Exception as e:
            elapsed = time.monotonic() - t0
            last_error = e
            next_provider = chain[i + 1] if i + 1 < len(chain) else None
            if next_provider:
                logger.warning(
                    f"[LLM] {provider}/{resolved} FAILED after {elapsed:.1f}s: "
                    f"{type(e).__name__}: {e}. Falling back to {next_provider}..."
                )
            else:
                logger.error(
                    f"[LLM] {provider}/{resolved} FAILED after {elapsed:.1f}s: "
                    f"{type(e).__name__}: {e}. No more fallback providers available."
                )

    if last_error:
        raise last_error
    raise RuntimeError("No LLM provider available to execute call.")


# An escaped pair is consumed whole (first alternative) so its second
# backslash is never mistaken for a lone one — the old lookahead-only pattern
# turned a correctly escaped \\alpha into \\\alpha and could never salvage a
# compliant reply that also had a trailing comma. \u counts as an escape only
# when four hex digits follow.
_BACKSLASH_RE = re.compile(r'\\\\|\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})')
# String literals are matched (and kept) by the first alternative so a comma
# INSIDE a string value ("a, ]") is never mistaken for a trailing comma.
_STRING_OR_TRAILING_COMMA_RE = re.compile(r'("(?:[^"\\]|\\.)*")|,\s*([}\]])')


def repair_json_text(text: str) -> str:
    """Best-effort repair of LLM JSON: escape LONE backslashes (LaTeX inside
    strings: \\alpha -> \\\\alpha; already-escaped pairs untouched) and drop
    trailing commas outside string literals. Idempotent on valid JSON."""
    # Both cases map to an escaped pair: a matched pair stays a pair, a lone
    # backslash becomes one.
    repaired = _BACKSLASH_RE.sub("\\\\\\\\", text)
    return _STRING_OR_TRAILING_COMMA_RE.sub(lambda m: m.group(1) if m.group(1) is not None else m.group(2), repaired)


_JSON_RETRY_SUFFIX = (
    "\n\nYour previous reply was not valid JSON. Return ONLY a valid JSON object. "
    "Escape every backslash inside strings as \\\\ and every double quote as \\\"."
)


def parse_json_response(content: str) -> dict:
    """JSON from a model reply: fenced or bare, with lenient repair as the
    last resort. Raises ValueError with the reply head on failure."""
    candidates = []
    for pattern in (r"```json\s*([\s\S]*?)\s*```", r"```\s*([\s\S]*?)\s*```"):
        m = re.search(pattern, content)
        if m:
            candidates.append(m.group(1).strip())
    candidates.append(content.strip())
    for cand in candidates:
        for text in (cand, repair_json_text(cand)):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Failed to parse JSON from response: {content[:500]}")


async def call_llm_json(
    prompt: str,
    *,
    model: str | None = None,
    system_prompt: str = "",
    max_tokens: int = 4096,
    name: str | None = None,
    providers: tuple[str, ...] | None = None,
) -> dict:
    """JSON-mode call with one repair retry — the single implementation the
    agents and the ingestion organizer share (two copies had already drifted:
    one retry suffix forgot the double-quote rule)."""
    text = await call_llm(prompt, model=model, system_prompt=system_prompt,
                          max_tokens=max_tokens, name=name, json_mode=True, providers=providers)
    try:
        return parse_json_response(text)
    except ValueError as first:
        logger.warning("%s returned unparseable JSON; retrying once", name or "llm")
        text = await call_llm(prompt + _JSON_RETRY_SUFFIX, model=model, system_prompt=system_prompt,
                              max_tokens=max_tokens, name=name, json_mode=True, providers=providers)
        try:
            return parse_json_response(text)
        except ValueError as second:
            raise second from first


class BaseAgent:
    """
    Base class for all AI agents in the pipeline.

    Provider is selected via env: Azure OpenAI (AZURE_OPENAI_*) or
    Dedalus (DEDALUS_API_KEY). See _detect_provider().
    """

    def __init__(
        self,
        prompt_file: str,
        model: str | None = None,
        max_tokens: int = 4096,
        system_prompt_file: str = "system/manim_reference.md",
        providers: tuple[str, ...] | None = None,
    ):
        self.providers = providers
        self._provider = providers[0] if providers else get_provider()
        self.model = _resolve_model_for_provider(self._provider, model)
        self.max_tokens = max_tokens
        # Only the code generator needs the 17KB Manim reference; the JSON
        # agents (analyzer, planner) get a short analyst persona instead.
        self.system_prompt = self._load_system_prompt(system_prompt_file)
        self.prompt_template = self._load_prompt(prompt_file)
        # Readable Langfuse generation name, e.g. "manim_generator"
        self._trace_name = Path(prompt_file).stem

        # Keep self.client for any code that still references it directly
        self.client = _get_client()

        # Log active provider
        if self._provider == "azure":
            print(f"☁️  Azure OpenAI → {_azure_model(self.model)}")
        elif self._provider == "nvidia":
            print(f"⚡ NVIDIA NIM → {self.model}")
        elif self._provider == "openai":
            print(f"🟢 Direct OpenAI → {self.model}")
        else:
            print(f"🔮 Dedalus SDK → anthropic/{self.model}")

    def _get_prompts_dir(self) -> Path:
        """Get the prompts directory path."""
        return Path(__file__).parent.parent / "prompts"

    def _load_system_prompt(self, relative: str = "system/manim_reference.md") -> str:
        """Load a system prompt file from the prompts directory ('' if absent)."""
        path = self._get_prompts_dir() / relative
        if path.exists():
            return path.read_text()
        return ""

    def _load_prompt(self, filename: str) -> str:
        """Load a prompt template file."""
        path = self._get_prompts_dir() / filename
        if not path.exists():
            raise FileNotFoundError(f"Prompt file not found: {path}")
        return path.read_text()

    def _format_prompt(self, **kwargs: Any) -> str:
        """
        Format the prompt template with provided variables.

        Uses str.replace() instead of str.format() to avoid issues with
        content containing curly braces (like LaTeX's \\begin{pmatrix}).
        Also handles {{ and }} escape sequences like str.format() does.
        """
        # Mark the TEMPLATE's escaped braces before substitution: doing the
        # unescape afterwards rewrote substituted content too (LaTeX like
        # \\frac{{a}} inside a section became \\frac{a}).
        result = self.prompt_template.replace("{{", "\x00LB\x00").replace("}}", "\x00RB\x00")

        for key, value in kwargs.items():
            placeholder = "{" + key + "}"
            result = result.replace(placeholder, str(value))

        return result.replace("\x00LB\x00", "{").replace("\x00RB\x00", "}")

    def _parse_json_response(self, content: str) -> dict:
        """See module-level parse_json_response (single implementation)."""
        return parse_json_response(content)

    async def _call_llm_json(self, prompt: str, **kwargs: Any) -> dict:
        """JSON-mode call with one repair retry (see module-level call_llm_json):
        a malformed reply used to drop a section's candidates or a planned
        visualization permanently."""
        return await call_llm_json(
            prompt,
            model=kwargs.get("model", self.model),
            system_prompt=kwargs.get("system_prompt") or self.system_prompt,
            max_tokens=kwargs.get("max_tokens", self.max_tokens),
            name=self._trace_name,
            providers=getattr(self, "providers", None),
        )

    def _extract_code_block(self, content: str, language: str = "python") -> str:
        """
        Extract code from a markdown code block.

        Args:
            content: Response content
            language: Language tag to look for

        Returns:
            Extracted code or empty string
        """
        # Try language-specific block first
        pattern = rf"```{language}\s*([\s\S]*?)\s*```"
        match = re.search(pattern, content)
        if match:
            return match.group(1).strip()

        # Try generic code block
        pattern = r"```\s*([\s\S]*?)\s*```"
        match = re.search(pattern, content)
        if match:
            return match.group(1).strip()

        # Return content as-is if no code blocks found
        return content.strip()

    # ------------------------------------------------------------------
    # LLM call helpers — route to the active provider
    # ------------------------------------------------------------------

    async def _call_llm(
        self,
        prompt: str,
        system_prompt: str | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> str:
        """Call the LLM via the configured provider (async)."""
        return await call_llm(
            prompt=prompt,
            model=self.model,
            system_prompt=system_prompt or self.system_prompt,
            max_tokens=max_tokens or self.max_tokens,
            name=self._trace_name,
            json_mode=json_mode,
            providers=getattr(self, "providers", None),
        )

    def _call_llm_sync(
        self,
        prompt: str,
        system_prompt: str | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Call the LLM via the configured provider (sync)."""
        return call_llm_sync(
            prompt=prompt,
            model=self.model,
            system_prompt=system_prompt or self.system_prompt,
            max_tokens=max_tokens or self.max_tokens,
            name=self._trace_name,
            providers=getattr(self, "providers", None),
        )

    # ------------------------------------------------------------------
    # Default run methods
    # ------------------------------------------------------------------

    async def run(self, **kwargs: Any) -> dict:
        """
        Run the agent with the given parameters.

        This method should be overridden by subclasses for specific behavior.
        Default implementation formats the prompt and returns parsed JSON.
        """
        prompt = self._format_prompt(**kwargs)
        text = await self._call_llm(prompt)
        return self._parse_json_response(text)

    def run_sync(self, **kwargs: Any) -> dict:
        """Synchronous version of run() for testing."""
        prompt = self._format_prompt(**kwargs)
        text = self._call_llm_sync(prompt)
        return self._parse_json_response(text)
