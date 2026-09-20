use crate::engines::{finite_or_zero, Engine, EngineParams};
use nalgebra::Vector3;

pub struct CustomTrajectory;

impl Engine for CustomTrajectory {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let equations = params.extra.get("equations");

        let coordinate_system = params
            .extra
            .get("coordinate_system")
            .and_then(|v| v.as_str())
            .unwrap_or("cartesian");

        // Contexte d'évaluation : t (temps s), i (index objet), n (n_objects),
        // d (duration). Angles en radians.
        let ctx = EvalCtx {
            t,
            i: object_index as f64,
            n: params.n_objects as f64,
            d: params.duration,
        };

        match coordinate_system {
            "cartesian" => {
                let x = eval_field(equations, "x", 0, &ctx);
                let y = eval_field(equations, "y", 1, &ctx);
                let z = eval_field(equations, "z", 2, &ctx);
                finite_or_zero(Vector3::new(x, y, z))
            }
            "polar" | "spherical" => {
                // azimuth/elevation en degrés (convention Holophonix/AED),
                // distance en unités scène.
                let azimuth = eval_field(equations, "azimuth", 0, &ctx);
                let elevation = eval_field(equations, "elevation", 1, &ctx);
                let distance = eval_field(equations, "distance", 2, &ctx).max(0.0);

                let azim_rad = azimuth.to_radians();
                let elev_rad = elevation.to_radians();

                // Convention Holophonix : azim=0 ⇒ front (+Y)
                finite_or_zero(Vector3::new(
                    distance * elev_rad.cos() * azim_rad.sin(),
                    distance * elev_rad.cos() * azim_rad.cos(),
                    distance * elev_rad.sin(),
                ))
            }
            _ => Vector3::zeros(),
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

/// Résout l'expression d'un axe. Deux formats acceptés pour `equations` :
/// - objet `{"x": "…", "y": "…", "z": "…"}` (ou azimuth/elevation/distance)
/// - string `"expr_x, expr_y, expr_z"` — split sur les virgules de premier
///   niveau (les virgules dans `min(a,b)` ne coupent pas).
fn eval_field(
    equations: Option<&serde_json::Value>,
    key: &str,
    index: usize,
    ctx: &EvalCtx,
) -> f64 {
    let expr = match equations {
        Some(serde_json::Value::Object(map)) => map.get(key).and_then(|v| v.as_str()),
        Some(serde_json::Value::String(s)) => split_top_level(s).get(index).copied(),
        _ => None,
    };
    let Some(expr) = expr else { return 0.0 };
    eval_expr(expr, ctx)
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

/// Évalue une expression : `2*sin(t) + i*0.5`, `sqrt(t)`, `1e-3*d`…
/// Toute erreur de parse → 0.0 (pas de panic dans le tick).
fn eval_expr(expr: &str, ctx: &EvalCtx) -> f64 {
    let mut p = Parser {
        s: expr.as_bytes(),
        pos: 0,
        ctx,
    };
    let v = p.expr();
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

struct Parser<'a> {
    s: &'a [u8],
    pos: usize,
    ctx: &'a EvalCtx,
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

    /// additive
    fn expr(&mut self) -> f64 {
        let mut v = self.term();
        loop {
            self.ws();
            match self.peek() {
                Some(b'+') => {
                    self.pos += 1;
                    v += self.term();
                }
                Some(b'-') => {
                    self.pos += 1;
                    v -= self.term();
                }
                _ => return v,
            }
        }
    }

    /// multiplicative
    fn term(&mut self) -> f64 {
        let mut v = self.factor();
        loop {
            self.ws();
            match self.peek() {
                Some(b'*') => {
                    self.pos += 1;
                    v *= self.factor();
                }
                Some(b'/') => {
                    self.pos += 1;
                    let d = self.factor();
                    v = if d != 0.0 { v / d } else { 0.0 };
                }
                Some(b'%') => {
                    self.pos += 1;
                    let d = self.factor();
                    v = if d != 0.0 { v % d } else { 0.0 };
                }
                _ => return v,
            }
        }
    }

    /// unaire + puissance (associative à droite)
    fn factor(&mut self) -> f64 {
        self.ws();
        match self.peek() {
            Some(b'-') => {
                self.pos += 1;
                -self.factor()
            }
            Some(b'+') => {
                self.pos += 1;
                self.factor()
            }
            _ => {
                let base = self.atom();
                self.ws();
                if self.peek() == Some(b'^') {
                    self.pos += 1;
                    base.powf(self.factor())
                } else {
                    base
                }
            }
        }
    }

    fn atom(&mut self) -> f64 {
        self.ws();
        match self.peek() {
            Some(b'(') => {
                self.pos += 1;
                let v = self.expr();
                self.ws();
                if self.peek() == Some(b')') {
                    self.pos += 1;
                }
                v
            }
            Some(c) if c.is_ascii_digit() || c == b'.' => self.number(),
            Some(c) if c.is_ascii_alphabetic() || c == b'_' => self.ident(),
            // Caractère inattendu : consommer pour éviter une boucle infinie
            _ => {
                self.pos += 1;
                0.0
            }
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

    fn ident(&mut self) -> f64 {
        let start = self.pos;
        while matches!(self.peek(), Some(c) if c.is_ascii_alphanumeric() || c == b'_') {
            self.pos += 1;
        }
        let name = &self.s[start..self.pos];
        self.ws();

        if self.peek() == Some(b'(') {
            // Fonction : 1 ou 2 arguments
            self.pos += 1;
            let a = self.expr();
            self.ws();
            let b = if self.peek() == Some(b',') {
                self.pos += 1;
                Some(self.expr())
            } else {
                None
            };
            self.ws();
            if self.peek() == Some(b')') {
                self.pos += 1;
            }
            apply_fn(name, a, b)
        } else {
            match name {
                b"t" => self.ctx.t,
                b"i" => self.ctx.i,
                b"n" => self.ctx.n,
                b"d" | b"duration" => self.ctx.d,
                b"pi" => std::f64::consts::PI,
                b"e" => std::f64::consts::E,
                _ => 0.0,
            }
        }
    }
}

fn apply_fn(name: &[u8], a: f64, b: Option<f64>) -> f64 {
    let v = match name {
        b"sin" => a.sin(),
        b"cos" => a.cos(),
        b"tan" => a.tan(),
        b"asin" => a.asin(),
        b"acos" => a.acos(),
        b"atan" => a.atan(),
        b"atan2" => a.atan2(b.unwrap_or(0.0)),
        b"sqrt" => a.sqrt(),
        b"abs" => a.abs(),
        b"floor" => a.floor(),
        b"ceil" => a.ceil(),
        b"round" => a.round(),
        b"exp" => a.exp(),
        b"ln" => a.ln(),
        b"log" => a.log10(),
        b"min" => a.min(b.unwrap_or(0.0)),
        b"max" => a.max(b.unwrap_or(0.0)),
        b"sign" | b"signum" => a.signum(),
        _ => 0.0,
    };
    if v.is_finite() {
        v
    } else {
        0.0
    }
}
