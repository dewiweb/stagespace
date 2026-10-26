//! Catalogue déclaratif des nodes — source de vérité unique pour la taxonomie
//! du graphe.
//!
//! # Modèle de ports
//!
//! Chaque node déclare des **ports typés** (`PortDef { name, port_type,
//! required }`). La règle de connexion est unique et déterministe :
//!
//! ```text
//! edge valide ⟺ out_port.port_type == in_port.port_type
//! ```
//!
//! Cinq types de donnée circulent sur les edges :
//!
//! - `ObjectSet` — définition du set de tracks (compte + IDs). Produit
//!   uniquement par `Objects`, consommé par les engines/sources/falloffs.
//! - `Duration` — durée du cycle en secondes. Produit uniquement par
//!   `Duration`, consommé par les mêmes nodes.
//! - `Positions` — flux de positions. Dans un sub-graph : trajectoire
//!   `f(t, i) → Vec3` (engines, modifiers, composites, physics, falloffs,
//!   splines évaluées). Dans le graphe global : positions mergées
//!   (Merge/MoveRef → chaîne post-process → Output). Le même type
//!   couvre les deux contextes car ils ne peuvent jamais coexister dans
//!   un graphe (voir `NodeScope`).
//! - `Spline` — géométrie spline brute. Produit par `DrawSpline`,
//!   consommé par le port `spline` des nodes Evaluate/Trim/Offset.
//! - `Signal` — scalaire `f64`, domaine modulation (nodes `Signal*`).
//!
//! Les seules autres règles structurelles sont dérivées des ports :
//! - `required` — le port doit recevoir au moins un edge.
//! - arité — un port d'entrée n'accepte qu'un seul edge (fan-out autorisé
//!   côté sortie).
//! - contexte — `NodeScope` restreint le(s) graphe(s) où le node vit.
//!
//! Le validator dérive ses décisions de cette table, et le catalogue est
//! sérialisé vers `frontend/src/types/generated/nodeSpecs.json` (test
//! `export_node_spec_catalog`, lancé par `gen_contracts.sh`) — le frontend
//! consomme ce fichier, plus aucune liste maintenue à la main.

use serde::Serialize;
use std::sync::OnceLock;
use ts_rs::TS;

use crate::graph::NodeType;

/// Type de donnée transportée par un port — détermine la validité d'un edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum PortType {
    /// Set de tracks (compte + IDs) — produit par `Objects` uniquement.
    ObjectSet,
    /// Durée du cycle en secondes — produite par `Duration` uniquement.
    Duration,
    /// Flux de positions — trajectoire (sub-graph) ou positions mergées
    /// (graphe global). Même type : les deux contextes sont disjoints.
    Positions,
    /// Géométrie spline brute — produite par `DrawSpline`.
    Spline,
    /// Scalaire `f64` — domaine signal/modulation.
    Signal,
}

/// Déclaration d'un port (entrée ou sortie).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PortDef {
    /// Identifiant stable du port — stocké dans `Edge::from_port`/`to_port`.
    pub name: String,
    /// Type de donnée transportée.
    pub port_type: PortType,
    /// `true` → le port doit recevoir au moins un edge (validation).
    /// `false` → port optionnel (fallback param/défaut à l'évaluation).
    pub required: bool,
    /// Label court affiché à côté du handle dans l'éditeur.
    pub label: String,
}

/// Catégorie palette + rôle sémantique grossier du node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum NodeCategory {
    /// Objects/Duration/Output + sources du graph global (Merge/MoveRef)
    Structural,
    MathEngine,
    PhysicsEngine,
    /// DrawSpline (source de données) + Evaluate/Trim/Offset (engines spline)
    Spline,
    Envelope,
    /// Modifiers compilables en sub-graph ET en post-process (Scope::Both)
    /// ou sub-only (PhaseShift)
    Modifier,
    /// Post-process du graph global — chaîne linéaire après merge
    PostProcess,
    /// Mix/Group/Sequence/Crossfade — composites binaires (a/b)
    Composite,
    /// BPM/AudioAmplitude/AudioSpectrum/OSCInput — engines réactifs
    Source,
    Plugin,
    /// Domaine signal (graph de modulation) — valeurs scalaires f64,
    /// PAS des trajectoires. Sources, ops et terminal SignalOut.
    Signal,
}

