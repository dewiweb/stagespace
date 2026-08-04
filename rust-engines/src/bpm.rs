use serde::{Deserialize, Serialize};

/// Données BPM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BPMData {
    pub bpm: f64,
    pub confidence: f64,
    pub last_beat_time: f64,
}

/// BPM Tracker - détection de tempo via MIDI clock ou tap
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BpmTracker {
    pub bpm: Option<f64>,
    pub clock_count: u32,
    pub last_clock_time: f64,
    pub tap_times: Vec<f64>,
}

impl BpmTracker {
    pub fn new() -> Self {
        BpmTracker {
            bpm: None,
            clock_count: 0,
            last_clock_time: 0.0,
            tap_times: Vec::new(),
        }
    }

    /// Met à jour le BPM à partir du MIDI clock (24 clocks per quarter note)
    pub fn update_clock(&mut self, current_time: f64) -> Option<f64> {
        if self.last_clock_time > 0.0 {
            let delta = current_time - self.last_clock_time;
            if delta > 0.0 {
                // 24 clocks per quarter note
                let bpm = 60.0 / (delta * 24.0);
                self.bpm = Some(bpm);
            }
        }
        self.last_clock_time = current_time;
        self.clock_count += 1;
        self.bpm
    }

    /// Définit le BPM manuellement
    pub fn set_bpm(&mut self, bpm: f64) {
        self.bpm = Some(bpm);
    }

    /// Retourne le BPM actuel
    pub fn get_bpm(&self) -> Option<f64> {
        self.bpm
    }

    /// Enregistre un tap pour calculer le BPM
    pub fn tap(&mut self, current_time: f64) -> Option<f64> {
        self.tap_times.push(current_time);
        
        // Garder seulement les 10 derniers taps
        if self.tap_times.len() > 10 {
            self.tap_times.remove(0);
        }

        if self.tap_times.len() >= 2 {
            // Calculer l'intervalle moyen entre les taps
            let mut intervals: Vec<f64> = Vec::new();
            for i in 1..self.tap_times.len() {
                intervals.push(self.tap_times[i] - self.tap_times[i - 1]);
            }
            
            let avg_interval: f64 = intervals.iter().sum::<f64>() / intervals.len() as f64;
            let bpm = 60.0 / avg_interval;
            self.bpm = Some(bpm);
            self.bpm
        } else {
            None
        }
    }

    /// Reset le tracker
    pub fn reset(&mut self) {
        self.bpm = None;
        self.clock_count = 0;
        self.last_clock_time = 0.0;
        self.tap_times.clear();
    }
}

impl Default for BpmTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bpm_tracker_new() {
        let tracker = BpmTracker::new();
        assert!(tracker.bpm.is_none());
        assert_eq!(tracker.clock_count, 0);
    }

    #[test]
    fn test_set_bpm() {
        let mut tracker = BpmTracker::new();
        tracker.set_bpm(120.0);
        assert_eq!(tracker.get_bpm(), Some(120.0));
    }

    #[test]
    fn test_update_clock() {
        let mut tracker = BpmTracker::new();
        // Simuler 24 clocks par seconde à 60 BPM (1 beat/sec)
        let clock_interval = 1.0 / 24.0; // ~0.0417s entre clocks
        for i in 0..25 {
            tracker.update_clock(i as f64 * clock_interval);
        }
        let bpm = tracker.get_bpm();
        assert!(bpm.is_some());
        assert!((bpm.unwrap() - 60.0).abs() < 5.0); // Tolérance de 5 BPM
    }

    #[test]
    fn test_tap() {
        let mut tracker = BpmTracker::new();
        // Simuler 4 taps à 120 BPM (0.5s entre taps)
        tracker.tap(0.0);
        tracker.tap(0.5);
        let bpm = tracker.tap(1.0);
        assert!(bpm.is_some());
        assert!((bpm.unwrap() - 120.0).abs() < 5.0);
    }

    #[test]
    fn test_reset() {
        let mut tracker = BpmTracker::new();
        tracker.set_bpm(120.0);
        tracker.reset();
        assert!(tracker.bpm.is_none());
        assert_eq!(tracker.clock_count, 0);
        assert!(tracker.tap_times.is_empty());
    }
}
