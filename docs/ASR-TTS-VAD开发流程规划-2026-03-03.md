# Free-Agent VTuber OpenClaw 语音链路开发流程规划（ASR / TTS / VAD）

日期：2026-03-03  
适用范围：当前 Electron + OpenClaw 文本主链路仓库（无 Python 后端依赖）

## 1. 背景与目标

当前仓库主链路已稳定在文本流式对话；语音能力（ASR/TTS/VAD）尚未落地。  
本规划目标是以最小回归风险，分阶段实现：

1. 麦克风输入 -> VAD 判定 -> ASR 转写
2. 转写文本 -> 现有聊天主链路（OpenClaw stream）
3. 回复文本 -> TTS 合成 -> Electron 内部二进制播放（非 URL 拉取）
4. 全链路支持中断、错误可观测、可测试

## 2. 设计原则

1. 不破坏当前文本主链路，语音能力先做可开关功能（feature flag）。
2. Token 与上游服务调用继续留在 Electron 主进程，不下放到 renderer。
3. TTS 音频默认走 IPC 二进制流，不走 HTTP URL 回拉。
4. 语音 MVP 直接采用高质量基线（模型 VAD + 可流式 ASR/TTS），避免重复投入低阶方案。
5. 保持可插拔 provider 结构，避免与单一云厂商强耦合。

## 3. 总体架构（建议）

### 3.1 数据流

1. Renderer 采集麦克风音频（WebAudio/MediaRecorder）。
2. Renderer 执行模型 VAD（WASM/ONNX 推理），按 speech start/end 事件切分音频。
3. 音频片段通过 IPC 发送给 Main。
4. Main 调用 ASR provider，回传 `asr-partial/asr-final` 事件。
5. `asr-final` 自动触发现有 `chat:stream:start`。
6. Main 接收文本回复后触发 TTS provider。
7. Main 将音频 chunk（二进制）通过 IPC 推给 Renderer，Renderer 直接解码播放并驱动口型。

### 3.2 模块落点

- `desktop/electron/ipc/voiceSession.js`：语音会话 IPC 与事件分发。
- `desktop/electron/services/voice/`
  - `asrService.js` / `ttsService.js` / `providerFactory.js`
  - `providers/asr/*`、`providers/tts/*`
- `front_end/src/hooks/voice/`
  - `useVoiceCapture.js`（采集 + VAD）
  - `useVoiceSession.js`（状态机 + IPC 桥接）
- `front_end/src/components/controls/Live2DControls.jsx`
  - 增加语音开关、状态指示、错误提示入口。

## 4. 技术路线（MVP -> 增强）

### 4.1 ASR 路线

- MVP：云 ASR provider（建议优先 OpenAI Whisper API 或兼容供应商）
  - 优点：落地快，维护成本低。
  - 代价：有网络与费用依赖。
- 阶段二：可选本地 ASR provider（离线/低网络依赖）
  - 作为可插拔扩展，不影响 MVP 发布。

### 4.2 TTS 路线

- MVP：云 TTS provider（返回音频 buffer 或 chunk）。
- 播放链路：Main -> Renderer IPC 二进制流 -> WebAudio 播放。
- 阶段二：流式 TTS（首音延迟优化）与句内打断。

### 4.3 VAD 路线

- MVP：直接使用模型 VAD（建议 Silero VAD WASM 或同等级方案）。
- 仅保留“按键说话”作为应急回退，不再规划阈值 VAD 版本。

## 5. 分阶段计划（6 周建议）

### Phase 0（第 1 周）：语音基础设施骨架

1. 建立 `voiceSession` IPC 协议与状态机（idle/listening/transcribing/speaking/error）。
2. 增加 feature flags：
   - `VOICE_ENABLED`
   - `VOICE_VAD_ENABLED`
   - `VOICE_ASR_PROVIDER`
   - `VOICE_TTS_PROVIDER`
3. 增加 Mock ASR/TTS provider，先打通端到端事件流。

验收：
- 不接入真实模型时，也能完成“录音 -> mock 文本 -> mock 音频播放”。

### Phase 1（第 2-3 周）：ASR + 模型 VAD MVP

1. 前端接入模型 VAD（含模型加载、预热、实时推理和分段）。
2. Main 集成真实 ASR provider，支持 partial/final。
3. ASR final 自动注入现有聊天文本输入链路。