/// Comment `object_index` (`i`) est réparti entre les objets produits —
/// le contrat de distribution d'un engine. Sans cette métadonnée, un
/// engine qui ignore `i` produit N objets superposés de façon invisible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum ObjectDistribution {
    /// Chaque objet sur une phase angulaire distincte (`2π·i/n`).
    Angular,
    /// Chaque objet sur un point distinct du chemin (`i/n` paramétrique).
    Parametric,
    /// Agent indépendant — i indexe des agents dans une simulation
    /// (engines physiques, cache interne).
    Agent,
    /// `i` est ignoré — tous les objets partagent la même position.
    Broadcast,
    /// Pas de notion de distribution (modifier, composite, structural,
    /// signal — la donnée d'entrée détermine la répartition).
    None,
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
    /// Ports d'entrée. Pour `Plugin` : superset ABI — le `PluginKind` du
    /// manifeste restreint à runtime (engine → objects+duration,
    /// modifier → in, composite → a+b).
    pub inputs: Vec<PortDef>,
    /// Ports de sortie — un seul `out` typé en général ; DrawSpline en a
    /// deux (`out` Positions + `spline` Spline) ; le terminal n'en a pas.
    pub outputs: Vec<PortDef>,
    /// Description courte — palette, hover, doc.
    pub description: String,
    /// Comment `i` est réparti entre les objets produits — hint UI et
    /// documentation du contrat implicite de chaque engine.
    pub object_distribution: ObjectDistribution,
    /// L'engine dépend-il de l'ordre d'évaluation (cache d'état interne :
    /// agents, simulations) ? Un modifier temporel (PhaseShift, Delay)
    /// sur un upstream stateful reset sa simulation — l'UI peut avertir.
    pub stateful: bool,
    /// Params éditables — schema du formulaire + valeurs initiales.
    pub params: Vec<ParamSpec>,
}

impl NodeSpec {
    /// Port d'entrée par nom.
    pub fn input_port(&self, name: &str) -> Option<&PortDef> {
        self.inputs.iter().find(|p| p.name == name)
    }

    /// Port de sortie par nom.
    pub fn output_port(&self, name: &str) -> Option<&PortDef> {
        self.outputs.iter().find(|p| p.name == name)
    }

    /// Le node a-t-il un port d'entrée du type donné ?
    /// Utilisé par le validator : "a un port `ObjectSet`" = engine-like qui
    /// a besoin d'un set de tracks résoluble.
    pub fn has_input_type(&self, port_type: PortType) -> bool {
        self.inputs.iter().any(|p| p.port_type == port_type)
    }

    /// Le node produit-il un flux Positions ? (engine-like, modifier,
    /// composite, post-process, source globale…)
    pub fn produces_positions(&self) -> bool {
        self.outputs
            .iter()
            .any(|p| p.port_type == PortType::Positions)
    }

