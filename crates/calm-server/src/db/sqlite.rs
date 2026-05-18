//! SQLite-backed `Repo` implementation. **Owned by Track A.**
//!
//! ## Track A's job
//!
//! Implement every method on the `Repo` trait against a `sqlx::SqlitePool`.
//! Open the pool in [`SqlxRepo::open`], run the bundled migrations from
//! `migrations/` (the `sqlx::migrate!` macro is the easiest path), and
//! make all CRUD operations transactional where they touch multiple rows.
//!
//! ### Notes for the implementer
//!
//! * The connection URL is `sqlite://<path>?mode=rwc` for an on-disk DB, or
//!   `sqlite::memory:` for in-memory (handy for tests).
//! * Cascades on `coves → waves → cards` are declared in `0001_init.sql` via
//!   `ON DELETE CASCADE`; you still need `PRAGMA foreign_keys=ON` per-connection.
//! * `sort` is a fractional index. "Append to end" = `(SELECT COALESCE(MAX(sort),0)+1 FROM ...)`.
//! * `overlay_upsert` should use `INSERT ... ON CONFLICT(plugin_id, entity_kind, entity_id, kind) DO UPDATE`.
//! * Refer to `MockRepo` in `super` for the exact semantics each method must replicate.

use crate::error::Result;
use crate::model::*;
use async_trait::async_trait;

use super::Repo;

#[allow(dead_code)]
pub struct SqlxRepo {
    // pool: sqlx::SqlitePool,
}

impl SqlxRepo {
    /// Open / create the SQLite DB at `url`, run pending migrations, enable
    /// foreign keys, and return a ready-to-use pool wrapper.
    pub async fn open(_url: &str) -> Result<Self> {
        todo!("track A: open SqlitePool, run sqlx::migrate!(), PRAGMA foreign_keys=ON")
    }
}

#[async_trait]
impl Repo for SqlxRepo {
    // ---- coves
    async fn coves_list(&self) -> Result<Vec<Cove>> {
        todo!("track A")
    }
    async fn cove_get(&self, _id: &str) -> Result<Option<Cove>> {
        todo!("track A")
    }
    async fn cove_create(&self, _p: NewCove) -> Result<Cove> {
        todo!("track A")
    }
    async fn cove_update(&self, _id: &str, _p: CovePatch) -> Result<Cove> {
        todo!("track A")
    }
    async fn cove_delete(&self, _id: &str) -> Result<()> {
        todo!("track A")
    }

    // ---- waves
    async fn waves_by_cove(&self, _cove_id: &str) -> Result<Vec<Wave>> {
        todo!("track A")
    }
    async fn wave_get(&self, _id: &str) -> Result<Option<Wave>> {
        todo!("track A")
    }
    async fn wave_detail(&self, _id: &str) -> Result<Option<WaveDetail>> {
        todo!("track A")
    }
    async fn wave_create(&self, _p: NewWave) -> Result<Wave> {
        todo!("track A")
    }
    async fn wave_update(&self, _id: &str, _p: WavePatch) -> Result<Wave> {
        todo!("track A")
    }
    async fn wave_delete(&self, _id: &str) -> Result<()> {
        todo!("track A")
    }

    // ---- cards
    async fn cards_by_wave(&self, _wave_id: &str) -> Result<Vec<Card>> {
        todo!("track A")
    }
    async fn card_get(&self, _id: &str) -> Result<Option<Card>> {
        todo!("track A")
    }
    async fn card_create(&self, _p: NewCard) -> Result<Card> {
        todo!("track A")
    }
    async fn card_update(&self, _id: &str, _p: CardPatch) -> Result<Card> {
        todo!("track A")
    }
    async fn card_delete(&self, _id: &str) -> Result<()> {
        todo!("track A")
    }

    // ---- overlays
    async fn overlay_upsert(&self, _p: NewOverlay) -> Result<Overlay> {
        todo!("track A")
    }
    async fn overlay_delete(
        &self,
        _plugin_id: &str,
        _entity_kind: &str,
        _entity_id: &str,
        _kind: &str,
    ) -> Result<()> {
        todo!("track A")
    }
    async fn overlays_for(&self, _entity_kind: &str, _entity_id: &str) -> Result<Vec<Overlay>> {
        todo!("track A")
    }

    // ---- terminals
    async fn terminal_create(&self, _p: NewTerminal) -> Result<Terminal> {
        todo!("track A")
    }
    async fn terminal_get(&self, _id: &str) -> Result<Option<Terminal>> {
        todo!("track A")
    }
    async fn terminal_get_by_card(&self, _card_id: &str) -> Result<Option<Terminal>> {
        todo!("track A")
    }
    async fn terminal_set_handle(&self, _id: &str, _handle: Option<&str>) -> Result<()> {
        todo!("track A")
    }

    // ---- plugins
    async fn plugins_list(&self) -> Result<Vec<Plugin>> {
        todo!("track A")
    }
}
