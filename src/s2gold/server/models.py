"""Pydantic models for the s2gold server API."""

from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_validator

SAVE_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,63}$"


class ErrorResponse(BaseModel):
    """Standard error response."""

    detail: str
    code: str = "UNKNOWN_ERROR"


class SaveMeta(BaseModel):
    """Metadata about a stored save game."""

    id: str = Field(pattern=SAVE_ID_PATTERN)
    name: str
    map: str
    tick: int = 0
    created_at: datetime
    updated_at: datetime


class SavePayload(BaseModel):
    """A save game as sent by the client: metadata plus the opaque engine state."""

    name: str
    map: str
    tick: int = 0
    data: dict[str, object]

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        """Reject empty or whitespace-only names."""
        if not v.strip():
            raise ValueError("name must not be blank")
        return v


class SaveGame(SaveMeta):
    """A full stored save game (metadata plus the opaque engine state)."""

    data: dict[str, object]


class SessionCreate(BaseModel):
    """A request to start a new server-side game session."""

    map: str
    ai: list[int] = []
    # Per-slot nation codes ("rom"/"vik"/"nub"/"jap"), indexed by player slot.
    # Optional: None (the default) means an all-Roman game, keeping backward
    # compatibility with clients/sessions created before nations existed.
    nations: list[str] | None = None
    campaign: int | None = None


class SessionMeta(BaseModel):
    """Metadata about a stored game session (no world data)."""

    id: str = Field(pattern=SAVE_ID_PATTERN)
    map: str
    ai: list[int]
    # Slot-indexed nation codes; None on legacy sessions = all-Roman (see above).
    nations: list[str] | None = None
    campaign: int | None
    tick: int = 0
    created_at: datetime
    updated_at: datetime


class SessionSnapshot(BaseModel):
    """A serialized world snapshot as PUT by the client."""

    tick: int = 0
    data: dict[str, object]


class SessionRecord(SessionMeta):
    """A full stored session (metadata plus the optional serialized world)."""

    data: dict[str, object] | None = None


def utcnow() -> datetime:
    """Timezone-aware now, single definition for consistent timestamps."""
    return datetime.now(UTC)
