//! Catalogue déclaratif des nodes — source de vérité unique pour la taxonomie
//! du graphe.
//!
//! Avant T5d, le même savoir était répliqué dans `validator.rs` (ports,
//! connexions, scope global/sub) et dans le frontend (`nodeParamSchema.ts`,
//! `connectionRules.ts` — params, catégories, descriptions, sets de types).
//! Deux langages, six miroirs — la cause directe des dérives corrigées en T2
//! (Scale x/y/z vs scalaire, engine→RadiusScale accepté côté UI mais rejeté
//! côté Rust).
//!
//! Désormais : un `NodeSpec` par `NodeType` — catégorie, scope, ports,
//! règle de ciblage (`Feeds`), params UI et défauts. Le validator dérive ses
//! décisions du spec, et le catalogue est sérialisé vers
//! `frontend/src/types/generated/nodeSpecs.json` (test `export_node_spec_catalog`,
//! lancé par `gen_contracts.sh`) — le frontend consomme ce fichier, plus aucune
//! liste maintenue à la main.

use serde::Serialize;
use std::sync::OnceLock;
use ts_rs::TS;

use crate::graph::NodeType;

/// Catégorie palette + rôle sémantique grossier du node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum NodeCategory {
    /// Objects/Duration/Output + sources du graph global (Input/MoveRef/Merge)
    Structural,
    MathEngine,
    PhysicsEngine,
    /// DrawSpline (source de données) + Evaluate/Trim/Offset (engines spline)
    Spline,
    Falloff,
    /// Modifiers compilables en sub-graph ET en post-process (Scope::Both)
    /// ou sub-only (PhaseShift)
    Modifier,
    /// Post-process du graph global — chaîne linéaire après merge
    PostProcess,
    /// Mix/Group/Sequence/Crossfade — composites binaires (A/B)
    Composite,
    /// BPM/AudioAmplitude/AudioSpectrum/OSCInput — engines réactifs
    Source,
    Plugin,
    /// Domaine signal (graph de modulation) — valeurs scalaires f64,
    /// PAS des trajectoires. Sources, ops et terminal SignalOut.
    Signal,
}

/// Contexte(s) de graphe où le node est autorisé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum NodeScope {
    /// Sub-graph uniquement (mouvement)
    SubOnly,
    /// Graph global uniquement (post-merge)
    GlobalOnly,
    /// Les deux contextes
    Both,
    /// Graph de modulation (signal) uniquement — domaine scalaire,
    /// incompatible avec les graphes de trajectoire.
    SignalOnly,
}

/// Règle de ciblage : quels types de nodes cet output peut alimenter.
/// Évaluée contre le `NodeSpec` de la cible — voir `NodeSpec::accepts_from`
/// et `NodeSpec::feeds_modifier`/`feeds_composite` pour les plugins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum Feeds {
    /// Pas de sortie (Output)
    Terminal,
    /// Objects/Duration → tout node exposant un port 'duration'
    /// (engines, physics, splines, falloffs, sources, Plugin)
    EngineInputs,
    /// Engine-like → Output + composites + modifiers
    /// (math engines, Evaluate/Trim/OffsetSpline, falloffs riches,
    /// sources BPM/Audio*, Plugin en tant que source)
    Trajectory,
    /// DrawSpline → cibles Trajectory + nodes avec port 'spline'
    SplineAndTrajectory,
    /// Physics → Output + composites (pas de modifiers)
    TrajectoryComposites,
    /// Falloffs limités → nodes `falloff_target` (Scale/Rotate/Offset)
    BasicModifiers,
    /// Modifier / post-process → Output + Mix/Group/Crossfade + modifiers +
    /// post-process (PAS Sequence — pas de sémantique A/B après une chaîne
    /// modifiée)
    ModifierChain,
    /// MoveRef → même cibles que ModifierChain. Variante distincte car un
    /// MoveRef peut alimenter un plugin *modifier* alors qu'un post-process
    /// ne le peut pas (feeds_modifier).
    MoveRefChain,
    /// Composite → Output + composites
    Composites,
    /// Input/Merge → modifiers + post-process + Output
    PostProcess,
    /// Signal graph → nodes `NodeCategory::Signal` uniquement (le domaine
    /// scalaire est hermétique : pas de connexion vers la trajectoire).
    Signal,
}

/// Type de paramètre UI — aligné sur `ParamType` frontend et les types de
/// `PluginParamDef` (même rendu générique dans NodeParamField).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ParamKind {
    Number,
    Boolean,
    String,
    Vec3,
    Enum,
    Text,
}

/// Déclaration d'un paramètre de node — miroir structuré de `ParamDef`
/// frontend, plus `default_json` (JSON littéral : `1.5`, `"xz"`, `[0,0,0]`).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ParamSpec {
    pub key: String,
    pub label: String,
    pub kind: ParamKind,
    pub options: Option<Vec<String>>,
    pub step: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Défaut à la création du node, encodé en JSON (parsed côté frontend).
    /// None → fallback par type (0/false/première option/…).
    pub default_json: Option<String>,
}

/// Spec déclarative d'un type de node.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct NodeSpec {
    pub node_type: NodeType,
    pub category: NodeCategory,
    pub scope: NodeScope,
    /// Règle de ciblage pour les edges sortants.
    pub feeds: Feeds,
    /// Ports d'entrée. Pour Plugin : superset — le `PluginKind` du manifeste
    /// restreint à runtime (engine → input+duration, modifier → input,
    /// composite → input/input_a/input_b).
    pub inputs: Vec<String>,
    /// Ports de sortie — `["output"]` ou `[]` pour le terminal.
    pub outputs: Vec<String>,
    /// Cible des falloffs limités (Directional/AudioAmplitude) — les
    /// transforms élémentaires Scale/Rotate/Offset uniquement.
    pub falloff_target: bool,
    /// Description courte — palette, hover, doc.
    pub description: String,
    /// Params éditables — schema du formulaire + valeurs initiales.
    pub params: Vec<ParamSpec>,
}

