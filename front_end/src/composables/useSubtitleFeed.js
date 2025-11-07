import { ref } from 'vue';

const subtitleText = ref('');
const isStreaming = ref(false);

const beginStream = () => {
  subtitleText.value = '';
  isStreaming.value = true;
};

const appendDelta = (chunk) => {
  if (!chunk) {
    return;
  }
  subtitleText.value += chunk;
  isStreaming.value = true;
};

const replaceText = (text) => {
  subtitleText.value = text || '';
  isStreaming.value = false;
};

const clearSubtitle = () => {
  subtitleText.value = '';
  isStreaming.value = false;
};

export function useSubtitleFeed() {
  return {
    subtitleText,
    isStreaming,
    beginStream,
    appendDelta,
    replaceText,
    clearSubtitle,
  };
}
