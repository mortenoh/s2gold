//! API models. The wire format mirrors the previous pydantic models exactly:
//! metadata structs have no `data` field (list responses omit the key entirely),
//! nullable fields serialize as explicit `null`, and timestamps are carried as
//! verbatim RFC3339 strings so records imported from the pre-database JSON files
//! keep their original byte-exact values.

use chrono::{DateTime, SecondsFormat, Timelike, Utc};
use serde::{Deserialize, Serialize};

pub type JsonObject = serde_json::Map<String, serde_json::Value>;

/// Valid save/session ids: `^[a-z0-9][a-z0-9_-]{0,63}$` (also guards path traversal).
pub fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    let tail_ok = |c: &u8| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-';
    (1..=64).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes.iter().all(tail_ok)
}

/// Timezone-aware now as RFC3339 with `Z`, truncated to microseconds and with the
/// fraction omitted when zero — the exact shape pydantic wrote to existing records.
pub fn utcnow() -> String {
    let now = Utc::now();
    let now = now
        .with_nanosecond(now.nanosecond() / 1000 * 1000)
        .unwrap_or(now);
    now.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

/// Parse a stored timestamp for ordering; unparsable values sort oldest.
pub fn parse_timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_default()
}

/// Metadata about a stored save game (list responses; no engine state).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveMeta {
    pub id: String,
    pub name: String,
    pub map: String,
    #[serde(default)]
    pub tick: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A save game as sent by the client: metadata plus the opaque engine state.
#[derive(Debug, Deserialize)]
pub struct SavePayload {
    pub name: String,
    pub map: String,
    #[serde(default)]
    pub tick: i64,
    pub data: JsonObject,
}

/// A full stored save game (metadata plus the opaque engine state).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveGame {
    pub id: String,
    pub name: String,
    pub map: String,
    #[serde(default)]
    pub tick: i64,
    pub created_at: String,
    pub updated_at: String,
    pub data: JsonObject,
}

/// A request to start a new server-side game session.
#[derive(Debug, Deserialize)]
pub struct SessionCreate {
    pub map: String,
    #[serde(default)]
    pub ai: Vec<i64>,
    /// Per-slot nation codes ("rom"/"vik"/"nub"/"jap"), indexed by player slot.
    /// None (the default) means an all-Roman game, keeping backward compatibility
    /// with clients/sessions created before nations existed.
    #[serde(default)]
    pub nations: Option<Vec<String>>,
    #[serde(default)]
    pub campaign: Option<i64>,
}

/// Metadata about a stored game session (no world data).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub map: String,
    #[serde(default)]
    pub ai: Vec<i64>,
    /// Slot-indexed nation codes; None on legacy records = all-Roman (see above).
    #[serde(default)]
    pub nations: Option<Vec<String>>,
    pub campaign: Option<i64>,
    #[serde(default)]
    pub tick: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A serialized world snapshot as PUT by the client.
#[derive(Debug, Deserialize)]
pub struct SessionSnapshot {
    #[serde(default)]
    pub tick: i64,
    pub data: JsonObject,
}

/// A full stored session (metadata plus the optional serialized world).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub map: String,
    #[serde(default)]
    pub ai: Vec<i64>,
    #[serde(default)]
    pub nations: Option<Vec<String>>,
    pub campaign: Option<i64>,
    #[serde(default)]
    pub tick: i64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub data: Option<JsonObject>,
}
