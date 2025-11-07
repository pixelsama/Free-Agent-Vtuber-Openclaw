<template>
  <v-app :style="{ backgroundColor: $vuetify.theme.current.colors.background }">
    <v-main class="live2d-main">
      <div class="live2d-stage">
        <Live2DViewer
          ref="live2dViewer"
          :model-path="currentModelPath"
          :motions="motions"
          :expressions="expressions"
          :width="viewerWidth"
          :height="viewerHeight"
          @model-loaded="handleModelLoaded"
          @model-error="handleModelError"
          class="live2d-canvas"
        />
        <v-btn
          class="config-toggle"
          icon="mdi-tune-variant"
          variant="tonal"
          color="primary"
          @click="showConfigPanel = true"
        ></v-btn>
        <v-btn
          class="mic-toggle"
          :icon="isRecording ? 'mdi-microphone-off' : 'mdi-microphone'"
          variant="tonal"
          :color="isRecording ? 'error' : 'primary'"
          @click="toggleMicrophone"
        ></v-btn>
        <v-btn
          class="text-toggle"
          icon="mdi-pencil"
          variant="tonal"
          color="primary"
          @click="openTextInputDialog"
        ></v-btn>
        <SubtitleBar :text="subtitleText" />
      </div>

      <v-dialog v-model="showConfigPanel" max-width="480" persistent scrollable>
        <v-card class="config-dialog">
          <v-toolbar flat density="comfortable">
            <v-btn icon="mdi-close" variant="text" @click="showConfigPanel = false"></v-btn>
            <v-toolbar-title>Live2D 控制面板</v-toolbar-title>
            <v-spacer></v-spacer>
            <v-chip
              v-if="modelLoaded"
              density="compact"
              color="success"
              variant="tonal"
              prepend-icon="mdi-check-circle"
            >
              模型已加载
            </v-chip>
          </v-toolbar>
          <v-divider></v-divider>
          <v-card-text class="config-dialog__body">
            <Live2DControls
              :live2d-viewer="live2dViewer"
              :model-loaded="modelLoaded"
              @model-change="handleModelChange"
              @motions-update="handleMotionsUpdate"
              @expressions-update="handleExpressionsUpdate"
              @auto-eye-blink-change="handleAutoEyeBlinkChange"
              @auto-breath-change="handleAutoBreathChange"
              @eye-tracking-change="handleEyeTrackingChange"
              @model-scale-change="handleModelScaleChange"
              @background-change="handleBackgroundChange"
              class="config-dialog__controls"
            />
          </v-card-text>
        </v-card>
      </v-dialog>

      <v-dialog v-model="showTextInputDialog" max-width="420">
        <v-card>
          <v-card-title class="text-h6">发送文字消息</v-card-title>
          <v-card-text>
            <v-textarea
              v-model="textInputContent"
              auto-grow
              rows="3"
              counter
              maxlength="400"
              :disabled="isSendingText"
              placeholder="输入你想让她说的话..."
              @keydown.enter.prevent="submitTextInput"
            />
            <v-alert
              v-if="textInputError"
              type="error"
              variant="tonal"
              density="comfortable"
              class="mt-2"
            >
              {{ textInputError }}
            </v-alert>
          </v-card-text>
          <v-card-actions class="justify-end">
            <v-btn variant="text" @click="closeTextInputDialog" :disabled="isSendingText">取消</v-btn>
            <v-btn color="primary" :loading="isSendingText" @click="submitTextInput">发送</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-main>
  </v-app>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import Live2DViewer from './components/Live2DViewer.vue';
import Live2DControls from './components/Live2DControls.vue';
import SubtitleBar from './components/SubtitleBar.vue';
import { useApi } from './composables/useApi';
import { useStreamingChat } from './composables/useStreamingChat';
import { useSubtitleFeed } from './composables/useSubtitleFeed';

const live2dViewer = ref(null);
const modelLoaded = ref(false);
const currentModelPath = ref('/src/live2d/models/Haru/Haru.model3.json');
const showConfigPanel = ref(false);
const motions = ref([]);
const expressions = ref([]);
const { subtitleText, appendDelta, replaceText, clearSubtitle, beginStream } = useSubtitleFeed();
const viewerWidth = ref(400);
const viewerHeight = ref(600);
const showTextInputDialog = ref(false);
const textInputContent = ref('');
const textInputError = ref('');
const isSendingText = ref(false);

