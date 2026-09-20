/// Découverte réseau — cherche holophonix.local et autres dispositifs OSC sur le réseau.
///
/// Note : OSC est UDP — le scan TCP ci-dessous ne peut PAS détecter un vrai
/// listener OSC (Holophonix n'écoute pas en TCP:8000). Il ne trouve que des
/// services TCP tiers sur les ports courants — best-effort. La résolution
/// mDNS (holophonix.local) est le seul signal fiable ici.
#[tauri::command]
pub async fn discover_osc_targets() -> Result<Vec<serde_json::Value>, String> {
    // Le scan (DNS + 254 IPs × 3 ports TCP) peut prendre des dizaines de
    // secondes — ne jamais tourner inline sur l'executor async.
    tauri::async_runtime::spawn_blocking(discover_osc_targets_blocking)
        .await
        .map_err(|e| format!("Discovery task failed: {e}"))?
}

fn discover_osc_targets_blocking() -> Result<Vec<serde_json::Value>, String> {
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

    // 2. Scan TCP best-effort des ports courants — PARALLÈLE (8 workers ×
    // timeout 50ms ≈ ~2s au lieu de ~38s séquentiels).
    let common_ports = [
        (8000u16, "Holophonix"),
        (9000, "IEM MultiEncoder"),
        (7000, "Generic"),
    ];

    let local_ip = get_local_ip()
        .unwrap_or_else(|| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));

    if let std::net::IpAddr::V4(ipv4) = local_ip {
        let octets = ipv4.octets();
        let found = std::sync::Mutex::new(Vec::new());
        let next = std::sync::atomic::AtomicU16::new(1);

        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| loop {
                    let last = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if !(1..=254).contains(&last) {
                        break;
                    }
                    let target_ip = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], last);
                    for (port, name) in common_ports {
                        let addr_str = format!("{target_ip}:{port}");
                        if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
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
                                found.lock().unwrap_or_else(|e| e.into_inner()).push(
                                    serde_json::json!({
                                        "name": format!("{} @ {}", name, target_ip),
                                        "host": target_ip,
                                        "port": port,
                                        "profile": profile,
                                        "source": "scan",
                                    }),
                                );
                            }
                        }
                    }
                });
            }
        });
        targets.extend(found.into_inner().unwrap_or_default());
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
