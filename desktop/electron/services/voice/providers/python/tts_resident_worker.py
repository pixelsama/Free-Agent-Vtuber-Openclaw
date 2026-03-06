#!/usr/bin/env python3
import argparse
import base64
import json
import sys
import threading
from pathlib import Path

import numpy as np


JSON_PREFIX = '__TTS_JSON__'


def emit(payload):
  sys.stdout.write(JSON_PREFIX + json.dumps(payload, ensure_ascii=False) + '\n')
  sys.stdout.flush()


def emit_error(message, request_id='', code='tts_worker_error'):
  emit({
      'type': 'error',
      'requestId': request_id,
      'code': code,
      'message': message,
  })


def normalize_bool(value, default=False):
  if isinstance(value, bool):
    return value
  if value is None:
    return default
  normalized = str(value).strip().lower()
  if not normalized:
    return default
  if normalized in ('1', 'true', 'yes', 'on'):
    return True
  if normalized in ('0', 'false', 'no', 'off'):
    return False
  return default


def parse_args():
  parser = argparse.ArgumentParser(description='Free Agent OpenClaw resident TTS worker')
  parser.add_argument('--engine', default='qwen3-mlx')
  parser.add_argument('--model-dir', default='')
  parser.add_argument('--tokenizer-dir', default='')
  parser.add_argument('--tts-mode', default='custom_voice')
  parser.add_argument('--speaker', default='vivian')
  parser.add_argument('--language', default='Chinese')
  parser.add_argument('--device', default='auto')
  parser.add_argument('--stream', default='1')
  parser.add_argument('--streaming-interval', default='0.4')
  parser.add_argument('--temperature', default='0.9')
  return parser.parse_args()


class TtsWorker:
  def __init__(self, args):
    self.args = args
    self.lock = threading.Lock()
    self.active_request_id = ''
    self.active_cancel_event = None
    self.active_thread = None
    self.shutdown_requested = False

    engine = (args.engine or 'qwen3-mlx').strip().lower()
    if engine != 'qwen3-mlx':
      raise RuntimeError(f'Unsupported resident TTS engine: {engine}')

    model_dir = (args.model_dir or '').strip()
    if not model_dir:
      raise RuntimeError('Missing --model-dir')
    if not Path(model_dir).exists():
      raise RuntimeError(f'Model directory does not exist: {model_dir}')

    from mlx_audio.tts.utils import load_model

    self.model = load_model(model_dir)
    self.engine = engine
    self.speaker = (args.speaker or 'vivian').strip() or 'vivian'
    self.language = (args.language or 'Chinese').strip() or 'Chinese'
    self.tts_mode = (args.tts_mode or 'custom_voice').strip() or 'custom_voice'
    self.device = (args.device or 'auto').strip() or 'auto'
    self.stream = normalize_bool(args.stream, True)
    self.streaming_interval = max(0.1, float(args.streaming_interval or 0.4))
    self.temperature = max(0.0, float(args.temperature or 0.9))

  def synthesize(self, payload):
    request_id = str(payload.get('requestId', '')).strip()
    text = str(payload.get('text', '')).strip()
    if not request_id:
      emit_error('Missing requestId.', code='tts_worker_invalid_request')
      return
    if not text:
      emit_error('Missing text.', request_id=request_id, code='tts_worker_invalid_request')
      return

    with self.lock:
      if self.active_thread and self.active_thread.is_alive():
        emit_error('TTS worker is busy.', request_id=request_id, code='tts_worker_busy')
        return

      cancel_event = threading.Event()
      self.active_request_id = request_id
      self.active_cancel_event = cancel_event
      self.active_thread = threading.Thread(
          target=self._run_synthesize,
          args=(request_id, text, str(payload.get('instruct', '')).strip(), cancel_event),
          daemon=True,
      )
      self.active_thread.start()

  def abort(self, payload):
    request_id = str(payload.get('requestId', '')).strip()
    if not request_id:
      return

    with self.lock:
      if self.active_request_id == request_id and self.active_cancel_event:
        self.active_cancel_event.set()

  def shutdown(self):
    self.shutdown_requested = True
    with self.lock:
      if self.active_cancel_event:
        self.active_cancel_event.set()
    emit({'type': 'shutdown-ack'})

  def _run_synthesize(self, request_id, text, instruct, cancel_event):
    sample_rate = 24000
    total_sample_count = 0

    try:
      kwargs = {
          'text': text,
          'voice': self.speaker,
          'lang_code': self.language,
          'stream': self.stream,
          'streaming_interval': self.streaming_interval,
          'temperature': self.temperature,
          'verbose': False,
      }
      if instruct:
        kwargs['instruct'] = instruct

      for result in self.model.generate(**kwargs):
        if cancel_event.is_set() or self.shutdown_requested:
          emit({
              'type': 'result',
              'requestId': request_id,
              'sampleRate': sample_rate,
              'sampleCount': total_sample_count,
              'aborted': True,
          })
          return

        sample_rate = int(getattr(result, 'sample_rate', sample_rate) or sample_rate)
        audio = getattr(result, 'audio', None)
        if audio is None:
          continue

        samples = np.asarray(audio, dtype=np.float32)
        if samples.size == 0:
          continue
        samples = np.clip(samples, -1.0, 1.0)
        pcm_bytes = (samples * 32767.0).astype(np.int16).tobytes()
        chunk_sample_count = len(pcm_bytes) // 2
        total_sample_count += chunk_sample_count

        emit({
            'type': 'chunk',
            'requestId': request_id,
            'sampleRate': sample_rate,
            'sampleCount': chunk_sample_count,
            'pcmS16LeBase64': base64.b64encode(pcm_bytes).decode('ascii'),
        })

      emit({
          'type': 'result',
          'requestId': request_id,
          'sampleRate': sample_rate,
          'sampleCount': total_sample_count,
      })
    except Exception as error:  # pylint: disable=broad-except
      emit_error(str(error), request_id=request_id, code='tts_worker_failed')
    finally:
      with self.lock:
        if self.active_request_id == request_id:
          self.active_request_id = ''
          self.active_cancel_event = None
          self.active_thread = None


def main():
  args = parse_args()
  worker = TtsWorker(args)
  emit({
      'type': 'ready',
      'engine': worker.engine,
      'deviceUsed': 'mlx',
  })

  for line in sys.stdin:
    raw = line.strip()
    if not raw:
      continue

    try:
      payload = json.loads(raw)
    except Exception:  # pylint: disable=broad-except
      emit_error('Invalid JSON input.', code='tts_worker_invalid_json')
      continue

    message_type = str(payload.get('type', '')).strip()
    if message_type == 'synthesize':
      worker.synthesize(payload)
      continue
    if message_type == 'abort':
      worker.abort(payload)
      continue
    if message_type == 'shutdown':
      worker.shutdown()
      break

    emit_error(f'Unsupported message type: {message_type}', code='tts_worker_invalid_message')


if __name__ == '__main__':
  main()
