//! Persistence: a single SQLite-format database (turso) holding saves and
//! sessions. Records imported from the pre-database JSON files keep their
//! timestamp strings verbatim; the originals are never modified or deleted.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::DateTime;
use turso::{Builder, Database, Value};

use crate::error::ApiError;
use crate::models::{
    JsonObject, SaveGame, SaveMeta, SavePayload, SessionCreate, SessionMeta, SessionRecord,
    SessionSnapshot, parse_timestamp, utcnow, valid_id,
};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  map TEXT NOT NULL,
  tick INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  map TEXT NOT NULL,
  ai TEXT NOT NULL,
  nations TEXT,
  campaign INTEGER,
  tick INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT
);
";

/// Errors opening or migrating the database at startup.
#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    Db(turso::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Io(err) => write!(f, "{err}"),
            StoreError::Db(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(err: std::io::Error) -> Self {
        StoreError::Io(err)
    }
}

impl From<turso::Error> for StoreError {
    fn from(err: turso::Error) -> Self {
        StoreError::Db(err)
    }
}

#[derive(Clone)]
pub struct Db {
    database: Database,
}

impl Db {
    /// Open (creating if needed) the database. When the database file does not
    /// exist yet, import the legacy JSON files after creating the schema — and
    /// only then, so emptying the database via the API never re-imports them.
    pub async fn open(
        db_path: &Path,
        legacy_saves_dir: &Path,
        legacy_sessions_dir: &Path,
    ) -> Result<Self, StoreError> {
        let fresh = !db_path.exists();
        if let Some(parent) = db_path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)?;
        }
        let database = Builder::new_local(&db_path.to_string_lossy())
            .build()
            .await?;
        let db = Db { database };
        db.database.connect()?.execute_batch(SCHEMA).await?;
        if fresh {
            db.import_legacy(legacy_saves_dir, legacy_sessions_dir)
                .await?;
        }
        Ok(db)
    }

    async fn import_legacy(&self, saves_dir: &Path, sessions_dir: &Path) -> Result<(), StoreError> {
        for path in json_files(saves_dir) {
            match read_legacy::<SaveGame>(&path).and_then(|save| {
                validate_legacy(&save.id, &save.created_at, &save.updated_at).map(|()| save)
            }) {
                Ok(save) => self.insert_save(&save).await.map_err(io_invalid)?,
                Err(reason) => eprintln!("skipping {}: {reason}", path.display()),
            }
        }
        for path in json_files(sessions_dir) {
            match read_legacy::<SessionRecord>(&path).and_then(|record| {
                validate_legacy(&record.id, &record.created_at, &record.updated_at).map(|()| record)
            }) {
                Ok(record) => self.insert_session(&record).await.map_err(io_invalid)?,
                Err(reason) => eprintln!("skipping {}: {reason}", path.display()),
            }
        }
        Ok(())
    }

    pub async fn saves_list(&self) -> Result<Vec<SaveMeta>, ApiError> {
        let conn = self.database.connect()?;
        let mut rows = conn
            .query(
                "SELECT id, name, map, tick, created_at, updated_at FROM saves ORDER BY id",
                (),
            )
            .await?;
        let mut metas = Vec::new();
        while let Some(row) = rows.next().await? {
            metas.push(SaveMeta {
                id: as_text(row.get_value(0)?)?,
                name: as_text(row.get_value(1)?)?,
                map: as_text(row.get_value(2)?)?,
                tick: as_i64(row.get_value(3)?)?,
                created_at: as_text(row.get_value(4)?)?,
                updated_at: as_text(row.get_value(5)?)?,
            });
        }
        metas.sort_by_key(|m| std::cmp::Reverse(parse_timestamp(&m.updated_at)));
        Ok(metas)
    }

    pub async fn saves_get(&self, id: &str) -> Result<Option<SaveGame>, ApiError> {
        let conn = self.database.connect()?;
        let mut rows = conn
            .query(
                "SELECT id, name, map, tick, created_at, updated_at, data \
                 FROM saves WHERE id = ?",
                vec![Value::Text(id.to_string())],
            )
            .await?;
        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        Ok(Some(SaveGame {
            id: as_text(row.get_value(0)?)?,
            name: as_text(row.get_value(1)?)?,
            map: as_text(row.get_value(2)?)?,
            tick: as_i64(row.get_value(3)?)?,
            created_at: as_text(row.get_value(4)?)?,
            updated_at: as_text(row.get_value(5)?)?,
            data: parse_object(as_text(row.get_value(6)?)?)?,
        }))
    }

    /// Create or overwrite a save, preserving created_at on overwrite.
    pub async fn saves_put(&self, id: &str, payload: SavePayload) -> Result<SaveGame, ApiError> {
        let now = utcnow();
        let created_at = match self.saves_get(id).await? {
            Some(existing) => existing.created_at,
            None => now.clone(),
        };
        let save = SaveGame {
            id: id.to_string(),
            name: payload.name,
            map: payload.map,
            tick: payload.tick,
            created_at,
            updated_at: now,
            data: payload.data,
        };
        self.insert_save(&save).await?;
        Ok(save)
    }

    pub async fn saves_delete(&self, id: &str) -> Result<bool, ApiError> {
        let conn = self.database.connect()?;
        let changed = conn
            .execute(
                "DELETE FROM saves WHERE id = ?",
                vec![Value::Text(id.to_string())],
            )
            .await?;
        Ok(changed > 0)
    }

    async fn insert_save(&self, save: &SaveGame) -> Result<(), ApiError> {
        let conn = self.database.connect()?;
        conn.execute(
            "INSERT OR REPLACE INTO saves (id, name, map, tick, created_at, updated_at, data) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            vec![
                Value::Text(save.id.clone()),
                Value::Text(save.name.clone()),
                Value::Text(save.map.clone()),
                Value::Integer(save.tick),
                Value::Text(save.created_at.clone()),
                Value::Text(save.updated_at.clone()),
                Value::Text(serde_json::to_string(&save.data)?),
            ],
        )
        .await?;
        Ok(())
    }

    /// Create a new session with a server-generated id (32 lowercase hex chars,
    /// which satisfies the id pattern; server bookkeeping, not gameplay).
    pub async fn sessions_create(&self, payload: SessionCreate) -> Result<SessionRecord, ApiError> {
        let now = utcnow();
        let record = SessionRecord {
            id: uuid::Uuid::new_v4().simple().to_string(),
            map: payload.map,
            ai: payload.ai,
            nations: payload.nations,
            campaign: payload.campaign,
            tick: 0,
            created_at: now.clone(),
            updated_at: now,
            data: None,
        };
        self.insert_session(&record).await?;
        Ok(record)
    }

    pub async fn sessions_list(&self) -> Result<Vec<SessionMeta>, ApiError> {
        let conn = self.database.connect()?;
        let mut rows = conn
            .query(
                "SELECT id, map, ai, nations, campaign, tick, created_at, updated_at \
                 FROM sessions ORDER BY id",
                (),
            )
            .await?;
        let mut metas = Vec::new();
        while let Some(row) = rows.next().await? {
            metas.push(SessionMeta {
                id: as_text(row.get_value(0)?)?,
                map: as_text(row.get_value(1)?)?,
                ai: parse_json(as_text(row.get_value(2)?)?)?,
                nations: match as_opt_text(row.get_value(3)?)? {
                    Some(text) => Some(parse_json(text)?),
                    None => None,
                },
                campaign: as_opt_i64(row.get_value(4)?)?,
                tick: as_i64(row.get_value(5)?)?,
                created_at: as_text(row.get_value(6)?)?,
                updated_at: as_text(row.get_value(7)?)?,
            });
        }
        metas.sort_by_key(|m| std::cmp::Reverse(parse_timestamp(&m.updated_at)));
        Ok(metas)
    }

    pub async fn sessions_get(&self, id: &str) -> Result<Option<SessionRecord>, ApiError> {
        let conn = self.database.connect()?;
        let mut rows = conn
            .query(
                "SELECT id, map, ai, nations, campaign, tick, created_at, updated_at, data \
                 FROM sessions WHERE id = ?",
                vec![Value::Text(id.to_string())],
            )
            .await?;
        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        Ok(Some(SessionRecord {
            id: as_text(row.get_value(0)?)?,
            map: as_text(row.get_value(1)?)?,
            ai: parse_json(as_text(row.get_value(2)?)?)?,
            nations: match as_opt_text(row.get_value(3)?)? {
                Some(text) => Some(parse_json(text)?),
                None => None,
            },
            campaign: as_opt_i64(row.get_value(4)?)?,
            tick: as_i64(row.get_value(5)?)?,
            created_at: as_text(row.get_value(6)?)?,
            updated_at: as_text(row.get_value(7)?)?,
            data: match as_opt_text(row.get_value(8)?)? {
                Some(text) => Some(parse_object(text)?),
                None => None,
            },
        }))
    }

    /// Apply a world snapshot in place, or None when the session is absent.
    pub async fn sessions_snapshot(
        &self,
        id: &str,
        snap: SessionSnapshot,
    ) -> Result<Option<SessionRecord>, ApiError> {
        let Some(mut record) = self.sessions_get(id).await? else {
            return Ok(None);
        };
        record.tick = snap.tick;
        record.data = Some(snap.data);
        record.updated_at = utcnow();
        self.insert_session(&record).await?;
        Ok(Some(record))
    }

    pub async fn sessions_delete(&self, id: &str) -> Result<bool, ApiError> {
        let conn = self.database.connect()?;
        let changed = conn
            .execute(
                "DELETE FROM sessions WHERE id = ?",
                vec![Value::Text(id.to_string())],
            )
            .await?;
        Ok(changed > 0)
    }

    async fn insert_session(&self, record: &SessionRecord) -> Result<(), ApiError> {
        let conn = self.database.connect()?;
        conn.execute(
            "INSERT OR REPLACE INTO sessions \
             (id, map, ai, nations, campaign, tick, created_at, updated_at, data) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            vec![
                Value::Text(record.id.clone()),
                Value::Text(record.map.clone()),
                Value::Text(serde_json::to_string(&record.ai)?),
                match &record.nations {
                    Some(nations) => Value::Text(serde_json::to_string(nations)?),
                    None => Value::Null,
                },
                match record.campaign {
                    Some(campaign) => Value::Integer(campaign),
                    None => Value::Null,
                },
                Value::Integer(record.tick),
                Value::Text(record.created_at.clone()),
                Value::Text(record.updated_at.clone()),
                match &record.data {
                    Some(data) => Value::Text(serde_json::to_string(data)?),
                    None => Value::Null,
                },
            ],
        )
        .await?;
        Ok(())
    }
}

