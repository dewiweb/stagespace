use crate::engines::{finite_or_zero, Engine, EngineParams};
use nalgebra::Vector3;

/// Borne dure sur la longueur d'une équation (audit B3) — le parser est
/// récursif ; sans borne, un `.hfg` corrompu avec une expression de
/// plusieurs Mo forçait un parse par frame par objet.
pub const MAX_EQUATION_LEN: usize = 4096;

/// Borne dure sur la profondeur de l'AST — les descentes récursives du
/// parser et de l'évaluateur sont bornées par cette valeur ; au-delà le
/// parse est rejeté proprement (`Err`) au lieu d'un stack overflow
/// (abort du process, non rattrapable par catch_unwind).
pub const MAX_EXPR_DEPTH: u32 = 64;

/// Trajectoire définie par des équations utilisateur. Les expressions
/// sont **parsées une seule fois** à la construction (`new`) en un AST
/// borné — `position()` n'alloue pas et ne re-parse jamais (audit B3 :
/// l'ancienne version relançait le parseur récursif à chaque frame ×
/// objet, sans aucune borne de profondeur ni de longueur).
pub struct CustomTrajectory {
    fields: [Option<Expr>; 3],
    mode: Mode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Cartesian,
    /// azimuth/elevation en degrés (convention Holophonix/AED),
    /// distance en unités scène
    Spherical,
    /// coordinate_system inconnu → positions nulles
    Invalid,
}

impl CustomTrajectory {
    /// Parse et valide les équations. `Err` = expression malformée, trop
    /// longue ou trop profonde — le compilateur la transforme en
    /// `CompilationError::InvalidParameter` (échec visible, jamais de
    /// comportement silencieux dans le tick).
    pub fn new(params: &EngineParams) -> Result<Self, String> {
        let equations = params.extra.get("equations");
        let mode = match params
            .extra
            .get("coordinate_system")
            .and_then(|v| v.as_str())
            .unwrap_or("cartesian")
        {
            "cartesian" => Mode::Cartesian,
            "polar" | "spherical" => Mode::Spherical,
            _ => Mode::Invalid,
        };
        let keys: [&str; 3] = match mode {
            Mode::Cartesian => ["x", "y", "z"],
            Mode::Spherical => ["azimuth", "elevation", "distance"],
            Mode::Invalid => ["", "", ""],
        };
        let fields = [
            parse_field(equations, keys[0], 0)?,
            parse_field(equations, keys[1], 1)?,
            parse_field(equations, keys[2], 2)?,
        ];
        Ok(Self { fields, mode })
    }
}

impl Engine for CustomTrajectory {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        // Contexte d'évaluation : t (temps s), i (index objet),
        // n (n_objects), d (duration). Angles en radians.
        let ctx = EvalCtx {
            t,
            i: object_index as f64,
            n: params.n_objects as f64,
            d: params.duration,
        };
        let eval = |slot: usize| self.fields[slot].as_ref().map_or(0.0, |e| e.eval(&ctx));

        match self.mode {
            Mode::Cartesian => finite_or_zero(Vector3::new(eval(0), eval(1), eval(2))),
            Mode::Spherical => {
                let azimuth = eval(0);
                let elevation = eval(1);
                let distance = eval(2).max(0.0);
                let azim_rad = azimuth.to_radians();
                let elev_rad = elevation.to_radians();
                // Convention Holophonix : azim=0 ⇒ front (+Y)
                finite_or_zero(Vector3::new(
                    distance * elev_rad.cos() * azim_rad.sin(),
                    distance * elev_rad.cos() * azim_rad.cos(),
                    distance * elev_rad.sin(),
                ))
            }
            Mode::Invalid => Vector3::zeros(),
        }
    }

    fn name(&self) -> &str {
        "custom_trajectory"
    }
}

/// Contexte de variables pour l'évaluateur.
struct EvalCtx {
    t: f64,
    i: f64,
    n: f64,
    d: f64,
}

#[derive(Debug, Clone, Copy)]
enum Var {
    T,
    I,
    N,
    D,
}

#[derive(Debug, Clone, Copy)]
enum FnKind {
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    Atan2,
    Sqrt,
    Abs,
    Floor,
    Ceil,
    Round,
    Exp,
    Ln,
    Log,
    Min,
    Max,
    Sign,
}

impl FnKind {
    fn from_name(name: &[u8]) -> Option<Self> {
        Some(match name {
            b"sin" => Self::Sin,
            b"cos" => Self::Cos,
            b"tan" => Self::Tan,
            b"asin" => Self::Asin,
            b"acos" => Self::Acos,
            b"atan" => Self::Atan,
            b"atan2" => Self::Atan2,
            b"sqrt" => Self::Sqrt,
            b"abs" => Self::Abs,
            b"floor" => Self::Floor,
            b"ceil" => Self::Ceil,
            b"round" => Self::Round,
            b"exp" => Self::Exp,
            b"ln" => Self::Ln,
            b"log" => Self::Log,
            b"min" => Self::Min,
            b"max" => Self::Max,
            b"sign" | b"signum" => Self::Sign,
            _ => return None,
        })
    }