    /// Résout les ports d'entrée effectifs d'un node Plugin selon le kind
    /// de son manifeste — `None` pour les nodes natifs.
    ///
    /// ABI v2 :
    /// - engine → `objects` (ObjectSet) + `duration` (Duration), sortie `out`
    /// - modifier → `in` (Positions, required), sortie `out`
    /// - composite → `a` + `b` (Positions, required), sortie `out`
    /// - kind inconnu → superset déclaré dans le catalogue.
    pub fn plugin_input_ports(kind: Option<crate::plugins::PluginKind>) -> Vec<PortDef> {
        use crate::plugins::PluginKind as K;
        match kind {
            Some(K::Engine) => vec![
                port("objects", PortType::ObjectSet),
                port("duration", PortType::Duration),
            ],
            Some(K::Modifier) => vec![req("in", PortType::Positions)],
            Some(K::Composite) => {
                vec![req("a", PortType::Positions), req("b", PortType::Positions)]
            }
            None => vec![
                port("objects", PortType::ObjectSet),
                port("duration", PortType::Duration),
                port("in", PortType::Positions),
                port("a", PortType::Positions),
                port("b", PortType::Positions),
            ],
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

// ─── Builders de ports ──────────────────────────────────────────────────────

/// Port optionnel.
fn port(name: &str, port_type: PortType) -> PortDef {
    PortDef {
        name: name.into(),
        port_type,
        required: false,
        label: name.into(),
    }
}

/// Port requis — le validator exige au moins un edge connecté.
fn req(name: &str, port_type: PortType) -> PortDef {
    PortDef {
        required: true,
        ..port(name, port_type)
    }
}

/// Entrées carriers d'un engine-like : set de tracks + durée de cycle.
/// Optionnels au niveau port — `n_objects`/`duration` ont des fallbacks
/// (param propre, propagation upstream, défaut) ; le validator garde la
/// règle graphe-niveau "Objects + Duration connectés si engines présents".
fn engine_in() -> Vec<PortDef> {
    vec![
        port("objects", PortType::ObjectSet),
        port("duration", PortType::Duration),
    ]
}

/// Entrées d'un engine spline : carriers + géométrie spline.
/// `spline_required` — EvaluateSpline n'a pas de fallback `points` param,
/// Trim/Offset si (leur champ points sert de fallback).
fn spline_in(spline_required: bool) -> Vec<PortDef> {
    let mut v = engine_in();
    v.push(if spline_required {
        req("spline", PortType::Spline)
    } else {
        port("spline", PortType::Spline)
    });
    v
}

/// Entrée position unique requise — modifiers, post-process, Output.
fn pos_in() -> Vec<PortDef> {
    vec![req("in", PortType::Positions)]
}

/// Entrées binaires ordonnées — Mix/Group/Sequence/Crossfade.
fn comp_in() -> Vec<PortDef> {
    vec![req("a", PortType::Positions), req("b", PortType::Positions)]
}

/// Sortie position standard — un seul port `out`.
fn out_pos() -> Vec<PortDef> {
    vec![port("out", PortType::Positions)]
}

/// Sortie signal standard — domaine modulation.
fn out_sig() -> Vec<PortDef> {
    vec![port("out", PortType::Signal)]
}

const PLANE: &[&str] = &["xz", "xy", "yz"];
const AXIS: &[&str] = &["x", "y", "z"];
const EASING: &[&str] = &["linear", "ease_in", "ease_out", "ease_in_out"];
const BAND: &[&str] = &["rms", "bass", "mid", "high"];

/// Builder de la table — les 7 paramètres reflètent les champs du spec ;
/// une signature longue est le prix d'une déclaration compacte par node.
fn spec(
    node_type: NodeType,
    category: NodeCategory,
    scope: NodeScope,
    inputs: Vec<PortDef>,
    outputs: Vec<PortDef>,
    description: &str,
    params: Vec<ParamSpec>,
) -> NodeSpec {
    NodeSpec {
        node_type,
        category,
        scope,
        inputs,
        outputs,
        description: description.into(),
        object_distribution: ObjectDistribution::None,
        stateful: false,
        params,
    }
}

/// Distribution de `i` par type de node — renseignée en une seule table,
/// annotée sur le catalogue à la construction.
fn object_distribution_of(t: &NodeType) -> ObjectDistribution {
    use ObjectDistribution as D;
    match t {
        NodeType::Circular
        | NodeType::Elliptical
        | NodeType::Spiral
        | NodeType::Lissajous
        | NodeType::Figure8
        | NodeType::Oscillation
        | NodeType::RoseCurve
        | NodeType::Helix
        | NodeType::Wave
        | NodeType::Converge
        | NodeType::OSCInput => D::Angular,
        NodeType::DrawSpline
        | NodeType::EvaluateSpline
        | NodeType::TrimSpline
        | NodeType::OffsetSpline
        | NodeType::Formation
        | NodeType::AudioSpectrum
        | NodeType::DirectionalFalloff
        | NodeType::CustomTrajectory => D::Parametric,
        NodeType::Bouncing
        | NodeType::Spring
        | NodeType::Follow
        | NodeType::Swarm
        | NodeType::Avoidance
        | NodeType::Pendulum
        | NodeType::VectorField
        | NodeType::PerlinNoise => D::Agent,
        NodeType::Linear
        | NodeType::BPM
        | NodeType::AudioAmplitude
        | NodeType::TimeFalloff
        | NodeType::PointDistanceFalloff
        | NodeType::AudioAmplitudeFalloff => D::Broadcast,
        _ => D::None,
    }
}

/// Engines à état interne (`Mutex<cache>` de simulation) — l'ordre des
/// évaluations change le résultat ; un warp temporel en amont force un
/// reset + re-simulation.
fn is_stateful(t: &NodeType) -> bool {
    matches!(
        t,
        NodeType::Bouncing
            | NodeType::Spring
            | NodeType::Follow
            | NodeType::Swarm
            | NodeType::Avoidance
            | NodeType::Pendulum
            | NodeType::VectorField
    )
}

/// Renseigne les champs dérivés du `node_type` — table unique plutôt que
/// de dupliquer les métadonnées dans les 74 littéraux du catalogue.
fn annotate(mut s: NodeSpec) -> NodeSpec {
    s.object_distribution = object_distribution_of(&s.node_type);
    s.stateful = is_stateful(&s.node_type);
    s
}

use NodeCategory as C;
use NodeScope as S;

fn build_catalog() -> Vec<NodeSpec> {
    let catalog = vec![
        // ── Structurels ──
        spec(
            NodeType::Objects, C::Structural, S::SubOnly, vec![],
            vec![port("objects", PortType::ObjectSet)],
            "Defines the object/track count and their IDs. Required — graph source",
            vec![
                nrange("n_objects", "Count", 1.0, 1.0, 64.0).d(9),
                p("track_ids", "Track IDs", ParamKind::Text).d(""),
            ],
        ),
        spec(
            NodeType::Duration, C::Structural, S::SubOnly, vec![],
            vec![port("duration", PortType::Duration)],
            "Defines the cycle duration in seconds. Required — syncs engines",
            vec![nmin("duration", "Duration (s)", 0.1, 0.1).d(4.0)],
        ),
        spec(
            NodeType::Output, C::Structural, S::Both, pos_in(), vec![],
            "Graph terminal — sends positions via OSC to tracks. Required",
            vec![txt("track_range", "Track Range (ex: 0-11)").d("0-")],
        ),
        spec(
            NodeType::MoveRef, C::Structural, S::GlobalOnly, vec![], out_pos(),
            "Alternative source to Merge — post-process filtered to one move's tracks via move_id",
            vec![txt("move_id", "Move ID").d("")],
        ),
        spec(
            NodeType::Merge, C::Structural, S::GlobalOnly, vec![], out_pos(),
            "Merge node — represents the MergeRuntime. Strategy: override/crossfade/blend/priority",
            vec![
                enm("strategy", "Strategy", &["override", "crossfade", "blend", "priority"]).d("override"),
            ],
        ),
        // ── Moteurs math ──
        spec(
            NodeType::Circular, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Circular motion — radius, speed, plane. The most used",
            vec![
                ns("radius", "Radius", 0.1).d(1.5),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::Elliptical, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Spiral, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Lissajous, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Figure8, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Lemniscate — horizontal figure-8",
            vec![
                ns("scale", "Scale", 0.1).d(1.5),
                ns("speed", "Speed", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
                boolean("phase_offset", "Phase Offset"),
            ],
        ),
        spec(
            NodeType::Linear, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Linear interpolation between 2 points (start→end)",
            vec![
                v3("start", "Start").d([-1.0, 0.0, 0.0]),
                v3("end", "End").d([1.0, 0.0, 0.0]),
            ],
        ),
        spec(
            NodeType::Oscillation, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Sine wave on one axis (x/y/z). For vibrations",
            vec![
                ns("amplitude", "Amplitude", 0.1).d(1.5),
                ns("frequency", "Frequency", 0.1).d(1.0),
                enm("axis", "Axis", AXIS).d("y"),
                boolean("phase_offset", "Phase Offset"),
            ],
        ),
        spec(
            NodeType::Formation, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Static formations: circle, line, arc, grid. No motion",
            vec![
                enm("shape", "Shape", &["circle", "line", "arc", "grid", "sphere", "triangle", "hexagon"]).d("circle"),
                ns("radius", "Radius", 0.1).d(0.7),
                ns("rotate", "Rotate", 0.1).d(0.0),
                ns("elevation", "Elevation", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::PerlinNoise, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Perlin noise — smooth organic random motion",
            vec![
                ns("intensity", "Intensity", 0.1).d(0.5),
                ns("smoothness", "Smoothness", 0.1).d(0.5),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Converge, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Radial convergence to center with easing",
            vec![
                ns("start_radius", "Start Radius", 0.1).d(0.9),
                ns("end_radius", "End Radius", 0.1).d(0.0),
                enm("easing", "Easing", EASING).d("linear"),
            ],
        ),
        spec(
            NodeType::Pendulum, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::RoseCurve, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Helix, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Wave, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::CustomTrajectory, C::MathEngine, S::SubOnly, engine_in(), out_pos(),
            "Custom x,y,z equations (cartesian/polar/spherical). For bespoke trajectories",
            vec![
                enm("coordinate_system", "Coord System", &["cartesian", "polar", "spherical"]).d("cartesian"),
                txt("equations", "Equations (x,y,z)").d("0.5,0.3,0.0"),
            ],
        ),
        // ── Moteurs physique ──
        spec(
            NodeType::Bouncing, C::PhysicsEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Spring, C::PhysicsEngine, S::SubOnly, engine_in(), out_pos(),
            "Spring toward a target point (stiffness, damping)",
            vec![
                v3("target", "Target").d([0.0, 0.0, 0.0]),
                ns("stiffness", "Stiffness", 0.1).d(3.0),
                ns("damping_coef", "Damping", 0.1).d(0.5),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::Follow, C::PhysicsEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Swarm, C::PhysicsEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Avoidance, C::PhysicsEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::VectorField, C::PhysicsEngine, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::DrawSpline, C::Spline, S::SubOnly, engine_in(),
            // Deux sorties : la trajectoire évaluée par défaut (out) et la
            // géométrie brute (spline) pour Evaluate/Trim/Offset.
            vec![
                port("out", PortType::Positions),
                port("spline", PortType::Spline),
            ],
            "Catmull-Rom spline from JSON control points. Source — no input",
            vec![txt("points", "Points").d("[[-0.5,0,0],[0,0.5,0],[0.5,0,0]]")],
        ),
        spec(
            NodeType::EvaluateSpline, C::Spline, S::SubOnly, spline_in(true), out_pos(),
            "Uniform arc-length evaluation of a spline (constant speed)",
            vec![
                boolean("closed", "Closed").d(false),
                nrange("tension", "Tension", 0.1, 0.0, 1.0).d(0.5),
                ns("speed", "Speed", 0.1).d(1.0),
                boolean("phase_offset", "Phase Offset").d(true),
            ],
        ),
        spec(
            NodeType::TrimSpline, C::Spline, S::SubOnly, spline_in(false), out_pos(),
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
            NodeType::OffsetSpline, C::Spline, S::SubOnly, spline_in(false), out_pos(),
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
            NodeType::TimeFalloff, C::Envelope, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::PointDistanceFalloff, C::Envelope, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::DirectionalFalloff, C::Envelope, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::AudioAmplitudeFalloff, C::Envelope, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Scale, C::Modifier, S::Both, pos_in(), out_pos(),
            "Multiplies positions by (x, y, z). To resize",
            vec![
                ns("x", "Scale X", 0.1).d(1.0),
                ns("y", "Scale Y", 0.1).d(1.0),
                ns("z", "Scale Z", 0.1).d(1.0),
            ],
        ),
        spec(
            NodeType::Rotate, C::Modifier, S::Both, pos_in(), out_pos(),
            "Rotation around axes (angleX, angleY, angleZ in radians)",
            vec![
                ns("angleX", "Angle X (rad)", 0.1).d(0.0),
                ns("angleY", "Angle Y (rad)", 0.1).d(0.0),
                ns("angleZ", "Angle Z (rad)", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::Offset, C::Modifier, S::Both, pos_in(), out_pos(),
            "Translation (x, y, z). To shift a movement",
            vec![
                ns("x", "Offset X", 0.1).d(0.0),
                ns("y", "Offset Y", 0.1).d(0.0),
                ns("z", "Offset Z", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::PhaseShift, C::Modifier, S::SubOnly, pos_in(), out_pos(),
            "Per-object time offset — each object lags behind the previous",
            vec![nrange("shift", "Shift", 0.05, 0.0, 1.0).d(0.1)],
        ),
        spec(
            NodeType::Mirror, C::Modifier, S::Both, pos_in(), out_pos(),
            "Mirrors positions across a plane (xy/xz/yz). For symmetric setups",
            vec![
                enm("plane", "Mirror Plane", PLANE).d("xz"),
                ns("offset", "Plane Offset", 0.1).d(0.0),
            ],
        ),
        spec(
            NodeType::Clamp, C::Modifier, S::Both, pos_in(), out_pos(),
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
            NodeType::LFO, C::Modifier, S::Both, pos_in(), out_pos(),
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
            NodeType::Jitter, C::Modifier, S::Both, pos_in(), out_pos(),
            "Adds smooth organic noise. Makes a movement less mechanical",
            vec![
                nmin("intensity", "Intensity", 0.05, 0.0).d(0.2),
                nmin("frequency", "Frequency", 0.1, 0.1).d(2.0),
                ns("seed", "Seed", 1.0).d(42),
            ],
        ),
        spec(
            NodeType::SpeedScale, C::Modifier, S::SubOnly, pos_in(), out_pos(),
            "Multiplies upstream time: upstream(t × factor). factor<1 slows, >1 accelerates",
            vec![nmin("factor", "Factor", 0.05, 0.0).d(1.0)],
        ),
        spec(
            NodeType::Delay, C::Modifier, S::SubOnly, pos_in(), out_pos(),
            "Delays the upstream trajectory: upstream(t − delay). On stateful engines (physics) a look-back resets the sim — see stateful flag",
            vec![nmin("delay", "Delay (s)", 0.05, 0.0).d(0.5)],
        ),
        spec(
            NodeType::Freeze, C::Modifier, S::SubOnly, pos_in(), out_pos(),
            "Holds the last computed positions while enabled — live safety hold",
            vec![p("enabled", "Enabled", ParamKind::Boolean).d(true)],
        ),
        // ── Post-process (graph global) ──
        spec(
            NodeType::RadiusScale, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
            "Radial scaling relative to origin (radius_scale). Global — applied after merge",
            vec![nmin("radius_scale", "Radius Scale", 0.1, 0.0).d(1.0)],
        ),
        spec(
            NodeType::HeightOffset, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
            "Post-merge vertical offset (height_offset). To adjust global height",
            vec![ns("height_offset", "Height Offset", 0.1).d(0.0)],
        ),
        spec(
            NodeType::PerTrackDepth, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
            "Per-track depth — interpolate between origin and position. For depth mapping",
            vec![txt("depths", "Depths (JSON array)").d(serde_json::json!([]))],
        ),
        spec(
            NodeType::Barycenter, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
            "Computes the origin from .hol track positions. Group center",
            vec![],
        ),
        spec(
            NodeType::AudioFalloff, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
            "Modulates a param (scale/height) by audio amplitude. For musical reactivity",
            vec![
                nmin("amount", "Amount", 0.1, 0.0).d(1.0),
                enm("target", "Target", &["scale", "height"]).d("scale"),
            ],
        ),
        spec(
            NodeType::ManualPosition, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
            "Manual position override — reads 3D drags. For hand positioning",
            vec![],
        ),
        spec(
            NodeType::Zone, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
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
            NodeType::Velocity, C::PostProcess, S::GlobalOnly, pos_in(), out_pos(),
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
            NodeType::Mix, C::Composite, S::SubOnly, comp_in(), out_pos(),
            "Linear blend between 2 trajectories (0=A, 1=B). To merge 2 movements",
            vec![nrange("blend", "Blend", 0.01, 0.0, 1.0).d(0.5)],
        ),
        spec(
            NodeType::Group, C::Composite, S::SubOnly, comp_in(), out_pos(),
            "Splits objects by branch A's n_objects: A→[0..n_a), B→[n_a..n). For different track assignments",
            vec![],
        ),
        spec(
            NodeType::Sequence, C::Composite, S::SubOnly, comp_in(), out_pos(),
            "Chains 2 trajectories in time: A for its duration, then B. Hard cut",
            vec![],
        ),
        spec(
            NodeType::Crossfade, C::Composite, S::SubOnly, comp_in(), out_pos(),
            "Chains A→B with a crossfade. Smoother than Sequence",
            vec![nmin("fade_duration", "Fade Duration (s)", 0.1, 0.1).d(1.0)],
        ),
        spec(
            NodeType::Switch, C::Composite, S::SubOnly, comp_in(), out_pos(),
            "Selects A or B by index — manual/OSC-driven, not time-sliced like Sequence",
            vec![nrange("select", "Select", 1.0, 0.0, 1.0).d(0.0)],
        ),
        // ── Sources (engines réactifs) ──
        spec(
            NodeType::BPM, C::Source, S::SubOnly, engine_in(), out_pos(),
            "Circular motion synced to detected BPM",
            vec![
                nmin("bpm", "BPM", 1.0, 1.0).d(120),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::AudioAmplitude, C::Source, S::SubOnly, engine_in(), out_pos(),
            "Audio amplitude modulates a circle radius",
            vec![
                ns("amplitude", "Amplitude", 0.1).d(0.5),
                ns("radius", "Radius", 0.1).d(1.0),
                enm("band", "Band", BAND).d("rms"),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::AudioSpectrum, C::Source, S::SubOnly, engine_in(), out_pos(),
            "Audio spectrum FFT band → position",
            vec![
                enm("band", "Band", BAND).d("bass"),
                ns("radius", "Radius", 0.1).d(1.0),
                nrange("n_bands", "Bands", 1.0, 1.0, 64.0).d(8),
                enm("plane", "Plane", PLANE).d("xz"),
            ],
        ),
        spec(
            NodeType::OSCInput, C::Source, S::SubOnly, engine_in(), out_pos(),
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
            NodeType::Plugin, C::Plugin, S::SubOnly,
            // Superset ABI v2 — le kind du manifeste restreint à runtime :
            // engine → objects+duration, modifier → in, composite → a+b.
            vec![
                port("objects", PortType::ObjectSet),
                port("duration", PortType::Duration),
                port("in", PortType::Positions),
                port("a", PortType::Positions),
                port("b", PortType::Positions),
            ],
            out_pos(),
            "External WASM plugin (.ssx bundle) — plugin_id selects the loaded plugin",
            vec![txt("plugin_id", "Plugin ID").d("")],
        ),
        // ── Signal graph — sources ──
        spec(
            NodeType::SignalConst, C::Signal, S::SignalOnly, vec![], out_sig(),
            "Constant value — bridge for manual live control (UI slider → param). Modulation graph source",
            vec![ns("value", "Value", 0.1).d(0.0)],
        ),
        spec(
            NodeType::SignalTime, C::Signal, S::SignalOnly, vec![], out_sig(),
            "Elapsed time as signal — ramps, periodic patterns. wrap=0 → unbounded",
            vec![
                nrange("rate", "Rate", 0.1, 0.0, 10.0).d(1.0),
                nmin("wrap", "Wrap (s, 0=none)", 0.1, 0.0).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalLfo, C::Signal, S::SignalOnly, vec![], out_sig(),
            "Low-frequency oscillator — periodic macro animation. The classic 'animate anything'",
            vec![
                enm("waveform", "Waveform", &["sine", "triangle", "square", "sawtooth", "random"]).d("sine"),
                nrange("frequency", "Frequency (Hz)", 0.01, 0.0, 10.0).d(0.5),
                ns("amplitude", "Amplitude", 0.1).d(1.0),
                ns("center", "Center", 0.1).d(0.0),
                nrange("phase", "Phase (rad)", 0.01, 0.0, std::f64::consts::TAU).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalAudio, C::Signal, S::SignalOnly, vec![], out_sig(),
            "Audio source → signal (rms/bass/mid/high/bpm/FFT band). Music-reactive macros",
            vec![
                enm("band", "Band", &["rms", "bass", "mid", "high", "bpm", "spectrum"]).d("rms"),
                nrange("index", "FFT Band Index", 1.0, 0.0, 63.0).d(0),
                nrange("smoothing", "Smoothing", 0.01, 0.0, 0.95).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalOsc, C::Signal, S::SignalOnly, vec![], out_sig(),
            "Incoming OSC value → signal. External controllers (faders, sensors)",
            vec![
                txt("name", "Handler Name").d("fader1"),
                nrange("index", "Arg Index", 1.0, 0.0, 7.0).d(0),
            ],
        ),
        spec(
            NodeType::SignalRandom, C::Signal, S::SignalOnly, vec![], out_sig(),
            "Smooth deterministic noise — organic drift. Sum of incommensurate sinusoids",
            vec![
                nrange("rate", "Rate", 0.01, 0.0, 10.0).d(0.5),
                ns("amplitude", "Amplitude", 0.1).d(1.0),
                ns("seed", "Seed", 1.0).d(1.0),
            ],
        ),
        // ── Signal graph — opérateurs ──
        spec(
            NodeType::SignalMath, C::Signal, S::SignalOnly,
            vec![
                port("a", PortType::Signal),
                port("b", PortType::Signal),
            ],
            out_sig(),
            "Scalar math — combine signals. Unconnected inputs fall back to params a/b",
            vec![
                enm("op", "Op", &["add", "sub", "mul", "div", "min", "max", "pow", "abs", "neg", "mod"]).d("add"),
                ns("a", "A (fallback)", 0.1).d(0.0),
                ns("b", "B (fallback)", 0.1).d(1.0),
            ],
        ),
        spec(
            NodeType::SignalMap, C::Signal, S::SignalOnly,
            vec![port("signal", PortType::Signal)], out_sig(),
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
            NodeType::SignalClamp, C::Signal, S::SignalOnly,
            vec![port("signal", PortType::Signal)], out_sig(),
            "Clamp signal to [min, max] — safety bound before MacroOut",
            vec![
                ns("min", "Min", 0.1).d(0.0),
                ns("max", "Max", 0.1).d(1.0),
            ],
        ),
        spec(
            NodeType::SignalMix, C::Signal, S::SignalOnly,
            vec![
                port("a", PortType::Signal),
                port("b", PortType::Signal),
                port("factor", PortType::Signal),
            ],
            out_sig(),
            "Crossfade between two signals (factor 0=A, 1=B) — factor can itself be a signal",
            vec![nrange("factor", "Factor", 0.01, 0.0, 1.0).d(0.5)],
        ),
        // ── Signal graph — nodes à état ──
        spec(
            NodeType::SignalSlew, C::Signal, S::SignalOnly,
            vec![port("signal", PortType::Signal)], out_sig(),
            "Slew rate limiter — asymmetric physical smoothing (rise/fall units per second)",
            vec![
                nmin("rise_rate", "Rise (u/s, 0=unlimited)", 0.1, 0.0).d(0.0),
                nmin("fall_rate", "Fall (u/s, 0=unlimited)", 0.1, 0.0).d(0.0),
            ],
        ),
        spec(
            NodeType::SignalEnvelope, C::Signal, S::SignalOnly,
            vec![port("signal", PortType::Signal)], out_sig(),
            "Envelope follower — retention factors per frame (small=fast, big=slow). Audio punch → macro",
            vec![
                nrange("attack", "Attack (low=fast)", 0.01, 0.0, 1.0).d(0.2),
                nrange("release", "Release (high=slow)", 0.01, 0.0, 1.0).d(0.95),
            ],
        ),
        spec(
            NodeType::SignalThreshold, C::Signal, S::SignalOnly,
            vec![port("signal", PortType::Signal)], out_sig(),
            "Hysteresis gate — 1 above threshold, 0 below threshold-hysteresis, holds between",
            vec![
                ns("threshold", "Threshold", 0.01).d(0.5),
                nmin("hysteresis", "Hysteresis", 0.01, 0.0).d(0.05),
            ],
        ),
        spec(
            NodeType::SignalBeat, C::Signal, S::SignalOnly,
            vec![], out_sig(),
            "Rhythmic pulse from detected audio beat — 1.0 during `width` of each beat period, 0 otherwise. Falls back to param bpm without audio",
            vec![
                nmin("bpm", "BPM (fallback)", 1.0, 30.0).d(120),
                nrange("width", "Pulse Width", 0.05, 0.01, 1.0).d(0.25),
            ],
        ),
        spec(
            NodeType::SignalSampleHold, C::Signal, S::SignalOnly,
            vec![port("signal", PortType::Signal), port("trigger", PortType::Signal)],
            out_sig(),
            "Sample & hold — latches `signal` on `trigger` rising edge, holds otherwise",
            vec![nrange("threshold", "Trigger Threshold", 0.01, 0.0, 1.0).d(0.5)],
        ),
        spec(
            NodeType::SignalMux, C::Signal, S::SignalOnly,
            vec![port("a", PortType::Signal), port("b", PortType::Signal), port("sel", PortType::Signal)],
            out_sig(),
            "Selects a or b by `sel` — signal-driven switch",
            vec![nrange("threshold", "Threshold", 0.01, 0.0, 1.0).d(0.5)],
        ),
        spec(
            NodeType::SignalCounter, C::Signal, S::SignalOnly,
            vec![port("trigger", PortType::Signal)],
            out_sig(),
            "Counts `trigger` rising edges — wraps to 0 when `max` > 0 is reached",
            vec![
                nrange("threshold", "Trigger Threshold", 0.01, 0.0, 1.0).d(0.5),
                nmin("max", "Wrap At", 1.0, 0.0).d(0.0),
            ],
        ),
        // ── Signal graph — terminal ──
        spec(
            NodeType::SignalOut, C::Signal, S::SignalOnly,
            vec![req("signal", PortType::Signal)], vec![],
            "Modulation sink — writes signal as ADDITIVE delta. target: macro (scale, shift_x, shift_y, shift_z, yaw, pitch, roll, radius_scale, height_offset, speed per-move) or param:<NodeType>:<key> to modulate any node param",
            vec![
                p("target", "Target", ParamKind::String).d("yaw"),
                ns("amount", "Amount", 0.1).d(1.0),
            ],
        ),
    ];
    catalog.into_iter().map(annotate).collect()
}

static CATALOG: OnceLock<Vec<NodeSpec>> = OnceLock::new();

/// Le catalogue complet — 62 specs, construit une fois.
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
        const ALL: &[NodeType] = &[
            NodeType::Objects,
            NodeType::Duration,
            NodeType::Output,
            NodeType::Group,
            NodeType::Mix,
            NodeType::Sequence,
            NodeType::Crossfade,
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
            NodeType::SpeedScale,
            NodeType::Delay,
            NodeType::Freeze,
            NodeType::Switch,
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
            NodeType::SignalBeat,
            NodeType::SignalSampleHold,
            NodeType::SignalMux,
            NodeType::SignalCounter,
            NodeType::SignalOut,
        ];
        assert_eq!(all_node_specs().len(), ALL.len(), "catalog size drift");
        for t in ALL {
            let s = node_spec(t);
            assert_eq!(&s.node_type, t);
        }
    }

    /// Les ports du catalogue sont cohérents avec les capacités attendues.
    #[test]
    fn port_tables_invariants() {
        // Terminaux : pas de sortie
        assert!(node_spec(&NodeType::Output).outputs.is_empty());
        assert!(node_spec(&NodeType::SignalOut).outputs.is_empty());
        // Carriers
        assert_eq!(
            node_spec(&NodeType::Objects).outputs[0].port_type,
            PortType::ObjectSet
        );
        assert_eq!(
            node_spec(&NodeType::Duration).outputs[0].port_type,
            PortType::Duration
        );
        // Engine : objects + duration en entrée, positions en sortie
        let circ = node_spec(&NodeType::Circular);
        assert!(circ.input_port("objects").is_some());
        assert!(circ.input_port("duration").is_some());
        assert_eq!(circ.outputs[0].port_type, PortType::Positions);
        // Composites : a + b requis
        let mix = node_spec(&NodeType::Mix);
        assert!(mix.input_port("a").unwrap().required);
        assert!(mix.input_port("b").unwrap().required);
        // DrawSpline : deux sorties, types distincts
        let draw = node_spec(&NodeType::DrawSpline);
        assert_eq!(draw.outputs.len(), 2);
        assert_eq!(
            draw.output_port("spline").unwrap().port_type,
            PortType::Spline
        );
        assert_eq!(
            draw.output_port("out").unwrap().port_type,
            PortType::Positions
        );
        // Scope
        assert_eq!(
            node_spec(&NodeType::RadiusScale).scope,
            NodeScope::GlobalOnly
        );
        assert_eq!(node_spec(&NodeType::Scale).scope, NodeScope::Both);
        assert_eq!(node_spec(&NodeType::Circular).scope, NodeScope::SubOnly);
    }
}
