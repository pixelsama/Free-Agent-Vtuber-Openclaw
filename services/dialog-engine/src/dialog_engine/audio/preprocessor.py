from __future__ import annotations

import io
import logging
import subprocess
from typing import Optional, Tuple

try:  # pragma: no cover - optional dependency guard
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency guard
    import soundfile as sf  # noqa: F401 - imported for monkeypatching in tests
except Exception:  # pragma: no cover
    sf = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency guard
    import resampy
except Exception:  # pragma: no cover
    resampy = None  # type: ignore[assignment]

from .types import AudioBundle, AudioMetadata, AudioPayload


class AudioPreprocessor:
    """Normalizes audio data prior to ASR."""

    def __init__(
        self,
        *,
        target_sample_rate: int = 16000,
        target_channels: int = 1,
        max_duration_seconds: Optional[float] = None,
    ) -> None:
        self._target_sample_rate = target_sample_rate
        self._target_channels = target_channels
        self._max_duration_seconds = max_duration_seconds

    async def normalize(self, payload: AudioPayload) -> AudioBundle:
        pcm, sample_rate, channels = await self._extract_pcm(payload)
        duration: float
        if np is not None and pcm is not None:
            if channels != self._target_channels:
                pcm = self._mix_down(pcm, channels)
                channels = self._target_channels
            if sample_rate != self._target_sample_rate:
                pcm, changed = self._resample(pcm, sample_rate, self._target_sample_rate)
                if changed:
                    sample_rate = self._target_sample_rate
            duration = float(len(pcm)) / float(sample_rate) if sample_rate > 0 else 0.0
            pcm_int16 = np.ascontiguousarray((pcm * 32768.0).clip(-32768, 32767).astype("<i2"))
            pcm_bytes = pcm_int16.tobytes()
        else:
            # Fallback: assume incoming PCM already matches desired format
            channels = payload.channels or self._target_channels
            sample_rate = payload.sample_rate or self._target_sample_rate
            if payload.duration_seconds and payload.duration_seconds > 0:
                duration = float(payload.duration_seconds)
            elif sample_rate > 0:
                bytes_per_sample = max(1, channels) * 2
                duration = len(payload.data) / float(sample_rate * bytes_per_sample)
            else:
                duration = 0.0
            pcm_bytes = payload.data

        if self._max_duration_seconds and duration > self._max_duration_seconds:
            raise ValueError("audio duration exceeds configured limit")

        metadata = AudioMetadata(
            sample_rate=sample_rate,
            channels=channels,
            duration_seconds=duration,
            format=payload.content_type,
        )
        return AudioBundle(pcm=pcm_bytes, metadata=metadata)

    async def _extract_pcm(self, payload: AudioPayload) -> Tuple["np.ndarray" | None, int, int]:
        # Prefer PyAV (handles webm/opus, mp4, etc.); fallback to ffmpeg subprocess; otherwise assume raw PCM
        target_rate = payload.sample_rate or self._target_sample_rate
        channels = payload.channels or self._target_channels
        data = payload.data
        if not data:
            if np is None:
                return None, target_rate, channels
            return np.zeros(0, dtype=np.float32), target_rate, self._target_channels

        # Try PyAV
        try:
            import av
            from av.audio.resampler import AudioResampler

            container = av.open(io.BytesIO(data), mode="r")
            audio_stream = next((s for s in container.streams if s.type == "audio"), None)
            if audio_stream is not None:
                logging.debug("audio.preprocessor: using PyAV decoder for content_type=%s", payload.content_type)
                resampler = AudioResampler(format="s16", layout="mono", rate=target_rate)
                pcm_list = []
                for packet in container.demux(audio_stream):
                    for frame in packet.decode():
                        for rframe in resampler.resample(frame):
                            arr = rframe.to_ndarray()
                            arr = np.asarray(arr, dtype=np.float32)
                            arr = arr.reshape(-1, 1)
                            pcm_list.append(arr / 32768.0)
                if pcm_list:
                    audio_array = np.concatenate(pcm_list, axis=0)
                    return audio_array, int(target_rate), int(audio_array.shape[1])
        except Exception as exc:
            logging.debug("audio.preprocessor: PyAV decode failed: %s", exc)

        # Fallback to ffmpeg subprocess (if available)
        try:
            cmd = [
                "ffmpeg", "-v", "quiet", "-y",
                "-i", "pipe:0",
                "-acodec", "pcm_f32le",
                "-ac", "1",
                "-ar", str(target_rate),
                "-f", "f32le",
                "pipe:1",
            ]
            proc = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            raw = proc.stdout
            if np is None:
                # Cannot form ndarray; treat as raw PCM (float32 little-endian)
                return None, target_rate, 1
            if raw:
                logging.debug("audio.preprocessor: using ffmpeg fallback decoder for content_type=%s", payload.content_type)
                arr = np.frombuffer(raw, dtype="<f4")
                arr = arr.reshape((-1, 1)) if arr.ndim == 1 else arr
                return arr.astype(np.float32), int(target_rate), 1
        except Exception as exc:
            logging.debug("audio.preprocessor: ffmpeg decode failed: %s", exc)

        # As last resort, assume incoming is already PCM compatible with target settings
        if np is None:
            return None, target_rate, channels
        logging.debug(
            "audio.preprocessor: falling back to raw PCM interpretation for content_type=%s",
            payload.content_type,
        )
        if len(data) % 4 == 0:
            arr = np.frombuffer(data, dtype="<f4")
            arr = arr.reshape(-1, 1)
        else:
            arr = np.frombuffer(data, dtype="<i2").astype(np.float32)
            arr = (arr / 32768.0).reshape(-1, 1)
        return arr.astype(np.float32), target_rate, 1

    def _mix_down(self, pcm: "np.ndarray", channels: int) -> "np.ndarray":
        if channels <= 1:
            return pcm
        return np.mean(pcm, axis=1, keepdims=True, dtype=np.float32).astype(np.float32)

    def _resample(self, pcm: "np.ndarray", source_rate: int, target_rate: int) -> Tuple["np.ndarray", bool]:
        if resampy is None or source_rate == target_rate or pcm.size == 0:
            return pcm, False
        pcm_flat = pcm[:, 0]
        resampled = resampy.resample(pcm_flat, source_rate, target_rate)
        return resampled[:, None].astype(np.float32), True