    fn apply(self, a: f64, b: f64) -> f64 {
        let v = match self {
            Self::Sin => a.sin(),
            Self::Cos => a.cos(),
            Self::Tan => a.tan(),
            Self::Asin => a.asin(),
            Self::Acos => a.acos(),
            Self::Atan => a.atan(),
            Self::Atan2 => a.atan2(b),
            Self::Sqrt => a.sqrt(),
            Self::Abs => a.abs(),
            Self::Floor => a.floor(),
            Self::Ceil => a.ceil(),
            Self::Round => a.round(),
            Self::Exp => a.exp(),
            Self::Ln => a.ln(),
            Self::Log => a.log10(),
            Self::Min => a.min(b),
            Self::Max => a.max(b),
            Self::Sign => a.signum(),
        };
        if v.is_finite() {
            v
        } else {
            0.0
        }
    }
}

/// AST d'expression — construit une fois à la compile, évalué sans
/// allocation à chaque tick. Profondeur bornée par `MAX_EXPR_DEPTH`.
#[derive(Debug)]
enum Expr {
    Num(f64),
    Var(Var),
    Neg(Box<Expr>),
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Mod(Box<Expr>, Box<Expr>),
    Pow(Box<Expr>, Box<Expr>),
    Fn(FnKind, Box<Expr>, Option<Box<Expr>>),
}

impl Expr {
    /// Évaluation récursive — bornée par la profondeur max de l'AST
    /// (≤ MAX_EXPR_DEPTH garanti à la construction). Jamais d'allocation.
    fn eval(&self, ctx: &EvalCtx) -> f64 {
        match self {
            Self::Num(v) => *v,
            Self::Var(v) => match v {
                Var::T => ctx.t,
                Var::I => ctx.i,
                Var::N => ctx.n,
                Var::D => ctx.d,
            },
            Self::Neg(a) => -a.eval(ctx),
            Self::Add(a, b) => a.eval(ctx) + b.eval(ctx),
            Self::Sub(a, b) => a.eval(ctx) - b.eval(ctx),
            Self::Mul(a, b) => a.eval(ctx) * b.eval(ctx),
            Self::Div(a, b) => {
                let d = b.eval(ctx);
                if d != 0.0 {
                    a.eval(ctx) / d
                } else {
                    0.0
                }
            }
            Self::Mod(a, b) => {
                let d = b.eval(ctx);
                if d != 0.0 {
                    a.eval(ctx) % d
                } else {
                    0.0
                }
            }
            Self::Pow(a, b) => a.eval(ctx).powf(b.eval(ctx)),
            Self::Fn(f, a, b) => f.apply(a.eval(ctx), b.as_ref().map_or(0.0, |e| e.eval(ctx))),
        }
    }
}

/// Résout et parse l'expression d'un axe. Deux formats acceptés pour
/// `equations` :
/// - objet `{"x": "…", "y": "…", "z": "…"}` (ou azimuth/elevation/distance)
/// - string `"expr_x, expr_y, expr_z"` — split sur les virgules de premier
///   niveau (les virgules dans `min(a,b)` ne coupent pas).
///
/// Champ absent → `Ok(None)` (évalué à 0). Champ présent mais vide →
/// `Ok(None)`. Champ malformé/trop long/trop profond → `Err`.
fn parse_field(
    equations: Option<&serde_json::Value>,
    key: &str,
    index: usize,
) -> Result<Option<Expr>, String> {
    let expr = match equations {
        Some(serde_json::Value::Object(map)) => map.get(key).and_then(|v| v.as_str()),
        Some(serde_json::Value::String(s)) => split_top_level(s).get(index).copied(),
        _ => None,
    };
    let Some(expr) = expr else { return Ok(None) };
    if expr.is_empty() {
        return Ok(None);
    }
    if expr.len() > MAX_EQUATION_LEN {
        return Err(format!(
            "equation '{key}' too long: {} bytes (max {MAX_EQUATION_LEN})",
            expr.len()
        ));
    }
    let mut p = Parser {
        s: expr.as_bytes(),
        pos: 0,
        depth: 0,
    };
    p.expr()
        .map(Some)
        .map_err(|e| format!("equation '{key}': {e}"))
}

