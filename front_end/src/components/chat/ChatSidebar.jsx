import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Drawer,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import SendIcon from '@mui/icons-material/Send';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import { useI18n } from '../../i18n/I18nContext.jsx';
import MessageBubble from './MessageBubble.jsx';
import './ChatSidebar.css';

export const CHAT_SIDEBAR_WIDTH = 420;
export const CHAT_SIDEBAR_WIDTH_PET = 300;

export default function ChatSidebar({
  open = false,
  onClose,
  variant = 'main',
  isPetMode = false,
  isNarrowViewport = false,
  petHoverBindings = {},
  captureShortcutToken = 0,
  messages = [],
  onClearHistory,
  isStreaming = false,
  onSubmit,
  onStop,
  externalError = '',
  onDismissExternalError,
  canCaptureScreen = false,
  onCaptureScreen,
  onReleaseCapture,
  voiceEnabled = false,
  voiceToggleDisabled = true,
  onToggleVoice,
  characterName = '',
}) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const captureDraftRef = useRef(null);
  const lastCaptureShortcutTokenRef = useRef(captureShortcutToken);

  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState('');
  const [isImeComposing, setIsImeComposing] = useState(false);
  const [captureDraft, setCaptureDraft] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const effectiveError = useMemo(
    () => localError || externalError || '',
    [localError, externalError],
  );

  const drawerWidth = variant === 'pet' ? CHAT_SIDEBAR_WIDTH_PET : CHAT_SIDEBAR_WIDTH;
  const isPetVariant = variant === 'pet' || isPetMode;
  // In pet mode or narrow viewport, use temporary (overlay) drawer
  const drawerVariant = isPetMode || isNarrowViewport ? 'temporary' : 'persistent';

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Clear external error when user starts typing
  const handleChange = useCallback(
    (e) => {
      setValue(e.target.value);
      if (externalError) {
        onDismissExternalError?.();
      }
    },
    [externalError, onDismissExternalError],
  );

  const clearCaptureDraft = useCallback(
    (capture = captureDraftRef.current, { release = true } = {}) => {
      if (release && capture?.captureId) {
        void onReleaseCapture?.(capture.captureId);
      }
      setCaptureDraft(null);
      captureDraftRef.current = null;
    },
    [onReleaseCapture],
  );

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setLocalError(t('composer.emptyInput'));
      return;
    }

    setLocalError('');
    const draft = captureDraftRef.current;
    setValue('');
    clearCaptureDraft(draft, { release: false });

    const submitOptions = draft
      ? { attachments: [{ kind: 'capture-image', captureId: draft.captureId }] }
      : {};

    try {
      await onSubmit?.(trimmed, submitOptions);
    } catch (err) {
      setLocalError(
        typeof err?.message === 'string' && err.message
          ? err.message
          : t('common.sendFailed'),
      );
    }
  }, [clearCaptureDraft, onSubmit, t, value]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !isImeComposing) {
        e.preventDefault();
        if (!isStreaming) {
          void submit();
        }
      }
    },
    [isImeComposing, isStreaming, submit],
  );

  const handleCaptureClick = useCallback(async () => {
    if (captureDraftRef.current) {
      clearCaptureDraft();
      return;
    }

    if (!canCaptureScreen) {
      return;
    }

    setIsCapturing(true);
    try {
      const result = await onCaptureScreen?.();
      if (result?.captureId) {
        const draft = {
          captureId: result.captureId,
          previewUrl: result.previewUrl || null,
          name: result.name || '',
        };
        captureDraftRef.current = draft;
        setCaptureDraft(draft);
      }
    } catch {
      setLocalError(t('composer.captureSaveFailed'));
    } finally {
      setIsCapturing(false);
    }
  }, [canCaptureScreen, clearCaptureDraft, onCaptureScreen, t]);

  useEffect(() => {
    if (!open || !canCaptureScreen) {
      return;
    }

    if (captureShortcutToken === lastCaptureShortcutTokenRef.current) {
      return;
    }

    lastCaptureShortcutTokenRef.current = captureShortcutToken;
    if (!isStreaming && !isCapturing) {
      void handleCaptureClick();
    }
  }, [
    canCaptureScreen,
    captureShortcutToken,
    handleCaptureClick,
    isCapturing,
    isStreaming,
    open,
  ]);

  const handleDrawerClose = useCallback(() => {
    clearCaptureDraft();
    onClose?.();
  }, [clearCaptureDraft, onClose]);

  useEffect(() => {
    if (!open) {
      clearCaptureDraft();
      setLocalError('');
    }
  }, [clearCaptureDraft, open]);

  useEffect(
    () => () => {
      if (captureDraftRef.current?.captureId) {
        void onReleaseCapture?.(captureDraftRef.current.captureId);
      }
    },
    [onReleaseCapture],
  );

  const handleClearHistory = useCallback(() => {
    if (window.confirm(t('chat.clearHistoryConfirm'))) {
      onClearHistory?.();
    }
  }, [onClearHistory, t]);

  const displayName = characterName || t('chat.sidebarTitle');

  const content = (
    <div className="chat-sidebar">
      {/* Header */}
      <div className="chat-sidebar-header">
        <ChatIcon className="chat-sidebar-header-icon" fontSize="small" />
        <Typography className="chat-sidebar-title" variant="subtitle1" component="h2" noWrap>
          {displayName}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {messages.length > 0 && (
          <Tooltip title={t('chat.clearHistory')}>
            <IconButton
              size="small"
              onClick={handleClearHistory}
              className="chat-sidebar-action-btn"
              aria-label={t('chat.clearHistory')}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('common.close')}>
          <IconButton
            size="small"
            onClick={handleDrawerClose}
            className="chat-sidebar-action-btn"
            aria-label={t('common.close')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>

      {/* Message list */}
      <div className="chat-message-list" role="log" aria-live="polite" aria-label={t('chat.sidebarTitle')}>
        {messages.length === 0 ? (
          <div className="chat-empty-hint">{t('chat.emptyHint')}</div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              characterName={characterName}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        {captureDraft && (
          <div className="chat-capture-badge">
            <span className="chat-capture-badge-icon">📷</span>
            <span className="chat-capture-badge-label">{t('chat.captureAttached')}</span>
            <IconButton
              size="small"
              onClick={() => clearCaptureDraft()}
              aria-label={t('composer.captureRemove')}
              className="chat-capture-badge-remove"
            >
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </div>
        )}

        {effectiveError && (
          <div className="chat-input-error">{effectiveError}</div>
        )}

        <TextField
          inputRef={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsImeComposing(true)}
          onCompositionEnd={() => setIsImeComposing(false)}
          placeholder={t('chat.placeholder')}
          multiline
          minRows={variant === 'pet' ? 2 : 3}
          maxRows={6}
          fullWidth
          variant="outlined"
          size="small"
          disabled={isCapturing}
          className="chat-input-field"
          inputProps={{ maxLength: 400 }}
        />

        <div className="chat-input-toolbar">
          <div className="chat-input-toolbar-left">
            {/* Voice toggle */}
            <Tooltip
              title={voiceEnabled ? t('composer.voiceDisableTitle') : t('composer.voiceEnableTitle')}
            >
              <span>
                <IconButton
                  size="small"
                  onClick={onToggleVoice}
                  disabled={voiceToggleDisabled}
                  color={voiceEnabled ? 'secondary' : 'default'}
                  className="chat-toolbar-btn"
                  aria-label={voiceEnabled ? t('composer.voiceDisableTitle') : t('composer.voiceEnableTitle')}
                >
                  {voiceEnabled ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>

            {/* Screenshot */}
            {canCaptureScreen && (
              <Tooltip title={t('composer.captureTitle')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={handleCaptureClick}
                    disabled={isStreaming || isCapturing}
                    color={captureDraft ? 'secondary' : 'default'}
                    className="chat-toolbar-btn"
                    aria-label={t('composer.captureTitle')}
                  >
                    <ContentCutIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </div>

          <div className="chat-input-toolbar-right">
            {isStreaming ? (
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<StopCircleIcon />}
                onClick={onStop}
                className="chat-send-btn"
              >
                {t('chat.stop')}
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<SendIcon />}
                onClick={submit}
                disabled={!value.trim()}
                className="chat-send-btn"
              >
                {t('chat.send')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (isPetVariant) {
    if (!open) {
      return null;
    }

    return (
      <div
        className="chat-pet-float-layer"
        onMouseDown={(event) => event.stopPropagation()}
        onMouseEnter={(event) => petHoverBindings?.onMouseEnter?.(event)}
        onMouseLeave={(event) => petHoverBindings?.onMouseLeave?.(event)}
      >
        <Paper className="chat-sidebar-paper chat-pet-float-panel" style={{ width: drawerWidth }} elevation={12}>
          {content}
        </Paper>
      </div>
    );
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleDrawerClose}
      variant={drawerVariant}
      PaperProps={{
        className: 'chat-sidebar-paper',
        style: { width: drawerWidth },
      }}
      ModalProps={{ keepMounted: false }}
    >
      {content}
    </Drawer>
  );
}