/// The `*.json` files directly under a directory, sorted by name (matches the
/// old glob order). Missing directories yield nothing.
fn json_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json") && path.is_file())
        .collect();
    paths.sort();
    paths
}

fn read_legacy<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

fn validate_legacy(id: &str, created_at: &str, updated_at: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("invalid id '{id}'"));
    }
    for stamp in [created_at, updated_at] {
        if DateTime::parse_from_rfc3339(stamp).is_err() {
            return Err(format!("invalid timestamp '{stamp}'"));
        }
    }
    Ok(())
}

fn io_invalid(err: ApiError) -> StoreError {
    StoreError::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        err.detail,
    ))
}

fn as_text(value: Value) -> Result<String, ApiError> {
    match value {
        Value::Text(text) => Ok(text),
        other => Err(column_error("TEXT", &other)),
    }
}

fn as_opt_text(value: Value) -> Result<Option<String>, ApiError> {
    match value {
        Value::Null => Ok(None),
        other => as_text(other).map(Some),
    }
}

fn as_i64(value: Value) -> Result<i64, ApiError> {
    match value {
        Value::Integer(int) => Ok(int),
        other => Err(column_error("INTEGER", &other)),
    }
}

fn as_opt_i64(value: Value) -> Result<Option<i64>, ApiError> {
    match value {
        Value::Null => Ok(None),
        other => as_i64(other).map(Some),
    }
}

fn column_error(expected: &str, got: &Value) -> ApiError {
    ApiError::internal(format!("stored column is not {expected}: {got:?}"))
}

fn parse_object(text: String) -> Result<JsonObject, ApiError> {
    Ok(serde_json::from_str(&text)?)
}

fn parse_json<T: serde::de::DeserializeOwned>(text: String) -> Result<T, ApiError> {
    Ok(serde_json::from_str(&text)?)
}
