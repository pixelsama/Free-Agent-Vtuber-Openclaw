from __future__ import annotations

from typing import AsyncIterator, Callable, Optional

import asyncio
import contextlib

from ..audio.types import AudioMetadata
from ..audio import AudioBundle
from ..settings import AsrSettings
from .providers.base import AsrProvider
from .providers.mock import MockAsrProvider

try:
    from .providers.whisper import WhisperAsrProvider
except RuntimeError:  # pragma: no cover - optional dependency not available
    WhisperAsrProvider = None  # type: ignore[assignment]
except Exception:  # pragma: no cover - defensive guard
    WhisperAsrProvider = None  # type: ignore[assignment]
from .types import AsrOptions, AsrPartial, AsrResult


class AsrService:
    """Coordinates ASR provider usage."""

    _STREAM_CHUNK_MS = 200

    def __init__(self, *, provider: Optional[AsrProvider] = None) -> None:
        self._provider = provider or MockAsrProvider()

    @classmethod
    def from_settings(cls, cfg: AsrSettings | None) -> "AsrService":
        provider: Optional[AsrProvider] = None
        if cfg is not None:
            provider_name = (cfg.provider or "mock").strip().lower()
            if provider_name in {"mock", "fake"}:
                provider = MockAsrProvider()
            elif provider_name in {"whisper", "faster-whisper"}:
                if WhisperAsrProvider is None:
                    raise RuntimeError("Whisper provider selected but dependencies missing")
                provider = WhisperAsrProvider(
                    model=cfg.whisper_model,
                    device=cfg.whisper_device,
                    compute_type=cfg.whisper_compute_type,
                    beam_size=cfg.whisper_beam_size,
                    cache_dir=cfg.whisper_cache_dir,
                    default_sample_rate=cfg.target_sample_rate,
                )
            elif provider_name in {"volcengine", "volc", "bytedance"}:
                try:
                    from .providers.volcengine import VolcengineAsrProvider
                except Exception as exc:  # pragma: no cover - optional dependency guard
                    raise RuntimeError("Volcengine ASR provider unavailable") from exc
                provider = VolcengineAsrProvider(
                    endpoint=cfg.volc_endpoint,
                    app_key=cfg.volc_app_key,
                    access_key=cfg.volc_access_key,
                    resource_id=cfg.volc_resource_id,
                    connect_id_prefix=cfg.volc_connect_id_prefix,
                    default_sample_rate=cfg.target_sample_rate,
                )
            else:
                raise RuntimeError(f"unsupported ASR provider: {cfg.provider}")
        return cls(provider=provider)

    async def transcribe_bundle(self, bundle: AudioBundle, *, options: Optional[AsrOptions] = None) -> AsrResult:
        opts = options or AsrOptions()
        opts.sample_rate = opts.sample_rate or bundle.metadata.sample_rate
        result = await self._provider.transcribe(audio=bundle.pcm, options=opts)
        partials = list(result.partials or [])
        if not partials or not partials[-1].is_final:
            final_text = partials[-1].text if partials else result.text
            partials.append(AsrPartial(text=final_text or result.text, is_final=True))
        return AsrResult(
            text=result.text,
            partials=partials,
            duration_seconds=result.duration_seconds,
            provider=result.provider or self._provider.name,
        )

    @property
    def provider(self) -> AsrProvider:
        return self._provider

    def stream_bundle(self, bundle: AudioBundle, *, options: Optional[AsrOptions] = None) -> "AsrStreamHandle":
        opts = options or AsrOptions()
        opts.sample_rate = opts.sample_rate or bundle.metadata.sample_rate
        audio_iter_factory = self._make_audio_iter_factory(
            pcm=bundle.pcm,
            metadata=bundle.metadata,
            sample_rate=opts.sample_rate or bundle.metadata.sample_rate,
        )
        return AsrStreamHandle(
            provider=self._provider,
            audio_iter_factory=audio_iter_factory,
            options=opts,
        )

    def _make_audio_iter_factory(
        self,
        *,
        pcm: bytes,
        metadata: AudioMetadata,
        sample_rate: int,
    ) -> Callable[[], AsyncIterator[bytes]]:
        chunk_ms = max(20, self._STREAM_CHUNK_MS)
        bytes_per_sample = 2  # 16-bit PCM post-processor standard
        chunk_samples = max(1, int(sample_rate * chunk_ms / 1000))
        chunk_bytes = chunk_samples * metadata.channels * bytes_per_sample
        if chunk_bytes <= 0:
            chunk_bytes = len(pcm) or 1

        async def audio_iter() -> AsyncIterator[bytes]:
            for idx in range(0, len(pcm), chunk_bytes):
                chunk = pcm[idx : idx + chunk_bytes]
                if chunk:
                    yield chunk
                await asyncio.sleep(0)

        return audio_iter


class AsrStreamHandle:
    """Utility wrapper that bridges provider streaming results to consumers."""

    def __init__(
        self,
        *,
        provider: AsrProvider,
        audio_iter_factory: Callable[[], AsyncIterator[bytes]],
        options: AsrOptions,
    ) -> None:
        self._provider = provider
        self._audio_iter_factory = audio_iter_factory
        self._options = options
        self._queue: asyncio.Queue[AsrPartial | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        self._result_future: asyncio.Future[AsrResult] = loop.create_future()
        self._task = asyncio.create_task(self._run())

    async def partials(self) -> AsyncIterator[AsrPartial]:
        while True:
            item = await self._queue.get()
            if item is None:
                break
            yield item

    async def final_result(self) -> AsrResult:
        return await asyncio.shield(self._result_future)

    async def wait_closed(self) -> None:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await asyncio.shield(self._task)

    async def cancel(self) -> None:
        if not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if not self._result_future.done():
            self._result_future.cancel()
        await self._queue.put(None)

    async def _run(self) -> None:
        partials: list[AsrPartial] = []
        try:
            async for partial in self._provider.stream(
                audio=self._audio_iter_factory(),
                options=self._options,
            ):
                partials.append(partial)
                await self._queue.put(partial)

            final_text = partials[-1].text if partials else ""
            if not partials or not partials[-1].is_final:
                final_partial = AsrPartial(text=final_text, is_final=True)
                partials.append(final_partial)
                await self._queue.put(final_partial)

            result = AsrResult(
                text=partials[-1].text if partials else "",
                partials=list(partials),
                duration_seconds=None,
                provider=self._provider.name,
            )
            if not self._result_future.done():
                self._result_future.set_result(result)
        except Exception as exc:
            if not self._result_future.done():
                self._result_future.set_exception(exc)
        finally:
            await self._queue.put(None)
