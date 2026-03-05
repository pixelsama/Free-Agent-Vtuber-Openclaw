#!/usr/bin/env python3
"""Nanobot sidecar bridge for Electron main process.

Protocol: JSON Lines over stdin/stdout.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class BridgeError(Exception):
    code: str
    message: str
    status: int | None = None


AGENT_CACHE_KEY: str | None = None
AGENT_INSTANCE = None
ACTIVE_TASKS: dict[str, asyncio.Task] = {}


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def normalize_string(value: Any, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    return value.strip()


def normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    fallback_workspace = normalize_string(
        os.environ.get("NANOBOT_WORKSPACE"),
        str(Path.home() / ".nanobot" / "workspace"),
    )
    max_tokens = config.get("maxTokens")
    if not isinstance(max_tokens, int) or max_tokens <= 0:
        max_tokens = 4096

    temperature = config.get("temperature")
    if not isinstance(temperature, (float, int)):
        temperature = 0.2

    return {
        "workspace": normalize_string(config.get("workspace"), fallback_workspace) or fallback_workspace,
        "provider": normalize_string(config.get("provider"), "openrouter") or "openrouter",
        "model": normalize_string(config.get("model"), "anthropic/claude-opus-4-5") or "anthropic/claude-opus-4-5",
        "apiBase": normalize_string(config.get("apiBase"), ""),
        "apiKey": normalize_string(config.get("apiKey"), ""),
        "maxTokens": max_tokens,
        "temperature": float(temperature),
        "reasoningEffort": normalize_string(config.get("reasoningEffort"), ""),
    }


def config_key(config: dict[str, Any]) -> str:
    return json.dumps(config, sort_keys=True, ensure_ascii=False)


def load_nanobot_modules() -> dict[str, Any]:
    repo_path = normalize_string(os.environ.get("NANOBOT_REPO_PATH"))
    if repo_path:
        path_obj = Path(repo_path)
        if path_obj.exists():
            sys.path.insert(0, str(path_obj))

    try:
        from nanobot.agent.loop import AgentLoop
        from nanobot.bus.queue import MessageBus
        from nanobot.config.schema import ExecToolConfig
        from nanobot.providers.custom_provider import CustomProvider
        from nanobot.providers.litellm_provider import LiteLLMProvider
        from nanobot.providers.registry import find_by_name
    except Exception as exc:  # pragma: no cover - runtime-probing path
        raise BridgeError(
            code="nanobot_runtime_not_ready",
            message=f"Nanobot runtime not ready: {exc}",
        ) from exc

    return {
        "AgentLoop": AgentLoop,
        "MessageBus": MessageBus,
        "ExecToolConfig": ExecToolConfig,
        "CustomProvider": CustomProvider,
        "LiteLLMProvider": LiteLLMProvider,
        "find_by_name": find_by_name,
    }


def create_provider(modules: dict[str, Any], config: dict[str, Any]):
    provider_name = config["provider"]
    model = config["model"]
    api_key = config["apiKey"]
    api_base = config["apiBase"] or None

    if provider_name == "custom":
        if not api_base:
            raise BridgeError("nanobot_missing_config", "Custom provider requires apiBase.")
        custom_provider = modules["CustomProvider"]
        return custom_provider(
            api_key=api_key or "no-key",
            api_base=api_base,
            default_model=model,
        )

    spec = modules["find_by_name"](provider_name)
    if not spec:
        raise BridgeError("nanobot_provider_unavailable", f"Unknown Nanobot provider: {provider_name}")

    if not spec.is_oauth and not api_key:
        raise BridgeError("nanobot_missing_config", "Nanobot API Key is required.")

    lite_llm_provider = modules["LiteLLMProvider"]
    return lite_llm_provider(
        api_key=api_key or None,
        api_base=api_base,
        default_model=model,
        provider_name=provider_name,
    )


def create_agent(config: dict[str, Any]):
    modules = load_nanobot_modules()

    workspace = Path(config["workspace"]).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)

    provider = create_provider(modules, config)
    agent_loop_cls = modules["AgentLoop"]
    message_bus_cls = modules["MessageBus"]
    exec_tool_config_cls = modules["ExecToolConfig"]

    agent = agent_loop_cls(
        bus=message_bus_cls(),
        provider=provider,
        workspace=workspace,
        model=config["model"],
        temperature=config["temperature"],
        max_tokens=config["maxTokens"],
        max_iterations=12,
        memory_window=50,
        reasoning_effort=config["reasoningEffort"] or None,
        exec_config=exec_tool_config_cls(timeout=15),
        restrict_to_workspace=True,
    )

    # Reduce risk for desktop integration MVP.
    for tool_name in ("exec", "spawn", "web_search", "web_fetch", "cron"):
        agent.tools.unregister(tool_name)

    return agent


def get_or_create_agent(config: dict[str, Any]):
    global AGENT_CACHE_KEY, AGENT_INSTANCE

    key = config_key(config)
    if AGENT_INSTANCE is not None and AGENT_CACHE_KEY == key:
        return AGENT_INSTANCE

    AGENT_INSTANCE = create_agent(config)
    AGENT_CACHE_KEY = key
    return AGENT_INSTANCE


def map_exception(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, BridgeError):
        payload = {
            "code": exc.code,
            "message": exc.message,
        }
        if exc.status is not None:
            payload["status"] = exc.status
        return payload

    return {
        "code": "nanobot_model_call_failed",
        "message": str(exc) or "Nanobot model call failed.",
    }


async def handle_start(request_id: str, session_id: str, content: str, config: dict[str, Any]) -> None:
    try:
        if not content:
            raise BridgeError("nanobot_missing_config", "Chat content is required.")

        normalized = normalize_config(config)
        if not normalized["apiKey"]:
            raise BridgeError("nanobot_missing_config", "Nanobot API Key is required.")

        agent = get_or_create_agent(normalized)
        progress_segments: list[str] = []

        async def on_progress(text: str, **_kwargs: Any) -> None:
            chunk = normalize_string(text)
            if not chunk:
                return
            progress_segments.append(chunk)
            emit(
                {
                    "type": "event",
                    "requestId": request_id,
                    "event": {
                        "type": "text-delta",
                        "payload": {
                            "content": chunk,
                            "source": "nanobot",
                        },
                    },
                }
            )

        response = await agent.process_direct(
            content=content,
            session_key=f"desktop:{session_id or 'default'}",
            channel="desktop",
            chat_id=session_id or "default",
            on_progress=on_progress,
        )

        final_text = normalize_string(response)
        if final_text:
            tail = progress_segments[-1] if progress_segments else ""
            if final_text != tail:
                emit(
                    {
                        "type": "event",
                        "requestId": request_id,
                        "event": {
                            "type": "text-delta",
                            "payload": {
                                "content": final_text,
                                "source": "nanobot",
                            },
                        },
                    }
                )

        emit(
            {
                "type": "event",
                "requestId": request_id,
                "event": {
                    "type": "done",
                    "payload": {"source": "nanobot"},
                },
            }
        )
    except asyncio.CancelledError:
        emit(
            {
                "type": "event",
                "requestId": request_id,
                "event": {
                    "type": "done",
                    "payload": {"source": "nanobot", "aborted": True},
                },
            }
        )
    except Exception as exc:  # pragma: no cover - mapped runtime path
        emit(
            {
                "type": "event",
                "requestId": request_id,
                "event": {
                    "type": "error",
                    "payload": map_exception(exc),
                },
            }
        )


async def handle_test(request_id: str, config: dict[str, Any]) -> None:
    started_at = time.perf_counter()
    try:
        normalized = normalize_config(config)
        if not normalized["apiKey"]:
            raise BridgeError("nanobot_missing_config", "Nanobot API Key is required.")

        agent = get_or_create_agent(normalized)

        await asyncio.wait_for(
            agent.process_direct(
                content="ping",
                session_key=f"desktop:test:{request_id}",
                channel="desktop",
                chat_id="settings-test",
            ),
            timeout=60,
        )

        emit(
            {
                "type": "test-result",
                "requestId": request_id,
                "ok": True,
                "latencyMs": int((time.perf_counter() - started_at) * 1000),
            }
        )
    except asyncio.CancelledError:
        emit(
            {
                "type": "test-result",
                "requestId": request_id,
                "ok": False,
                "error": {
                    "code": "aborted",
                    "message": "aborted",
                },
            }
        )
    except Exception as exc:  # pragma: no cover - mapped runtime path
        emit(
            {
                "type": "test-result",
                "requestId": request_id,
                "ok": False,
                "error": map_exception(exc),
            }
        )


async def process_message(payload: dict[str, Any]) -> None:
    request_id = normalize_string(payload.get("requestId"))
    msg_type = normalize_string(payload.get("type"))
    if not request_id:
        return

    if msg_type == "abort":
        task = ACTIVE_TASKS.get(request_id)
        if task:
            task.cancel()
        return

    if msg_type == "start":
        session_id = normalize_string(payload.get("sessionId"), "default")
        content = normalize_string(payload.get("content"))
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        task = asyncio.create_task(handle_start(request_id, session_id, content, config))
        ACTIVE_TASKS[request_id] = task
        task.add_done_callback(lambda _: ACTIVE_TASKS.pop(request_id, None))
        return

    if msg_type == "test":
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        task = asyncio.create_task(handle_test(request_id, config))
        ACTIVE_TASKS[request_id] = task
        task.add_done_callback(lambda _: ACTIVE_TASKS.pop(request_id, None))


async def read_stdin_loop() -> None:
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if line == "":
            break

        stripped = line.strip()
        if not stripped:
            continue

        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue

        if not isinstance(payload, dict):
            continue

        await process_message(payload)


async def main() -> None:
    emit({"type": "ready"})
    await read_stdin_loop()

    for task in list(ACTIVE_TASKS.values()):
        task.cancel()

    if ACTIVE_TASKS:
        await asyncio.gather(*ACTIVE_TASKS.values(), return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
