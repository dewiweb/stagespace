//! HOLOFLOW Core Server
//! 
//! Main entry point for the Rust OSC engine.
//! Runs the IPC server to communicate with Python API.

use holoflow_core::ipc::IpcServer;
use holoflow_core::error::Result;
use log::info;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logger
    env_logger::init();
    
    info!("Starting HOLOFLOW Core Server...");
    
    // IPC socket path
    let socket_path = "/tmp/holoflow.sock";
    
    // Create and run IPC server
    let server = IpcServer::new(socket_path).await?;
    server.run().await?;
    
    Ok(())
}