const { receivedAudioUrl, isRecording, startRecording, stopRecording, recordingError } = useApi();
const { startStreaming, cancelStreaming, onDelta, onDone, onError } = useStreamingChat();

const detachDelta = onDelta((delta) => {
  appendDelta(delta);
});

const detachDone = onDone(() => {
  replaceText(subtitleText.value);
});

const detachError = onError((error) => {
  console.error('字幕流式输出发生错误:', error);
  clearSubtitle();
});

const handleModelLoaded = (model) => {
  modelLoaded.value = true;
  if (live2dViewer.value?.initAudioContext) {
    live2dViewer.value.initAudioContext();
  }
};

const handleModelError = (error) => {
  modelLoaded.value = false;
  console.error('Model error in App:', error);
};

const handleModelChange = (newModelPath) => {
  currentModelPath.value = newModelPath;
  modelLoaded.value = false;
};

const handleMotionsUpdate = (updatedMotions) => {
  motions.value = updatedMotions;
};

const handleExpressionsUpdate = (updatedExpressions) => {
  expressions.value = updatedExpressions;
};

const handleAutoEyeBlinkChange = (enabled) => {
  const manager = live2dViewer.value?.getManager?.();
  manager?.setAutoEyeBlinkEnable(enabled);
};

const handleAutoBreathChange = (enabled) => {
  const manager = live2dViewer.value?.getManager?.();
  manager?.setAutoBreathEnable(enabled);
};

const handleEyeTrackingChange = (enabled) => {
  const manager = live2dViewer.value?.getManager?.();
  manager?.setEyeTrackingEnable(enabled);
};

const handleModelScaleChange = (scale) => {
  const manager = live2dViewer.value?.getManager?.();
  manager?.setModelScale(scale);
};

const handleBackgroundChange = (backgroundConfig) => {
  const manager = live2dViewer.value?.getManager?.();
  manager?.setBackground(
    backgroundConfig.image,
    backgroundConfig.opacity,
    backgroundConfig.hasBackground,
  );
};

watch(receivedAudioUrl, (newUrl) => {
  if (newUrl && live2dViewer.value) {
    live2dViewer.value.playAudioWithLipSync(null, newUrl);
  }
});

watch(recordingError, (error) => {
  if (error) {
    console.error('录音发生错误:', error);
  }
});

const openTextInputDialog = () => {
  textInputContent.value = '';
  textInputError.value = '';
  showTextInputDialog.value = true;
};

const closeTextInputDialog = () => {
  if (isSendingText.value) return;
  showTextInputDialog.value = false;
  textInputContent.value = '';
  textInputError.value = '';
};

const submitTextInput = async () => {
  const content = textInputContent.value.trim();
  if (!content) {
    textInputError.value = '请输入要发送的内容。';
    return;
  }
  textInputError.value = '';
  isSendingText.value = true;
  try {
    await sendUserText(content, { sessionId: 'text-dialog' });
    showTextInputDialog.value = false;
    textInputContent.value = '';
  } catch (error) {
    console.error('发送文字消息失败:', error);
    textInputError.value = '发送失败，请稍后重试。';
  } finally {
    isSendingText.value = false;
  }
};

const sendUserText = async (content, options = {}) => {
  if (!content) return;
  beginStream();
  await startStreaming(options.sessionId || 'default', content, options.payload);
};

const stopStreaming = () => {
  cancelStreaming();
};

const toggleMicrophone = () => {
  if (isRecording.value) {
    stopRecording();
  } else {
    startRecording();
  }
};

onBeforeUnmount(() => {
  stopStreaming();
  detachDelta?.();
  detachDone?.();
  detachError?.();
});

// 暴露给外部以便后续集成语音识别或其他输入方式触发字幕流
defineExpose({
  sendUserText,
  stopStreaming,
});
</script>

<style scoped>
.live2d-main {
  min-height: 100vh;
  padding: 0;
  display: flex;
  align-items: stretch;
  justify-content: center;
  background: radial-gradient(circle at top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0));
}

.live2d-stage {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
}

.live2d-canvas {
  width: 100%;
  height: 100%;
}

.config-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 5;
}

.mic-toggle {
  position: absolute;
  top: 20px;
  right: 80px;
  z-index: 5;
}

.text-toggle {
  position: absolute;
  bottom: 24px;
  right: 24px;
  z-index: 6;
}

.config-dialog {
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.config-dialog__body {
  padding: 0;
  overflow: auto;
}

.config-dialog__controls {
  min-height: 480px;
}
</style>
