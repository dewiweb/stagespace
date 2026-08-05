/// Découverte réseau — cherche holophonix.local et autres dispositifs OSC sur le réseau
#[tauri::command]
pub async fn discover_osc_targets() -> Result<Vec<serde_json::Value>, String> {
    let mut targets: Vec<serde_json::Value> = Vec::new();

    // 1. Résoudre holophonix.local via DNS
    if let Ok(ips) = std::net::ToSocketAddrs::to_socket_addrs(&"holophonix.local:0") {
        for addr in ips {
            targets.push(serde_json::json!({
                "name": "Holophonix (mDNS)",
                "host": addr.ip().to_string(),
                "port": 8000,
                "profile": "holophonix",
                "source": "mdns",
            }));
        }
    }

    // 2. Scanner les ports OSC communs sur le réseau local
    // Port 8000 (Holophonix), 9000 (IEM), 7000 (Generic)
    let common_ports = [
        (8000u16, "Holophonix"),
        (9000, "IEM MultiEncoder"),
        (7000, "Generic"),
    ];

    // Récupérer notre IP pour déterminer le subnet
    let local_ip = get_local_ip()
        .unwrap_or_else(|| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));

    if let std::net::IpAddr::V4(ipv4) = local_ip {
        let octets = ipv4.octets();
        // Scanner /24 (last octet 1-254) — timeout court
        for last in 1u8..=254u8 {
            let target_ip = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], last);
            for (port, name) in common_ports {
                let addr_str = format!("{target_ip}:{port}");
                if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                    // TCP connect avec timeout très court (non-bloquant)
                    if let Ok(socket) = std::net::TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(50),
                    ) {
                        drop(socket);
                        let profile = if port == 8000 {
                            "holophonix"
                        } else if port == 9000 {
                            "iem"
                        } else {
                            "generic"
                        };
                        targets.push(serde_json::json!({
                            "name": format!("{} @ {}", name, target_ip),
                            "host": target_ip,
                            "port": port,
                            "profile": profile,
                            "source": "scan",
                        }));
                    }
                }
            }
        }
    }

    // 3. Toujours inclure localhost
    targets.push(serde_json::json!({
        "name": "Localhost (this machine)",
        "host": "127.0.0.1",
        "port": 8000,
        "profile": "holophonix",
        "source": "local",
    }));

    Ok(targets)
}

/// Récupère l'IP locale de la machine
pub fn get_local_ip() -> Option<std::net::IpAddr> {
    // Utiliser un UDP socket "connect" vers une IP publique pour déterminer l'interface
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}
