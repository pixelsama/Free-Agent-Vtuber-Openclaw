<template>
  <div class="subtitle-container" v-show="visible">
    <span class="subtitle-text">{{ text }}</span>
  </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  text: {
    type: String,
    default: '',
  },
  autoHideDelay: {
    type: Number,
    default: 5000,
  },
});

const visible = ref(false);
let hideTimer = null;

const clearHideTimer = () => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

watch(
  () => props.text,
  (newVal) => {
    if (newVal) {
      visible.value = true;
      clearHideTimer();
      hideTimer = setTimeout(() => {
        visible.value = false;
      }, props.autoHideDelay);
    } else {
      clearHideTimer();
      visible.value = false;
    }
  },
);

onBeforeUnmount(() => {
  clearHideTimer();
});
</script>

<style scoped>
.subtitle-container {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: min(960px, 100%);
  padding: 12px 24px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 1.1rem;
  text-align: center;
  pointer-events: none;
  backdrop-filter: blur(6px);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.25);
}

.subtitle-text {
  display: inline-block;
  width: 100%;
  word-break: break-word;
  line-height: 1.6;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.45);
}
</style>
