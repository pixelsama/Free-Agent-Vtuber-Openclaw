function registerConversationIpc({
  ipcMain,
  conversationRuntime,
} = {}) {
  if (!ipcMain || !conversationRuntime) {
    return () => {};
  }

  ipcMain.handle('conversation:submit-user-text', async (_event, request = {}) => {
    return conversationRuntime.submitUserText(request);
  });

  ipcMain.handle('conversation:abort-active', async (_event, request = {}) => {
    return conversationRuntime.abortActive(request);
  });

  return () => {
    ipcMain.removeHandler('conversation:submit-user-text');
    ipcMain.removeHandler('conversation:abort-active');
  };
}

module.exports = {
  registerConversationIpc,
};