/// Split sur les virgules hors parenthèses.
fn split_top_level(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (i, c) in s.char_indices() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(s[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(s[start..].trim());
    parts
}

struct Parser<'a> {
    s: &'a [u8],
    pos: usize,
    /// Profondeur courante des contextes imbriqués (parenthèses, args de
    /// fonction, unaires, puissances) — bornée par MAX_EXPR_DEPTH.
    depth: u32,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.pos).copied()
    }

    fn ws(&mut self) {
        while matches!(self.peek(), Some(b' ') | Some(b'\t')) {
            self.pos += 1;
        }
    }

    /// Garde de profondeur — tout appel récursif passe par ici.
    fn nested(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_EXPR_DEPTH {
            self.depth -= 1;
            return Err(format!("expression too deep (max {MAX_EXPR_DEPTH})"));
        }
        Ok(())
    }

    fn unnest(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    /// additive
    fn expr(&mut self) -> Result<Expr, String> {
        let mut v = self.term()?;
        loop {
            self.ws();
            match self.peek() {
                Some(b'+') => {
                    self.pos += 1;
                    v = Expr::Add(Box::new(v), Box::new(self.term()?));
                }
                Some(b'-') => {
                    self.pos += 1;
                    v = Expr::Sub(Box::new(v), Box::new(self.term()?));
                }
                _ => return Ok(v),
            }
        }
    }

    /// multiplicative
    fn term(&mut self) -> Result<Expr, String> {
        let mut v = self.factor()?;
        loop {
            self.ws();
            match self.peek() {
                Some(b'*') => {
                    self.pos += 1;
                    v = Expr::Mul(Box::new(v), Box::new(self.factor()?));
                }
                Some(b'/') => {
                    self.pos += 1;
                    v = Expr::Div(Box::new(v), Box::new(self.factor()?));
                }
                Some(b'%') => {
                    self.pos += 1;
                    v = Expr::Mod(Box::new(v), Box::new(self.factor()?));
                }
                _ => return Ok(v),
            }
        }
    }

    /// unaire + puissance (associative à droite)
    fn factor(&mut self) -> Result<Expr, String> {
        self.ws();
        match self.peek() {
            Some(b'-') => {
                self.pos += 1;
                self.nested()?;
                let inner = self.factor();
                self.unnest();
                Ok(Expr::Neg(Box::new(inner?)))
            }
            Some(b'+') => {
                self.pos += 1;
                self.nested()?;
                let inner = self.factor();
                self.unnest();
                inner
            }
            _ => {
                let base = self.atom()?;
                self.ws();
                if self.peek() == Some(b'^') {
                    self.pos += 1;
                    self.nested()?;
                    let exp = self.factor();
                    self.unnest();
                    Ok(Expr::Pow(Box::new(base), Box::new(exp?)))
                } else {
                    Ok(base)
                }
            }
        }
    }

    fn atom(&mut self) -> Result<Expr, String> {
        self.ws();
        match self.peek() {
            Some(b'(') => {
                self.pos += 1;
                self.nested()?;
                let inner = self.expr();
                self.unnest();
                let v = inner?;
                self.ws();
                if self.peek() == Some(b')') {
                    self.pos += 1;
                } else {
                    return Err("missing closing parenthesis".into());
                }
                Ok(v)
            }
            Some(c) if c.is_ascii_digit() || c == b'.' => Ok(Expr::Num(self.number())),
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => self.ident(),
            Some(c) => Err(format!("unexpected character '{}'", c as char)),
            None => Err("unexpected end of expression".into()),
        }
    }

    fn number(&mut self) -> f64 {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == b'.' {
                self.pos += 1;
            } else if (c == b'e' || c == b'E') && self.pos > start {
                // Notation scientifique : e/E puis signe optionnel
                self.pos += 1;
                if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
        std::str::from_utf8(&self.s[start..self.pos])
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
    }

    fn ident(&mut self) -> Result<Expr, String> {
        let start = self.pos;
        while matches!(self.peek(), Some(c) if c.is_ascii_alphanumeric() || c == b'_') {
            self.pos += 1;
        }
        let name = &self.s[start..self.pos];
        self.ws();

        if self.peek() == Some(b'(') {
            // Fonction : 1 ou 2 arguments
            self.pos += 1;
            self.nested()?;
            let a = self.expr();
            if a.is_err() {
                self.unnest();
                return a;
            }
            let a = a.map(Box::new)?;
            self.ws();
            let b = if self.peek() == Some(b',') {
                self.pos += 1;
                match self.expr() {
                    Ok(e) => Some(Box::new(e)),
                    Err(e) => {
                        self.unnest();
                        return Err(e);
                    }
                }
            } else {
                None
            };
            self.unnest();
            self.ws();
            if self.peek() == Some(b')') {
                self.pos += 1;
            } else {
                return Err(format!(
                    "missing closing parenthesis after '{}'",
                    String::from_utf8_lossy(name)
                ));
            }
            let kind = FnKind::from_name(name)
                .ok_or_else(|| format!("unknown function '{}'", String::from_utf8_lossy(name)))?;
            Ok(Expr::Fn(kind, a, b))
        } else {
            Ok(match name {
                b"t" => Expr::Var(Var::T),
                b"i" => Expr::Var(Var::I),
                b"n" => Expr::Var(Var::N),
                b"d" | b"duration" => Expr::Var(Var::D),
                b"pi" => Expr::Num(std::f64::consts::PI),
                b"e" => Expr::Num(std::f64::consts::E),
                // Identifiant inconnu → constante 0 (comportement legacy :
                // tolérant aux fautes de frappe sur les variables).
                _ => Expr::Num(0.0),
            })
        }
    }
}