impl NodeSpec {
    /// La cible `to` peut-elle recevoir la sortie de ce node ?
    /// (Règle type-niveau ; l'arité et les ports sont vérifiés à part.)
    /// Pour `to == Plugin`, voir `feeds_modifier`/`feeds_composite` — le
    /// kind du manifeste décide.
    pub fn can_feed(&self, to: &NodeSpec) -> bool {
        let cat = |c| to.category == c;
        match self.feeds {
            Feeds::Terminal => false,
            Feeds::EngineInputs => to.inputs.iter().any(|p| p == "duration"),
            Feeds::Trajectory => {
                to.node_type == NodeType::Output
                    || cat(NodeCategory::Composite)
                    || cat(NodeCategory::Modifier)
            }
            Feeds::SplineAndTrajectory => {
                to.inputs.iter().any(|p| p == "spline") || self.can_feed_trajectory(to)
            }
            Feeds::TrajectoryComposites => {
                to.node_type == NodeType::Output || cat(NodeCategory::Composite)
            }
            Feeds::BasicModifiers => to.falloff_target,
            Feeds::ModifierChain | Feeds::MoveRefChain => {
                to.node_type == NodeType::Output
                    || cat(NodeCategory::Modifier)
                    || cat(NodeCategory::PostProcess)
                    || matches!(
                        to.node_type,
                        NodeType::Mix | NodeType::Group | NodeType::Crossfade
                    )
            }
            Feeds::Composites => to.node_type == NodeType::Output || cat(NodeCategory::Composite),
            Feeds::PostProcess => {
                to.node_type == NodeType::Output
                    || cat(NodeCategory::Modifier)
                    || cat(NodeCategory::PostProcess)
            }
            Feeds::Signal => cat(NodeCategory::Signal),
        }
    }

    fn can_feed_trajectory(&self, to: &NodeSpec) -> bool {
        to.node_type == NodeType::Output
            || to.category == NodeCategory::Composite
            || to.category == NodeCategory::Modifier
    }

    /// Ce node produit-il une trajectoire connectable à un plugin `modifier`
    /// natif ? (validator.rs::feeds_modifier historique)
    pub fn feeds_modifier(&self) -> bool {
        match self.feeds {
            Feeds::Trajectory | Feeds::SplineAndTrajectory | Feeds::BasicModifiers => true,
            // Les modifiers sub-graph oui, les post-process non.
            Feeds::ModifierChain => self.category == NodeCategory::Modifier,
            Feeds::MoveRefChain => true,
            _ => false,
        }
    }

    /// Ce node peut-il alimenter un plugin `composite` ?
    /// = feeds_modifier + physics + composites, moins les falloffs limités.
    pub fn feeds_composite(&self) -> bool {
        match self.feeds {
            Feeds::Trajectory | Feeds::SplineAndTrajectory => true,
            Feeds::TrajectoryComposites | Feeds::Composites => true,
            Feeds::ModifierChain => self.category == NodeCategory::Modifier,
            Feeds::MoveRefChain => true,
            _ => false,
        }
    }
}

// ─── Builders compacts pour la table ────────────────────────────────────────

fn p(key: &str, label: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec {
        key: key.into(),
        label: label.into(),
        kind,
        options: None,
        step: None,
        min: None,
        max: None,
        default_json: None,
    }
}
fn num(key: &str, label: &str) -> ParamSpec {
    p(key, label, ParamKind::Number)
}
fn ns(key: &str, label: &str, step: f64) -> ParamSpec {
    let mut d = num(key, label);
    d.step = Some(step);
    d
}
fn nmin(key: &str, label: &str, step: f64, min: f64) -> ParamSpec {
    let mut d = ns(key, label, step);
    d.min = Some(min);
    d
}
fn nrange(key: &str, label: &str, step: f64, min: f64, max: f64) -> ParamSpec {
    let mut d = nmin(key, label, step, min);
    d.max = Some(max);
    d
}
fn boolean(key: &str, label: &str) -> ParamSpec {
    p(key, label, ParamKind::Boolean)
}
fn txt(key: &str, label: &str) -> ParamSpec {
    p(key, label, ParamKind::Text)
}
fn v3(key: &str, label: &str) -> ParamSpec {
    p(key, label, ParamKind::Vec3)
}
fn enm(key: &str, label: &str, options: &[&str]) -> ParamSpec {
    let mut d = p(key, label, ParamKind::Enum);
    d.options = Some(options.iter().map(|s| s.to_string()).collect());
    d
}

/// Attache un défaut (JSON-encodé) à un ParamSpec — builder postfixe.
trait Def {
    fn d(self, v: impl Serialize) -> ParamSpec;
}
impl Def for ParamSpec {
    fn d(mut self, v: impl Serialize) -> ParamSpec {
        self.default_json = serde_json::to_string(&v).ok();
        self
    }
}

const PLANE: &[&str] = &["xz", "xy", "yz"];
const AXIS: &[&str] = &["x", "y", "z"];
const EASING: &[&str] = &["linear", "ease_in", "ease_out", "ease_in_out"];
const BAND: &[&str] = &["rms", "bass", "mid", "high"];

const TRAJ_IN: &[&str] = &["input", "duration"];
const SPLINE_IN: &[&str] = &["input", "duration", "spline"];
const MOD_IN: &[&str] = &["input"];
const COMP_IN: &[&str] = &["input", "input_a", "input_b"];
const NO_IN: &[&str] = &[];

/// Builder de la table — les 8 paramètres reflètent les champs du spec ;
/// une signature longue est le prix d'une déclaration compacte par node.
#[allow(clippy::too_many_arguments)]
fn spec(
    node_type: NodeType,
    category: NodeCategory,
    scope: NodeScope,
    feeds: Feeds,
    inputs: &[&str],
    falloff_target: bool,
    description: &str,
    params: Vec<ParamSpec>,
) -> NodeSpec {
    NodeSpec {
        node_type,
        category,
        scope,
        feeds,
        inputs: inputs.iter().map(|s| s.to_string()).collect(),
        outputs: if feeds == Feeds::Terminal {
            vec![]
        } else {
            vec!["output".to_string()]
        },
        falloff_target,
        description: description.into(),
        params,
    }
}

use Feeds as F;
use NodeCategory as C;
use NodeScope as S;