验收：
- 可通过模型 VAD 稳定触发一次对话，误触发率低，错误可见，支持取消。

### Phase 2（第 4 周）：TTS MVP（二进制播放）

1. Main 集成真实 TTS provider。
2. TTS 音频通过 IPC 二进制发送到 Renderer。
3. Renderer 复用现有 lip-sync 分析逻辑，替代 `audioUrl` 播放依赖。

验收：
- 全链路“说 -> 识别 -> 回复 -> 发声”可用，且不依赖音频 URL 拉取。

### Phase 3（第 5 周）：中断与并发控制

1. 统一 STOP 语义：录音中断、ASR 中断、聊天中断、TTS 中断。
2. 增加串行策略（同一会话仅允许 1 条活跃语音链路）。
3. 完善异常恢复（provider 超时、网络中断、设备占用）。

验收：
- 连续打断 20 次不出现僵死状态、资源泄漏或鬼畜播放。

### Phase 4（第 6 周）：可观测性与优化

1. 记录关键指标：VAD 命中率、ASR 延迟、TTFT、TTS 首音延迟、错误率。
2. 增加诊断面板（最近错误、平均延迟、当前 provider）。
3. 评估模型 VAD 多方案对比结果（准确率/延迟/CPU）与流式 TTS 收益。

验收：
- 有可追踪指标并可定位主要性能瓶颈。

## 6. IPC 事件草案

Renderer -> Main：

1. `voice:session:start` `{ sessionId }`
2. `voice:audio:chunk` `{ sessionId, chunk, sampleRate, channels, format }`
3. `voice:input:commit` `{ sessionId }`
4. `voice:session:stop` `{ sessionId }`
5. `voice:tts:stop` `{ sessionId }`

Main -> Renderer：

1. `voice:event` `type=state` `{ status }`
2. `voice:event` `type=asr-partial` `{ text }`
3. `voice:event` `type=asr-final` `{ text }`
4. `voice:event` `type=tts-chunk` `{ audioChunk, codec, sampleRate }`
5. `voice:event` `type=done` `{ stage }`
6. `voice:event` `type=error` `{ code, message, stage }`

## 7. 测试计划

### 7.1 Desktop（`node:test`）

1. IPC 事件映射：`voice:event` 类型完整性与顺序性。
2. 中断行为：任一阶段 stop 后都能正确清理。
3. provider 异常：超时、401、429、网络断连映射为统一错误码。

### 7.2 Frontend（`vitest`）

1. 模型 VAD 质量测试（静音、短句、噪声、连续语音、背景音乐）。
2. `useVoiceSession` 与现有 `useStreamingChat` 协作测试。
3. 音频 chunk 解码失败与恢复逻辑测试。

### 7.3 手工回归

1. USB 麦克风 / 内置麦克风切换。
2. 无麦克风权限、设备被占用场景。
3. 长对话（>= 15 分钟）内存与句柄稳定性。

## 8. 风险与规避

1. 回声导致 ASR 自激：MVP 先要求耳机模式，后续评估 AEC。
2. 网络抖动导致链路卡顿：加入超时、重试和清晰错误态。
3. IPC 压力过高：限制 chunk 频率与大小，必要时批量发送。
4. 误触发率高：增加模型置信度门限、最短语音时长和场景化参数配置，并保留“按键说话”回退模式。

## 9. 里程碑 DoD（完成定义）

1. 功能可开关：关闭语音时不影响现有文本功能。
2. 关键路径可测试：新增能力有自动化回归。
3. 资源可回收：多次开始/停止不会泄漏。
4. 文档可执行：新成员可按文档在 30 分钟内跑通语音 MVP。

## 10. 待确认决策（建议本周拍板）

1. ASR MVP provider 选择（OpenAI Whisper 或其他兼容服务）。
2. TTS MVP provider 选择（优先返回流式或可分片数据的服务）。
3. VAD 模型与部署方案（Silero WASM/ONNX 或其他同等级方案）。
4. 默认交互模式（自动 VAD 或按键说话）。

---

如果以上方向确认，下一步建议直接产出两份文档：
1. `voiceSession` IPC 协议定稿（字段级别）；  
2. Phase 0 的任务拆解清单（按文件与测试用例编号）。
