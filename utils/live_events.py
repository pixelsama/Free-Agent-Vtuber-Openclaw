from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass(slots=True)
class LiveEvent:
    """Standard representation for live streaming events across platforms."""

    platform: str
    room_id: str
    user_id: str | None
    username: str | None
    message_type: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    priority: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "platform": self.platform,
            "room_id": self.room_id,
            "user_id": self.user_id,
            "username": self.username,
            "message_type": self.message_type,
            "content": self.content,
            "metadata": self.metadata,
            "priority": self.priority,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

