from __future__ import annotations

from typing import AsyncIterator, Callable, Optional

import asyncio
import contextlib
import logging

from ..audio.types import AudioMetadata
from ..audio import AudioBundle
from ..settings import AsrSettings
from .providers.base import AsrProvider
from .providers.mock import MockAsrProvider

try:
    from .providers.volcengine import VolcengineAsrProvider, VolcengineAsrError
except Exception:  # pragma: no cover - optional dependency
    VolcengineAsrProvider = None  # type: ignore[assignment]
    VolcengineAsrError = Exception  # type: ignore[assignment]

try:
    from .providers.whisper import WhisperAsrProvider
except RuntimeError:  # pragma: no cover - optional dependency not available
    WhisperAsrProvider = None  # type: ignore[assignment]
except Exception:  # pragma: no cover - defensive guard
    WhisperAsrProvider = None  # type: ignore[assignment]
from .types import AsrOptions, AsrPartial, AsrResult

logger = logging.getLogger(__name__)

class AsrService:
    """Coordinates ASR provider usage."""

    _STREAM_CHUNK_MS = 200

    def __init__(self, *, provider: Optional[AsrProvider] = None) -> None:
        self._provider = provider or MockAsrProvider()
        self._primary_provider = self._provider
        self._fallback_provider: AsrProvider = MockAsrProvider()
        self._failover_threshold = 0
        self._consecutive_failures = 0
        self._using_fallback = False
        self._last_error_code: Optional[str] = None
        self._last_log_id: Optional[str] = None

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
                if VolcengineAsrProvider is None:
                    raise RuntimeError("Volcengine ASR provider unavailable")
                provider = VolcengineAsrProvider(
                    endpoint=cfg.volc_endpoint,
                    app_key=cfg.volc_app_key,
                    access_key=cfg.volc_access_key,
                    resource_id=cfg.volc_resource_id,
                    connect_id_prefix=cfg.volc_connect_id_prefix,
                    default_sample_rate=cfg.target_sample_rate,
                    request_timeout=cfg.volc_timeout_seconds,
                )
            else:
                raise RuntimeError(f"unsupported ASR provider: {cfg.provider}")
        service = cls(provider=provider)
        if (
            cfg is not None
            and provider is not None
            and VolcengineAsrProvider is not None
            and isinstance(provider, VolcengineAsrProvider)
        ):
            service._failover_threshold = max(0, int(cfg.volc_failover_threshold))
        return service

    async def transcribe_bundle(self, bundle: AudioBundle, *, options: Optional[AsrOptions] = None) -> AsrResult:
        opts = options or AsrOptions()
        opts.sample_rate = opts.sample_rate or bundle.metadata.sample_rate
        try:
            result = await self._provider.transcribe(audio=bundle.pcm, options=opts)
        except Exception as exc:
            self._record_failure(self._provider, exc)
            raise
        else:
            self._record_success(self._provider)
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
            on_success=self._record_success,
            on_failure=self._record_failure,
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

    def _record_success(self, provider: AsrProvider) -> None:
        self._consecutive_failures = 0
        self._last_error_code = None
        self._last_log_id = getattr(provider, "last_log_id", None)

    def _record_failure(self, provider: AsrProvider, exc: Exception) -> None:
        self._consecutive_failures += 1
        error_code = getattr(exc, "code", None)
        if error_code is None:
            error_code = exc.__class__.__name__
        if isinstance(error_code, (int, float)):
            error_code = str(error_code)
        self._last_error_code = error_code
        self._last_log_id = getattr(provider, "last_log_id", None)

        logger.warning(
            "asr.provider_failure provider=%s consecutive_failures=%s threshold=%s error_code=%s",
            provider.name,
            self._consecutive_failures,
            self._failover_threshold,
            self._last_error_code,
        )

        if (
            not self._using_fallback
            and self._failover_threshold > 0
            and self._consecutive_failures >= self._failover_threshold
        ):
            logger.error(
                "asr.provider_failover activating fallback after %s failures",
                self._consecutive_failures,
            )
            self._activate_fallback()

    def _activate_fallback(self) -> None:
        if self._using_fallback:
            return
        self._provider = self._fallback_provider
        self._using_fallback = True
        logger.warning("asr.provider switched to fallback provider=%s", self._provider.name)

    @property
    def last_error_code(self) -> Optional[str]:
        return self._last_error_code

    @property
    def last_log_id(self) -> Optional[str]:
        return self._last_log_id


class AsrStreamHandle:
    """Utility wrapper that bridges provider streaming results to consumers."""

    def __init__(
        self,
        *,
        provider: AsrProvider,
        audio_iter_factory: Callable[[], AsyncIterator[bytes]],
        options: AsrOptions,
        on_success: Optional[Callable[[AsrProvider], None]] = None,
        on_failure: Optional[Callable[[AsrProvider, Exception], None]] = None,
    ) -> None:
        self._provider = provider
        self._audio_iter_factory = audio_iter_factory
        self._options = options
        self._on_success = on_success
        self._on_failure = on_failure
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
            if self._on_success:
                try:
                    self._on_success(self._provider)
                except Exception:  # pragma: no cover - defensive
                    logger.exception("asr.stream_handle.success_callback_failed")
            if not self._result_future.done():
                self._result_future.set_result(result)
        except Exception as exc:
            if self._on_failure:
                try:
                    self._on_failure(self._provider, exc)
                except Exception:  # pragma: no cover
                    logger.exception("asr.stream_handle.failure_callback_failed")
            if not self._result_future.done():
                self._result_future.set_exception(exc)
        finally:
            await self._queue.put(None)
