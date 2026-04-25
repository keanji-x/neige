//! Per-session connection to a chat-mode `neige-session-daemon`.
//!
//! Mirrors `super::SessionClient` (terminal mode) but speaks the chat-mode
//! protocol: the wire payload is one serialized `NeigeEvent` JSON string per
//! frame instead of raw PTY bytes. Reattach replay logic is the same — each
//! event gets a monotonic seq, history caps at a few MiB, and a (re)attach
//! returns `UpToDate / Delta / Snapshot` so the WS handler can prime a
//! browser without re-running the model.
//!
//! Independent of `SessionClient` to avoid coupling the two modes' types;
//! the duplication is small and the modes evolve at different cadences.
//!
//! Wire shape on the broadcast channel: `(seq: u64, json: String)`. The
//! `String` is already serialized so the WS handler can pass it through as
//! a Text frame body without re-encoding.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::net::UnixStream;
use tokio::sync::{broadcast, mpsc};
use tracing::debug;
use uuid::Uuid;

use neige_session::{ClientMsg, DaemonMsg, read_frame, write_frame};

use super::daemon;

/// Total byte cap on the seq-tagged history. Conservative — most chat
/// sessions stay well under this.
const HISTORY_MAX_BYTES: usize = 2 * 1024 * 1024;

struct History {
    events: VecDeque<(u64, String)>,
    total_bytes: usize,
    max_bytes: usize,
    next_seq: u64,
}

impl History {
    fn new(max_bytes: usize) -> Self {
        Self {
            events: VecDeque::new(),
            total_bytes: 0,
            max_bytes,
            // Reserve seq=0 as the "snapshot / reset" marker so the WS
            // protocol can disambiguate first-attach from a delta.
            next_seq: 1,
        }
    }

    fn append(&mut self, json: String) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.total_bytes += json.len();
        self.events.push_back((seq, json));
        while self.total_bytes > self.max_bytes && self.events.len() > 1 {
            let (_, dropped) = self.events.pop_front().unwrap();
            self.total_bytes -= dropped.len();
        }
        seq
    }

    fn earliest_seq(&self) -> Option<u64> {
        self.events.front().map(|(s, _)| *s)
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.saturating_sub(1)
    }

    fn since(&self, after_seq: u64) -> Vec<(u64, String)> {
        self.events
            .iter()
            .filter(|(s, _)| *s > after_seq)
            .cloned()
            .collect()
    }

    fn full_snapshot(&self) -> Vec<String> {
        self.events.iter().map(|(_, j)| j.clone()).collect()
    }
}

/// Result of `ChatSessionClient::attach`.
pub enum AttachResult {
    UpToDate {
        latest_seq: u64,
    },
    Delta {
        events: Vec<(u64, String)>,
        latest_seq: u64,
    },
    Snapshot {
        events: Vec<String>,
        latest_seq: u64,
    },
}

/// Chat-mode peer of `SessionClient`.
pub struct ChatSessionClient {
    ctrl_tx: mpsc::UnboundedSender<ClientMsg>,
    pub tx: broadcast::Sender<(u64, String)>,
    history: Arc<Mutex<History>>,
    alive: Arc<std::sync::atomic::AtomicBool>,
}

impl ChatSessionClient {
    /// Connect to the chat daemon for `id`, send the initial Attach, read
    /// the HelloChat replay, and spawn reader/writer tasks.
    pub async fn connect(id: &Uuid) -> Result<Self, String> {
        let sock_path = daemon::sock_path(id);
        let stream = UnixStream::connect(&sock_path)
            .await
            .map_err(|e| format!("connect daemon socket {sock_path:?}: {e}"))?;
        let (mut rd, mut wr) = stream.into_split();

        // cols/rows are placeholder in chat mode — daemon ignores them.
        write_frame(&mut wr, &ClientMsg::Attach { cols: 80, rows: 24 })
            .await
            .map_err(|e| format!("send Attach: {e}"))?;
        let first: DaemonMsg = read_frame(&mut rd)
            .await
            .map_err(|e| format!("read HelloChat: {e}"))?;
        let replay = match first {
            DaemonMsg::HelloChat { replay } => replay,
            other => return Err(format!("expected HelloChat, got {other:?}")),
        };

        let history = Arc::new(Mutex::new(History::new(HISTORY_MAX_BYTES)));
        let (tx, _) = broadcast::channel::<(u64, String)>(256);
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));

        // Seed history with the replay so WS clients that attach before the
        // first live event still get to see the conversation so far.
        if !replay.is_empty()
            && let Ok(mut h) = history.lock()
        {
            for json in replay {
                let seq = h.append(json.clone());
                let _ = tx.send((seq, json));
            }
        }

        // Reader: socket → (history + broadcast).
        let history_r = history.clone();
        let tx_r = tx.clone();
        let alive_r = alive.clone();
        tokio::spawn(async move {
            let mut rd = rd;
            loop {
                let msg: DaemonMsg = match read_frame(&mut rd).await {
                    Ok(m) => m,
                    Err(_) => break,
                };
                match msg {
                    DaemonMsg::ChatEvent { json } => {
                        if let Ok(mut h) = history_r.lock() {
                            let seq = h.append(json.clone());
                            let _ = tx_r.send((seq, json));
                        }
                    }
                    DaemonMsg::ChildExited { code } => {
                        tracing::info!(?code, "chat daemon reported child exit");
                        break;
                    }
                    // Frames we don't expect in chat mode — ignore quietly.
                    DaemonMsg::Hello { .. }
                    | DaemonMsg::HelloChat { .. }
                    | DaemonMsg::Stdout(_) => {}
                }
            }
            alive_r.store(false, std::sync::atomic::Ordering::Relaxed);
        });

        // Writer: mpsc → socket.
        let (ctrl_tx, mut ctrl_rx) = mpsc::unbounded_channel::<ClientMsg>();
        let alive_w = alive.clone();
        tokio::spawn(async move {
            while let Some(msg) = ctrl_rx.recv().await {
                if write_frame(&mut wr, &msg).await.is_err() {
                    break;
                }
            }
            alive_w.store(false, std::sync::atomic::Ordering::Relaxed);
        });

        debug!("chat daemon attached: sock={sock_path:?}");

        Ok(Self {
            ctrl_tx,
            tx,
            history,
            alive,
        })
    }

    /// Clone of the control-channel sender; the WS handler pushes
    /// `ClientMsg::ChatUserMessage` frames through it.
    pub fn ctrl_sender(&self) -> mpsc::UnboundedSender<ClientMsg> {
        self.ctrl_tx.clone()
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Atomically subscribe to live events and prepare the catch-up payload
    /// for a (re)attaching WS client. See `super::SessionClient::attach` for
    /// the rationale on holding the history lock across both operations.
    pub fn attach(
        &self,
        last_seq: Option<u64>,
    ) -> (broadcast::Receiver<(u64, String)>, AttachResult) {
        let history = self.history.lock().expect("history poisoned");
        let rx = self.tx.subscribe();
        let latest = history.latest_seq();
        let earliest = history.earliest_seq();

        let result = match (last_seq, earliest) {
            (Some(ls), _) if ls >= latest => AttachResult::UpToDate { latest_seq: latest },
            (Some(ls), Some(earliest_seq)) if ls >= earliest_seq.saturating_sub(1) => {
                AttachResult::Delta {
                    events: history.since(ls),
                    latest_seq: latest,
                }
            }
            _ => AttachResult::Snapshot {
                events: history.full_snapshot(),
                latest_seq: latest,
            },
        };

        (rx, result)
    }
}
