function parseEventBlock(rawBlock) {
  const lines = rawBlock.split('\n');
  let event = 'message';
  const data = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: data.join('\n'),
  };
}

function createSseParser(onEvent) {
  let buffer = '';

  const emitBufferedEvents = () => {
    while (true) {
      const separatorIndex = buffer.indexOf('\n\n');
      if (separatorIndex === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);

      if (!rawEvent) {
        continue;
      }

      onEvent(parseEventBlock(rawEvent));
    }
  };

  return {
    push(chunk) {
      if (!chunk) {
        return;
      }

      buffer += chunk.replace(/\r\n/g, '\n');
      emitBufferedEvents();
    },
    flush() {
      const remaining = buffer.trim();
      buffer = '';
      if (!remaining) {
        return;
      }

      onEvent(parseEventBlock(remaining));
    },
  };
}

module.exports = {
  createSseParser,
};
