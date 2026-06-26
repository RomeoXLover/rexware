use crate::config::Stealth;

const LOCALES: &[&str] = &[
    "en_us", "en_gb", "de_de", "fr_fr", "es_es", "it_it", "pt_br", "nl_nl", "pl_pl", "ru_ru",
];

#[derive(Clone, Debug)]
pub struct Persona {
    pub view_distance: u8,
    pub locale: String,
    pub right_handed: bool,
    pub sensitivity: f64,
    pub reaction_ticks: u32,
    pub typing_cps: f64,
    pub sprint_bias: f64,
    pub jump_bias: f64,
    pub idle_drift: bool,
}

fn hash(s: &str) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

fn pick(seed: u64, shift: u32, lo: f64, hi: f64) -> f64 {
    let v = ((seed >> shift) & 0xffff) as f64 / 65535.0;
    lo + v * (hi - lo)
}

impl Persona {
    pub fn derive(username: &str, st: &Stealth) -> Persona {
        let seed = hash(username);

        let view_distance = if st.view_distance != "auto" {
            st.view_distance.parse::<u8>().unwrap_or(10).clamp(2, 32)
        } else {
            (6 + (seed % 11) as u8).clamp(2, 32)
        };

        let locale = if st.locale != "auto" {
            st.locale.clone()
        } else {
            LOCALES[(seed >> 8) as usize % LOCALES.len()].to_string()
        };

        let right_handed = match st.main_hand.as_str() {
            "left" => false,
            "right" => true,
            _ => (seed >> 3) & 1 == 0,
        };

        Persona {
            view_distance,
            locale,
            right_handed,
            sensitivity: pick(seed, 16, 0.55, 1.35),
            reaction_ticks: (2.0 + pick(seed, 24, 0.0, 5.0)) as u32,
            typing_cps: pick(seed, 32, 4.0, 9.0),
            sprint_bias: pick(seed, 40, 0.2, 0.7),
            jump_bias: pick(seed, 48, 0.05, 0.25),
            idle_drift: st.idle_drift,
        }
    }
}
