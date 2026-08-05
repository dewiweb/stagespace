//! Buffer partagé entre un worker thread et le merge thread.
//!
//! Le worker écrit ses positions calculées dans le buffer à chaque frame.
//! Le merge thread lit tous les buffers à chaque frame pour faire le merge.
//!
//! Lock simple (Mutex) — suffisant pour ~200 bytes (9 objets × 24 bytes).
//! Pas de double buffer front/back : la copie prend des nanoses.

use std::sync::Mutex;

/// Position d'un objet : (object_index, position 3D)
pub type IndexedPosition = (usize, nalgebra::Vector3<f64>);

/// Buffer de positions partagé entre un worker et le merge thread.
///
/// Le worker appelle `write()` à chaque frame avec ses positions calculées.
/// Le merge thread appelle `read()` pour récupérer la dernière frame.
///
/// Si le worker n'a pas encore écrit (ou a crashé), `read()` retourne un Vec vide.
pub struct PositionBuffer {
    positions: Mutex<Vec<IndexedPosition>>,
    /// Frame count — incrémenté à chaque write. Permet au merge thread
    /// de détecter si un worker est stale (pas de write depuis > 2 frames).
    frame_count: Mutex<u64>,
}

impl PositionBuffer {
    pub fn new() -> Self {
        PositionBuffer {
            positions: Mutex::new(Vec::new()),
            frame_count: Mutex::new(0),
        }
    }

    /// Écrit les positions dans le buffer (appelé par le worker thread).
    pub fn write(&self, positions: Vec<IndexedPosition>) {
        let mut guard = self.positions.lock().unwrap_or_else(|e| e.into_inner());
        *guard = positions;
        let mut fc = self.frame_count.lock().unwrap_or_else(|e| e.into_inner());
        *fc += 1;
    }

    /// Lit les positions les plus récentes (appelé par le merge thread).
    /// Retourne un Vec vide si le worker n'a jamais écrit.
    pub fn read(&self) -> Vec<IndexedPosition> {
        let guard = self.positions.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    }

    /// Retourne le nombre de frames écrites depuis la création du buffer.
    /// Utilisé par le merge thread pour détecter les workers stale/crashés.
    pub fn frame_count(&self) -> u64 {
        *self.frame_count.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Efface les positions (remet à zéro).
    pub fn clear(&self) {
        let mut guard = self.positions.lock().unwrap_or_else(|e| e.into_inner());
        guard.clear();
    }
}

impl Default for PositionBuffer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn test_write_read() {
        let buf = PositionBuffer::new();
        let positions = vec![
            (0, nalgebra::Vector3::new(1.0, 2.0, 3.0)),
            (1, nalgebra::Vector3::new(4.0, 5.0, 6.0)),
        ];
        buf.write(positions.clone());
        let read = buf.read();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].0, 0);
        assert!((read[0].1.x - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_empty_buffer() {
        let buf = PositionBuffer::new();
        let read = buf.read();
        assert!(read.is_empty());
    }

    #[test]
    fn test_frame_count() {
        let buf = PositionBuffer::new();
        assert_eq!(buf.frame_count(), 0);
        buf.write(vec![(0, nalgebra::Vector3::zeros())]);
        assert_eq!(buf.frame_count(), 1);
        buf.write(vec![(0, nalgebra::Vector3::zeros())]);
        assert_eq!(buf.frame_count(), 2);
    }

    #[test]
    fn test_concurrent_write_read() {
        let buf = Arc::new(PositionBuffer::new());
        let buf_writer = buf.clone();
        let buf_reader = buf.clone();

        let writer = thread::spawn(move || {
            for i in 0..100 {
                buf_writer.write(vec![
                    (0, nalgebra::Vector3::new(i as f64, 0.0, 0.0)),
                ]);
            }
        });

        let reader = thread::spawn(move || {
            let mut last_x = -1.0;
            for _ in 0..100 {
                let positions = buf_reader.read();
                if !positions.is_empty() {
                    last_x = positions[0].1.x;
                }
            }
            last_x
        });

        writer.join().unwrap();
        let last_x = reader.join().unwrap();
        // Le reader doit avoir lu au moins une frame non-vide
        assert!(last_x >= 0.0);
    }

    #[test]
    fn test_clear() {
        let buf = PositionBuffer::new();
        buf.write(vec![(0, nalgebra::Vector3::new(1.0, 0.0, 0.0))]);
        assert!(!buf.read().is_empty());
        buf.clear();
        assert!(buf.read().is_empty());
    }
}
