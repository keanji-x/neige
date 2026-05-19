//! Plugin host — M2 territory. For now just a placeholder so `AppState`
//! can carry an `Arc<PluginHost>` and routes/plugins.rs compiles.

pub struct PluginHost {
    // future:
    //   processes: Mutex<HashMap<PluginId, PluginProcess>>,
    //   manifests: Mutex<HashMap<PluginId, Manifest>>,
    //   mcp_gateway: ...
}

impl PluginHost {
    pub fn new_stub() -> Self {
        Self {}
    }
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new_stub()
    }
}