fn build_catalog() -> Vec<NodeSpec> {
    vec![
        // ── Structurels ──
        spec(
            NodeType::Objects, C::Structural, S::SubOnly, F::EngineInputs, NO_IN, false,
            "Defines the object/track count and their IDs. Required — graph source",
            vec![nrange("n_objects", "Count", 1.0, 1.0, 64.0).d(9)],
        ),
        spec(
            NodeType::Duration, C::Structural, S::SubOnly, F::EngineInputs, NO_IN, false,
            "Defines the cycle duration in seconds. Required — syncs engines",
            vec![nmin("duration", "Duration (s)", 0.1, 0.1).d(4.0)],
        ),
        spec(
            NodeType::Output, C::Structural, S::Both, F::Terminal, MOD_IN, false,
            "Graph terminal — sends positions via OSC to tracks. Required",
            vec![txt("track_range", "Track Range (ex: 0-11)").d("0-")],
        ),
        spec(
            NodeType::Input, C::Structural, S::GlobalOnly, F::PostProcess, NO_IN, false,
            "Global graph entry point — represents the merged positions of all moves",
            vec![],
        ),
        spec(
            NodeType::MoveRef, C::Structural, S::GlobalOnly, F::MoveRefChain, NO_IN, false,
            "Alternative source to Input — post-process filtered to one move's tracks via move_id",
            vec![txt("move_id", "Move ID").d("")],
        ),
        spec(
            NodeType::Merge, C::Structural, S::GlobalOnly, F::PostProcess, NO_IN, false,
            "Merge node — represents the MergeRuntime. Strategy: override/crossfade/blend/priority",
            vec![
                enm("strategy", "Strategy", &["override", "crossfade", "blend", "priority"]).d("override"),
                nmin("fade_duration", "Fade (s)", 0.1, 0.0).d(0.5),
            ],
        ),
        // ── Moteurs math ──
        spec(
            NodeType::Circular, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Circular motion — radius, speed, plane. The most used",
            vec![
                ns("radius", "Radius", 0.1).d(1.5),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::Elliptical, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Ellipse with independent axes (a≠b). For flattened orbits",
            vec![
                ns("a", "Semi-major", 0.1).d(0.8),
                ns("b", "Semi-minor", 0.1).d(0.4),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xy"),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::Spiral, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Spiral that expands/contracts over time",
            vec![
                ns("radius", "Radius", 0.1).d(0.5),
                ns("speed", "Speed", 0.1).d(1.0),
                ns("expansion", "Expansion", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
                boolean("phase_offset", "Phase Offset"),
            ],
        ),
        spec(
            NodeType::Lissajous, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Complex harmonic curves (a, b, delta). Ornamental figures",
            vec![
                ns("a", "A", 0.1).d(1.5),
                ns("b", "B", 0.1).d(1.5),
                ns("delta", "Delta", 0.01).d(std::f64::consts::FRAC_PI_2),
                ns("scale", "Scale", 0.1).d(1.0),
                boolean("phase_offset", "Phase Offset"),
            ],
        ),
        spec(
            NodeType::Figure8, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Lemniscate — horizontal figure-8",
            vec![
                ns("scale", "Scale", 0.1).d(1.5),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
                boolean("phase_offset", "Phase Offset"),
            ],
        ),
        spec(
            NodeType::Linear, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Linear interpolation between 2 points (start→end)",
            vec![
                v3("start", "Start").d([-1.0, 0.0, 0.0]),
                v3("end", "End").d([1.0, 0.0, 0.0]),
            ],
        ),
        spec(
            NodeType::Oscillation, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Sine wave on one axis (x/y/z). For vibrations",
            vec![
                ns("amplitude", "Amplitude", 0.1).d(1.5),
                ns("frequency", "Frequency", 0.1).d(1.0),
                enm("axis", "Axis", AXIS).d("y"),
                boolean("phase_offset", "Phase Offset"),
            ],
        ),
        spec(
            NodeType::Formation, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Static formations: circle, line, arc, grid. No motion",
            vec![
                enm("shape", "Shape", &["circle", "line", "arc", "grid"]).d("circle"),
                ns("radius", "Radius", 0.1).d(0.7),
                ns("rotate", "Rotate", 0.1).d(0.0),
                ns("elevation", "Elevation", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::PerlinNoise, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Perlin noise — smooth organic random motion",
            vec![
                ns("intensity", "Intensity", 0.1).d(0.5),
                ns("smoothness", "Smoothness", 0.1).d(0.5),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Converge, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Radial convergence to center with easing",
            vec![
                ns("start_radius", "Start Radius", 0.1).d(0.9),
                ns("end_radius", "End Radius", 0.1).d(0.0),
                enm("easing", "Easing", EASING).d("linear"),
            ],
        ),
        spec(
            NodeType::Pendulum, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Damped physical pendulum (length, gravity, damping)",
            vec![
                ns("length", "Length", 0.1).d(0.8),
                ns("gravity", "Gravity", 0.1).d(9.81),
                ns("initial_angle", "Initial Angle", 0.1).d(0.5),
                ns("damping", "Damping", 0.01).d(0.05),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::RoseCurve, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Polar rose r=cos(kθ) — n_petals flowers",
            vec![
                ns("radius", "Radius", 0.1).d(0.8),
                ns("n_petals", "Petals (k)", 1.0).d(4),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xy"),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::Helix, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "3D helix — radius, height, turns. For rises/falls",
            vec![
                ns("radius", "Radius", 0.1).d(0.7),
                ns("height", "Height", 0.1).d(1.6),
                ns("turns", "Turns", 0.5).d(3.0),
                ns("speed", "Speed", 0.1).d(1.0),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::Wave, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Travelling wave across objects (stadium wave). Each object oscillates with a delay",
            vec![
                ns("amplitude", "Amplitude", 0.1).d(1.0),
                ns("frequency", "Frequency", 0.1).d(1.0),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("axis", "Wave Axis", AXIS).d("y"),
                ns("spread", "Spread", 0.1).d(4.0),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::CustomTrajectory, C::MathEngine, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Custom x,y,z equations (cartesian/polar/spherical). For bespoke trajectories",
            vec![
                enm("coordinate_system", "Coord System", &["cartesian", "polar", "spherical"]).d("cartesian"),
                txt("equations", "Equations (x,y,z)").d("0.5,0.3,0.0"),
            ],
        ),
        // ── Moteurs physique ──
        spec(
            NodeType::Bouncing, C::PhysicsEngine, S::SubOnly, F::TrajectoryComposites, TRAJ_IN, false,
            "Physical bounces inside a container (sphere/box) with restitution",
            vec![
                enm("container", "Container", &["sphere", "box"]).d("sphere"),
                ns("container_size", "Container Size", 0.1).d(0.9),
                nrange("restitution", "Restitution", 0.01, 0.0, 1.0).d(0.95),
                ns("gravity", "Gravity", 0.1).d(0.0),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Spring, C::PhysicsEngine, S::SubOnly, F::TrajectoryComposites, TRAJ_IN, false,
            "Spring toward a target point (stiffness, damping)",
            vec![
                v3("target", "Target").d([0.0, 0.0, 0.0]),
                ns("stiffness", "Stiffness", 0.1).d(3.0),
                ns("damping_coef", "Damping", 0.1).d(0.5),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Follow, C::PhysicsEngine, S::SubOnly, F::TrajectoryComposites, TRAJ_IN, false,
            "Steering: follow/pursue/evade/orbit/arrive around a moving target (lookahead, ring, deceleration)",
            vec![
                enm("mode", "Mode", &["follow", "pursue", "evade", "orbit", "arrive"]).d("follow"),
                nmin("speed", "Max Speed", 0.1, 0.0).d(0.5),
                nmin("distance", "Distance / Ring Radius", 0.1, 0.0).d(0.3),
                nmin("lookahead", "Lookahead s (pursue/evade)", 0.1, 0.0).d(0.4),
                nmin("arrive_radius", "Arrive Radius", 0.1, 0.0).d(0.6),
                ns("orbit_speed", "Orbit Speed m/s", 0.1).d(0.3),
                ns("orbit_dir", "Orbit Dir (±1)", 1.0).d(1),
                nrange("responsiveness", "Responsiveness", 0.05, 0.0, 1.0).d(1.0),
                nmin("target_radius", "Target Radius", 0.1, 0.0).d(0.5),
                ns("target_speed", "Target Speed (rev/dur)", 0.1).d(1.0),
                ns("target_z", "Target Z", 0.1).d(0.0),
                nmin("init_radius", "Init Scatter", 0.1, 0.0).d(0.5),
                nmin("bounds", "Bounds (evade)", 0.1, 0.0).d(1.0),
                nmin("containment", "Containment", 0.1, 0.0).d(1.0),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Swarm, C::PhysicsEngine, S::SubOnly, F::TrajectoryComposites, TRAJ_IN, false,
            "Boids — flocking with separation/alignment/cohesion",
            vec![
                ns("separation", "Separation", 0.1).d(0.3),
                ns("alignment", "Alignment", 0.1).d(0.5),
                ns("cohesion", "Cohesion", 0.1).d(0.3),
                ns("neighbor_radius", "Neighbor Radius", 0.1).d(0.5),
                ns("max_speed", "Max Speed", 0.1).d(0.5),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Avoidance, C::PhysicsEngine, S::SubOnly, F::TrajectoryComposites, TRAJ_IN, false,
            "Inter-object repulsion — mutual avoidance",
            vec![
                ns("repulsion_radius", "Repulsion Radius", 0.1).d(0.4),
                ns("repulsion_strength", "Repulsion Strength", 0.1).d(2.0),
                ns("damping", "Damping", 0.01).d(0.95),
                ns("container_size", "Container Size", 0.1).d(0.9),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::VectorField, C::PhysicsEngine, S::SubOnly, F::TrajectoryComposites, TRAJ_IN, false,
            "Vector field (vortex/sink/source/flow/noise) — advected objects, inertial steering, organic perpetual motion",
            vec![
                enm("field", "Field", &["vortex", "sink", "source", "flow", "noise", "drawn"]).d("vortex"),
                txt("points", "Drawn Vectors x,y,vx,vy;...").d(""),
                nrange("idw_power", "IDW Power", 0.5, 0.5, 8.0).d(2.0),
                nmin("strength", "Strength", 0.1, 0.0).d(0.5),
                v3("center", "Center").d([0.0, 0.0, 0.0]),
                nmin("radius", "Radius", 0.1, 0.01).d(0.6),
                ns("swirl", "Swirl (spiral)", 0.1).d(0.0),
                v3("direction", "Direction (flow)").d([1.0, 0.0, 0.0]),
                nmin("noise_scale", "Noise Scale", 0.1, 0.01).d(1.5),
                nrange("wander", "Wander", 0.05, 0.0, 1.0).d(0.1),
                nrange("responsiveness", "Responsiveness", 0.05, 0.0, 1.0).d(0.1),
                nmin("max_speed", "Max Speed", 0.1, 0.0).d(1.0),
                nmin("bounds", "Bounds", 0.1, 0.01).d(1.0),
                nmin("containment", "Containment", 0.1, 0.0).d(0.5),
                enm("init", "Init Layout", &["circle", "line", "grid", "random", "point"]).d("circle"),
                nmin("init_radius", "Init Radius", 0.1, 0.0).d(0.6),
                ns("z_init", "Z Init", 0.1).d(0.0),
                ns("z_drift", "Z Drift", 0.05).d(0.0),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        // ── Splines ──
        spec(
            NodeType::DrawSpline, C::Spline, S::SubOnly, F::SplineAndTrajectory, TRAJ_IN, false,
            "Catmull-Rom spline from JSON control points. Source — no input",
            vec![txt("points", "Points").d("[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]")],
        ),
        spec(
            NodeType::EvaluateSpline, C::Spline, S::SubOnly, F::Trajectory, SPLINE_IN, false,
            "Uniform arc-length evaluation of a spline (constant speed)",
            vec![
                boolean("closed", "Closed").d(false),
                nrange("tension", "Tension", 0.1, 0.0, 1.0).d(0.5),
                ns("speed", "Speed", 0.1).d(1.0),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::TrimSpline, C::Spline, S::SubOnly, F::Trajectory, SPLINE_IN, false,
            "Extracts a spline segment (trim_start → trim_end, 0-1)",
            vec![
                txt("points", "Points").d("[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]"),
                nrange("trim_start", "Trim Start", 0.05, 0.0, 1.0).d(0.0),
                nrange("trim_end", "Trim End", 0.05, 0.0, 1.0).d(1.0),
                ns("speed", "Speed", 0.1).d(1.0),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::OffsetSpline, C::Spline, S::SubOnly, F::Trajectory, SPLINE_IN, false,
            "Spline with spatial offset (x,y,z)",
            vec![
                txt("points", "Points").d("[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]"),
                ns("offset_x", "Offset X", 0.1).d(0.0),
                ns("offset_y", "Offset Y", 0.1).d(0.0),
                ns("offset_z", "Offset Z", 0.1).d(0.0),
                ns("speed", "Speed", 0.1).d(1.0),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        // ── Falloffs ──
        spec(
            NodeType::TimeFalloff, C::Falloff, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Time envelope — influence that varies over time (start→end)",
            vec![
                ns("start_time", "Start Time", 0.1).d(0.0),
                ns("end_time", "End Time", 0.1).d(4.0),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("curve", "Curve", EASING).d("linear"),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::PointDistanceFalloff, C::Falloff, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Influence based on distance to a point (center, max_distance)",
            vec![
                v3("center", "Center").d([0.0, 0.0, 0.0]),
                ns("max_distance", "Max Distance", 0.1).d(1.0),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("curve", "Curve", EASING).d("linear"),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::DirectionalFalloff, C::Falloff, S::SubOnly, F::BasicModifiers, TRAJ_IN, false,
            "Directional influence — cone along a direction",
            vec![
                v3("direction", "Direction").d([0.0, 0.0, 1.0]),
                ns("max_distance", "Max Distance", 0.1).d(1.0),
                enm("curve", "Curve", EASING).d("linear"),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::AudioAmplitudeFalloff, C::Falloff, S::SubOnly, F::BasicModifiers, TRAJ_IN, false,
            "Modulation by audio amplitude (band, min, max)",
            vec![
                enm("band", "Band", BAND).d("rms"),
                ns("min_val", "Min", 0.01).d(0.0),
                ns("max_val", "Max", 0.01).d(1.0),
                enm("curve", "Curve", EASING).d("linear"),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        // ── Modifiers ──
        spec(
            NodeType::Scale, C::Modifier, S::Both, F::ModifierChain, MOD_IN, true,
            "Multiplies positions by (x, y, z). To resize",
            vec![
                ns("x", "Scale X", 0.1).d(1.0),
                ns("y", "Scale Y", 0.1).d(1.0),
                ns("z", "Scale Z", 0.1).d(1.0),
            ],
        ),
        spec(
            NodeType::Rotate, C::Modifier, S::Both, F::ModifierChain, MOD_IN, true,
            "Rotation around axes (angleX, angleY, angleZ in radians)",
            vec![
                ns("angleX", "Angle X (rad)", 0.1).d(0.0),
                ns("angleY", "Angle Y (rad)", 0.1).d(0.0),
                ns("angleZ", "Angle Z (rad)", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::Offset, C::Modifier, S::Both, F::ModifierChain, MOD_IN, true,
            "Translation (x, y, z). To shift a movement",
            vec![
                ns("x", "Offset X", 0.1).d(0.0),
                ns("y", "Offset Y", 0.1).d(0.0),
                ns("z", "Offset Z", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::PhaseShift, C::Modifier, S::SubOnly, F::ModifierChain, MOD_IN, false,
            "Per-object time offset — each object lags behind the previous",
            vec![nrange("shift", "Shift", 0.05, 0.0, 1.0).d(0.1)],
        ),
        spec(
            NodeType::Mirror, C::Modifier, S::Both, F::ModifierChain, MOD_IN, false,
            "Mirrors positions across a plane (xy/xz/yz). For symmetric setups",
            vec![
                enm("plane", "Mirror Plane", PLANE).d("xz"),
                ns("offset", "Plane Offset", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::Clamp, C::Modifier, S::Both, F::ModifierChain, MOD_IN, false,
            "Constrains positions inside a bounding box. Safety to stay within the venue",
            vec![
                ns("min_x", "Min X", 0.1).d(-5.0),
                ns("max_x", "Max X", 0.1).d(5.0),
                ns("min_y", "Min Y", 0.1).d(-5.0),
                ns("max_y", "Max Y", 0.1).d(5.0),
                ns("min_z", "Min Z", 0.1).d(-5.0),
                ns("max_z", "Max Z", 0.1).d(5.0),
            ],
        ),
        spec(
            NodeType::LFO, C::Modifier, S::Both, F::ModifierChain, MOD_IN, false,
            "Adds an oscillation (sine/triangle/square/saw) on an axis. Breathing effect",
            vec![
                enm("waveform", "Waveform", &["sine", "triangle", "square", "sawtooth"]).d("sine"),
                nmin("frequency", "Frequency (Hz)", 0.1, 0.01).d(0.5),
                ns("amplitude", "Amplitude", 0.1).d(0.3),
                enm("axis", "Axis", &["x", "y", "z", "all"]).d("y"),
                ns("phase", "Phase (rad)", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::Jitter, C::Modifier, S::Both, F::ModifierChain, MOD_IN, false,
            "Adds smooth organic noise. Makes a movement less mechanical",
            vec![
                nmin("intensity", "Intensity", 0.05, 0.0).d(0.2),
                nmin("frequency", "Frequency", 0.1, 0.1).d(2.0),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        // ── Post-process (graph global) ──
        spec(
            NodeType::RadiusScale, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Radial scaling relative to origin (radius_scale). Global — applied after merge",
            vec![nmin("radius_scale", "Radius Scale", 0.1, 0.0).d(1.0)],
        ),
        spec(
            NodeType::HeightOffset, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Post-merge vertical offset (height_offset). To adjust global height",
            vec![ns("height_offset", "Height Offset", 0.1).d(0.0)],
        ),
        spec(
            NodeType::PerTrackDepth, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Per-track depth — interpolate between origin and position. For depth mapping",
            vec![txt("depths", "Depths (JSON array)").d(serde_json::json!([]))],
        ),
        spec(
            NodeType::Barycenter, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Computes the origin from .hol track positions. Group center",
            vec![],
        ),
        spec(
            NodeType::AudioFalloff, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Modulates a param (scale/height) by audio amplitude. For musical reactivity",
            vec![
                nmin("amount", "Amount", 0.1, 0.0).d(1.0),
                enm("target", "Target", &["scale", "height"]).d("scale"),
            ],
        ),
        spec(
            NodeType::ManualPosition, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Manual position override — reads 3D drags. For hand positioning",
            vec![],
        ),
        spec(
            NodeType::Zone, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Spatial region (sphere/box) pulling object channels toward target values — gain/spread/etc. vary with position. Pass-through: doesn't modify positions",
            vec![
                enm("shape", "Shape", &["sphere", "box"]).d("sphere"),
                v3("center", "Center (sphere)").d([0.0, 0.0, 0.0]),
                nmin("radius", "Radius (sphere)", 0.1, 0.0).d(2.0),
                v3("min", "Min corner (box)").d([-1.0, -1.0, -1.0]),
                v3("max", "Max corner (box)").d([1.0, 1.0, 1.0]),
                nmin("falloff", "Falloff", 0.1, 0.0).d(0.5),
                txt("channels", "Channels (gain=0,spread=1)").d("gain=0"),
                txt("objects", "Objects (0,2,4 — empty = all)").d(""),
                boolean("enabled", "Enabled").d(true),
            ],
        ),
        spec(
            NodeType::Velocity, C::PostProcess, S::GlobalOnly, F::ModifierChain, MOD_IN, false,
            "Kinematic modulation — object speed/accel/jerk/angvel → spatial channel. angvel = angular speed °/s around the listener (perceptual bound). Pass-through: doesn't modify positions",
            vec![
                enm("source", "Source", &["speed", "acceleration", "jerk", "angvel"]).d("speed"),
                enm("channel", "Channel", &["gain", "spread", "distance", "presence", "yaw", "aperture", "lfe"]).d("spread"),
                ns("scale", "Scale", 0.01).d(0.1),
                ns("offset", "Offset", 0.01).d(0.0),
                txt("min", "Min (empty = −∞)").d(""),
                txt("max", "Max (empty = +∞)").d("1"),
                txt("object", "Object (empty = all)").d(""),
                v3("listener", "Listener (angvel)").d([0.0, 0.0, 0.0]),
            ],
        ),
        // ── Composites ──
        spec(
            NodeType::Mix, C::Composite, S::SubOnly, F::Composites, COMP_IN, false,
            "Linear blend between 2 trajectories (0=A, 1=B). To merge 2 movements",
            vec![nrange("blend", "Blend", 0.01, 0.0, 1.0).d(0.5)],
        ),
        spec(
            NodeType::Group, C::Composite, S::SubOnly, F::Composites, COMP_IN, false,
            "Splits N objects into 2 groups: A→[0..n/2], B→[n/2..n]. For different track assignments",
            vec![],
        ),
        spec(
            NodeType::Sequence, C::Composite, S::SubOnly, F::Composites, COMP_IN, false,
            "Chains 2 trajectories in time: A for its duration, then B. Hard cut",
            vec![],
        ),
        spec(
            NodeType::Crossfade, C::Composite, S::SubOnly, F::Composites, COMP_IN, false,
            "Chains A→B with a crossfade. Smoother than Sequence",
            vec![nmin("fade_duration", "Fade Duration (s)", 0.1, 0.1).d(1.0)],
        ),
        // ── Sources (engines réactifs) ──
        spec(
            NodeType::BPM, C::Source, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Circular motion synced to detected BPM",
            vec![
                nmin("bpm", "BPM", 1.0, 1.0).d(120),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::AudioAmplitude, C::Source, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Audio amplitude modulates a circle radius",
            vec![
                ns("amplitude", "Amplitude", 0.1).d(0.5),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("band", "Band", BAND).d("rms"),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::AudioSpectrum, C::Source, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Audio spectrum FFT band → position",
            vec![
                enm("band", "Band", BAND).d("bass"),
                ns("radius", "Radius", 0.1).d(1.0),
                nrange("n_bands", "Bands", 1.0, 1.0, 64.0).d(8),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::OSCInput, C::Source, S::SubOnly, F::Trajectory, TRAJ_IN, false,
            "Receives an OSC value (scalar→angle, array→XYZ) and converts it to a position",
            vec![
                txt("address", "OSC Address").d("/track/1/xyz"),
                ns("radius", "Radius", 0.1).d(1.0),
                ns("scale", "Scale", 0.1).d(1.0),
                ns("offset_x", "Offset X", 0.1).d(0.0),
                ns("offset_y", "Offset Y", 0.1).d(0.0),
                ns("offset_z", "Offset Z", 0.1).d(0.0),
            ],
        ),
        // ── Plugin WASM ──
        spec(
            NodeType::Plugin, C::Plugin, S::SubOnly, F::Trajectory,
            // Superset ABI v2 — le kind du manifeste restreint à runtime.
            &["input", "input_a", "input_b", "duration"], false,
            "External WASM plugin (.ssx bundle) — plugin_id selects the loaded plugin",
            vec![txt("plugin_id", "Plugin ID").d("")],
        ),
        // ── Signal graph — sources ──
        spec(
            NodeType::SignalConst, C::Signal, S::SignalOnly, F::Signal, NO_IN, false,
            "Constant value — bridge for manual live control (UI slider → param). Modulation graph source",
            vec![ns("value", "Value", 0.1).d(0.0)],
        ),
        spec(
            NodeType::SignalTime, C::Signal, S::SignalOnly, F::Signal, NO_IN, false,
            "Elapsed time as signal — ramps, periodic patterns. wrap=0 → unbounded",
            vec![
                ns("rate", "Rate", 0.1).d(1.0),
                nmin("wrap", "Wrap (s, 0=none)", 0.1, 0.0).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalLfo, C::Signal, S::SignalOnly, F::Signal, NO_IN, false,
            "Low-frequency oscillator — periodic macro animation. The classic 'animate anything'",
            vec![
                enm("waveform", "Waveform", &["sine", "triangle", "square", "sawtooth", "random"]).d("sine"),
                nmin("frequency", "Frequency (Hz)", 0.01, 0.0).d(0.5),
                ns("amplitude", "Amplitude", 0.1).d(1.0),
                ns("center", "Center", 0.1).d(0.0),
                ns("phase", "Phase (rad)", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalAudio, C::Signal, S::SignalOnly, F::Signal, NO_IN, false,
            "Audio source → signal (rms/bass/mid/high/bpm/FFT band). Music-reactive macros",
            vec![
                enm("band", "Band", &["rms", "bass", "mid", "high", "bpm", "spectrum"]).d("rms"),
                nrange("index", "FFT Band Index", 1.0, 0.0, 63.0).d(0),
                nrange("smoothing", "Smoothing", 0.01, 0.0, 0.95).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalOsc, C::Signal, S::SignalOnly, F::Signal, NO_IN, false,
            "Incoming OSC value → signal. External controllers (faders, sensors)",
            vec![
                txt("name", "Handler Name").d("fader1"),
                nrange("index", "Arg Index", 1.0, 0.0, 7.0).d(0),
            ],
        ),
        spec(
            NodeType::SignalRandom, C::Signal, S::SignalOnly, F::Signal, NO_IN, false,
            "Smooth deterministic noise — organic drift. Sum of incommensurate sinusoids",
            vec![
                nmin("rate", "Rate", 0.01, 0.0).d(0.5),
                ns("amplitude", "Amplitude", 0.1).d(1.0),
                ns("seed", "Seed", 1.0).d(1.0),
            ],
        ),
        // ── Signal graph — opérateurs ──
        spec(
            NodeType::SignalMath, C::Signal, S::SignalOnly, F::Signal, &["a", "b"], false,
            "Scalar math — combine signals. Unconnected inputs fall back to params a/b",
            vec![
                enm("op", "Op", &["add", "sub", "mul", "div", "min", "max", "pow", "abs", "neg", "mod"]).d("add"),
                ns("a", "A (fallback)", 0.1).d(0.0),
                ns("b", "B (fallback)", 0.1).d(1.0),
            ],
        ),
        spec(
            NodeType::SignalMap, C::Signal, S::SignalOnly, F::Signal, &["signal"], false,
            "Linear remap in_min..in_max → out_min..out_max, optional clamp",
            vec![
                ns("in_min", "In Min", 0.1).d(0.0),
                ns("in_max", "In Max", 0.1).d(1.0),
                ns("out_min", "Out Min", 0.1).d(0.0),
                ns("out_max", "Out Max", 0.1).d(1.0),
                boolean("clamp", "Clamp").d(true),
            ],
        ),
        spec(
            NodeType::SignalClamp, C::Signal, S::SignalOnly, F::Signal, &["signal"], false,
            "Clamp signal to [min, max] — safety bound before MacroOut",
            vec![
                ns("min", "Min", 0.1).d(0.0),
                ns("max", "Max", 0.1).d(1.0),
            ],
        ),
        spec(
            NodeType::SignalMix, C::Signal, S::SignalOnly, F::Signal, &["a", "b", "factor"], false,
            "Crossfade between two signals (factor 0=A, 1=B) — factor can itself be a signal",
            vec![nrange("factor", "Factor", 0.01, 0.0, 1.0).d(0.5)],
        ),
        // ── Signal graph — nodes à état ──
        spec(
            NodeType::SignalSlew, C::Signal, S::SignalOnly, F::Signal, &["signal"], false,
            "Slew rate limiter — asymmetric physical smoothing (rise/fall units per second)",
            vec![
                nmin("rise_rate", "Rise (u/s, 0=unlimited)", 0.1, 0.0).d(0.0),
                nmin("fall_rate", "Fall (u/s, 0=unlimited)", 0.1, 0.0).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalEnvelope, C::Signal, S::SignalOnly, F::Signal, &["signal"], false,
            "Envelope follower — retention factors per frame (small=fast, big=slow). Audio punch → macro",
            vec![
                nrange("attack", "Attack (low=fast)", 0.01, 0.0, 1.0).d(0.2),
                nrange("release", "Release (high=slow)", 0.01, 0.0, 1.0).d(0.95),
            ],
        ),
        spec(
            NodeType::SignalThreshold, C::Signal, S::SignalOnly, F::Signal, &["signal"], false,
            "Hysteresis gate — 1 above threshold, 0 below threshold-hysteresis, holds between",
            vec![
                ns("threshold", "Threshold", 0.01).d(0.5),
                nmin("hysteresis", "Hysteresis", 0.01, 0.0).d(0.05),
            ],
        ),
        // ── Signal graph — terminal ──
        spec(
            NodeType::SignalOut, C::Signal, S::SignalOnly, F::Terminal, &["signal"], false,
            "Modulation sink — writes signal as ADDITIVE delta on a macro (panel/OSC/cue base + delta). speed only applies per-move",
            vec![
                enm("target", "Target", &["speed", "scale", "shift_x", "shift_y", "shift_z", "yaw", "pitch", "roll", "radius_scale", "height_offset"]).d("yaw"),
                ns("amount", "Amount", 0.1).d(1.0),
            ],
        ),
    ]
}

static CATALOG: OnceLock<Vec<NodeSpec>> = OnceLock::new();

/// Le catalogue complet — 55 specs, construit une fois.
pub fn all_node_specs() -> &'static [NodeSpec] {
    CATALOG.get_or_init(build_catalog)
}

/// Spec d'un type de node — ne peut pas manquer (couvercle exhaustif de
/// l'enum garanti par le test `catalog_covers_all_node_types`).
pub fn node_spec(node_type: &NodeType) -> &'static NodeSpec {
    all_node_specs()
        .iter()
        .find(|s| &s.node_type == node_type)
        .unwrap_or_else(|| unreachable!("missing NodeSpec for {node_type:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exporte le catalogue vers le frontend — lancé par `gen_contracts.sh`
    /// via `cargo test --lib export` (TS_RS_EXPORT_DIR pointe vers
    /// `frontend/src/types/generated/`).
    #[test]
    fn export_node_spec_catalog() {
        let dir = std::env::var("TS_RS_EXPORT_DIR").unwrap_or_else(|_| "../bindings".into());
        std::fs::create_dir_all(&dir).expect("create export dir");
        let json =
            serde_json::to_string_pretty(all_node_specs()).expect("node spec catalog serializes");
        std::fs::write(format!("{dir}/nodeSpecs.json"), format!("{json}\n"))
            .expect("write nodeSpecs.json");
    }

    #[test]
    fn catalog_covers_all_node_types() {
        // Toute valeur de NodeType doit avoir un spec — si un variant est
        // ajouté à l'enum sans spec, node_spec() paniquerait à runtime.
        let json = serde_json::to_string(&NodeType::Output).unwrap();
        let _ = json;
        // Exhaustivité par énumération des 60 variants connus.
        const ALL: &[NodeType] = &[
            NodeType::Objects,
            NodeType::Duration,
            NodeType::Output,
            NodeType::Group,
            NodeType::Mix,
            NodeType::Sequence,
            NodeType::Crossfade,
            NodeType::Input,
            NodeType::Circular,
            NodeType::Elliptical,
            NodeType::Spiral,
            NodeType::Lissajous,
            NodeType::Figure8,
            NodeType::Linear,
            NodeType::Oscillation,
            NodeType::PerlinNoise,
            NodeType::Formation,
            NodeType::Converge,
            NodeType::Pendulum,
            NodeType::RoseCurve,
            NodeType::Helix,
            NodeType::CustomTrajectory,
            NodeType::Wave,
            NodeType::Bouncing,
            NodeType::Spring,
            NodeType::Follow,
            NodeType::Swarm,
            NodeType::Avoidance,
            NodeType::VectorField,
            NodeType::DrawSpline,
            NodeType::EvaluateSpline,
            NodeType::TrimSpline,
            NodeType::OffsetSpline,
            NodeType::TimeFalloff,
            NodeType::PointDistanceFalloff,
            NodeType::DirectionalFalloff,
            NodeType::AudioAmplitudeFalloff,
            NodeType::Scale,
            NodeType::Rotate,
            NodeType::Offset,
            NodeType::PhaseShift,
            NodeType::Mirror,
            NodeType::Clamp,
            NodeType::LFO,
            NodeType::Jitter,
            NodeType::RadiusScale,
            NodeType::HeightOffset,
            NodeType::PerTrackDepth,
            NodeType::Barycenter,
            NodeType::AudioFalloff,
            NodeType::ManualPosition,
            NodeType::MoveRef,
            NodeType::Merge,
            NodeType::Zone,
            NodeType::Velocity,
            NodeType::BPM,
            NodeType::AudioAmplitude,
            NodeType::AudioSpectrum,
            NodeType::OSCInput,
            NodeType::Plugin,
            NodeType::SignalConst,
            NodeType::SignalTime,
            NodeType::SignalLfo,
            NodeType::SignalAudio,
            NodeType::SignalOsc,
            NodeType::SignalRandom,
            NodeType::SignalMath,
            NodeType::SignalMap,
            NodeType::SignalClamp,
            NodeType::SignalMix,
            NodeType::SignalSlew,
            NodeType::SignalEnvelope,
            NodeType::SignalThreshold,
            NodeType::SignalOut,
        ];
        assert_eq!(all_node_specs().len(), ALL.len(), "catalog size drift");
        for t in ALL {
            let s = node_spec(t);
            assert_eq!(&s.node_type, t);
        }
    }

    /// Parité avec l'ancienne matrice de connexion — les invariants critiques
    /// du validator historique.
    #[test]
    fn connection_matrix_invariants() {
        let s = node_spec;
        // Output est terminal
        assert!(s(&NodeType::Output).outputs.is_empty());
        // Engine → modifier ok, engine → post-process non (drift frontend historique)
        assert!(s(&NodeType::Circular).can_feed(s(&NodeType::Scale)));
        assert!(!s(&NodeType::Circular).can_feed(s(&NodeType::RadiusScale)));
        // Engine → Sequence ok ; modifier → Sequence non
        assert!(s(&NodeType::Circular).can_feed(s(&NodeType::Sequence)));
        assert!(!s(&NodeType::Scale).can_feed(s(&NodeType::Sequence)));
        // Physics → composites mais pas modifiers
        assert!(s(&NodeType::Swarm).can_feed(s(&NodeType::Mix)));
        assert!(!s(&NodeType::Swarm).can_feed(s(&NodeType::Scale)));
        // Falloffs limités → Scale/Rotate/Offset uniquement
        assert!(s(&NodeType::DirectionalFalloff).can_feed(s(&NodeType::Rotate)));
        assert!(!s(&NodeType::DirectionalFalloff).can_feed(s(&NodeType::Clamp)));
        // Objects/Duration → tout ce qui a un port duration
        assert!(s(&NodeType::Objects).can_feed(s(&NodeType::Circular)));
        assert!(s(&NodeType::Objects).can_feed(s(&NodeType::DrawSpline)));
        assert!(!s(&NodeType::Objects).can_feed(s(&NodeType::Scale)));
        // DrawSpline → spline nodes + cibles trajectory
        assert!(s(&NodeType::DrawSpline).can_feed(s(&NodeType::EvaluateSpline)));
        assert!(s(&NodeType::DrawSpline).can_feed(s(&NodeType::Output)));
        // Input/Merge → post-process + Output, pas de composites
        assert!(s(&NodeType::Input).can_feed(s(&NodeType::RadiusScale)));
        assert!(s(&NodeType::Input).can_feed(s(&NodeType::Output)));
        assert!(!s(&NodeType::Input).can_feed(s(&NodeType::Mix)));
        // MoveRef → post-process + Output + Mix/Group/Crossfade
        assert!(s(&NodeType::MoveRef).can_feed(s(&NodeType::Mix)));
        assert!(!s(&NodeType::MoveRef).can_feed(s(&NodeType::Sequence)));
        // feeds_modifier / feeds_composite (cibles Plugin)
        assert!(s(&NodeType::Circular).feeds_modifier());
        assert!(s(&NodeType::MoveRef).feeds_modifier());
        assert!(!s(&NodeType::RadiusScale).feeds_modifier());
        assert!(!s(&NodeType::Swarm).feeds_modifier());
        assert!(s(&NodeType::Swarm).feeds_composite());
        assert!(!s(&NodeType::DirectionalFalloff).feeds_composite());
        assert!(!s(&NodeType::Objects).feeds_composite());
    }

    /// Les ports du catalogue reproduisent l'ancien has_input_port.
    #[test]
    fn port_tables_invariants() {
        let ports = |t: NodeType| node_spec(&t).inputs.clone();
        assert!(ports(NodeType::Objects).is_empty());
        assert_eq!(ports(NodeType::Circular), ["input", "duration"]);
        assert_eq!(
            ports(NodeType::EvaluateSpline),
            ["input", "duration", "spline"]
        );
        assert_eq!(ports(NodeType::Scale), ["input"]);
        assert_eq!(ports(NodeType::Mix), ["input", "input_a", "input_b"]);
        // Scope
        assert_eq!(
            node_spec(&NodeType::RadiusScale).scope,
            NodeScope::GlobalOnly
        );
        assert_eq!(node_spec(&NodeType::Scale).scope, NodeScope::Both);
        assert_eq!(node_spec(&NodeType::Circular).scope, NodeScope::SubOnly);
    }
}
