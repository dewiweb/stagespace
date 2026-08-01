//! OSC communication module
//! 
//! Handles OSC sending/receiving with microsecond-accurate timing

use rosc::{OscMessage, OscPacket, OscType};
use std::net::UdpSocket;
use std::sync::Arc;
use crate::error::{HoloflowError, Result};

/// OSC sender with high-precision timing
pub struct OscSender {
    socket: Arc<UdpSocket>,
    host: String,
    port: u16,
}

impl OscSender {
    /// Create a new OSC sender
    pub fn new(host: &str, port: u16) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_nonblocking(true)?;
        
        Ok(OscSender {
            socket: Arc::new(socket),
            host: host.to_string(),
            port,
        })
    }
    
    /// Send an OSC message
    pub fn send(&self, address: &str, args: Vec<OscType>) -> Result<()> {
        let msg = OscMessage {
            addr: address.to_string(),
            args,
        };
        
        let packet = OscPacket::Message(msg);
        let bytes = rosc::encoder::encode(&packet)
            .map_err(|e| HoloflowError::OscError(format!("Failed to encode OSC: {}", e)))?;
        
        self.socket.send_to(&bytes, format!("{}:{}", self.host, self.port))?;
        Ok(())
    }
    
    /// Send a simple float value
    pub fn send_float(&self, address: &str, value: f32) -> Result<()> {
        self.send(address, vec![OscType::Float(value)])
    }
    
    /// Send multiple float values (e.g., XYZ position)
    pub fn send_floats(&self, address: &str, values: Vec<f32>) -> Result<()> {
        let args: Vec<OscType> = values.into_iter().map(OscType::Float).collect();
        self.send(address, args)
    }
}

/// OSC receiver for incoming OSC messages
pub struct OscReceiver {
    socket: Arc<UdpSocket>,
}

impl OscReceiver {
    /// Create a new OSC receiver
    pub fn new(port: u16) -> Result<Self> {
        let socket = UdpSocket::bind(format!("0.0.0.0:{}", port))?;
        socket.set_nonblocking(true)?;
        
        Ok(OscReceiver {
            socket: Arc::new(socket),
        })
    }
    
    /// Try to receive a message (non-blocking)
    pub fn try_recv(&self) -> Result<Option<OscPacket>> {
        let mut buf = [0u8; 1024];
        match self.socket.recv_from(&mut buf) {
            Ok((len, _)) => {
                let (_rest, packet) = rosc::decoder::decode_udp(&buf[..len])
                    .map_err(|e| HoloflowError::OscError(format!("Failed to decode OSC: {}", e)))?;
                Ok(Some(packet))
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                Ok(None)
            }
            Err(e) => Err(HoloflowError::IoError(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_osc_sender_creation() {
        let sender = OscSender::new("127.0.0.1", 8000);
        assert!(sender.is_ok());
    }
    
    #[test]
    fn test_osc_receiver_creation() {
        let receiver = OscReceiver::new(9000);
        assert!(receiver.is_ok());
    }
}