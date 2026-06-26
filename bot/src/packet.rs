use azalea::prelude::*;
use rand::Rng;

use crate::config::Stealth;

#[derive(Clone, Copy)]
pub struct PacketCfg {
    pub enabled: bool,
    pub network_jitter: bool,
    pub micro_noise: f64,
}

impl PacketCfg {
    pub fn from(st: &Stealth) -> Self {
        PacketCfg {
            enabled: st.enabled && st.packet_spoof,
            network_jitter: st.network_jitter,
            micro_noise: st.micro_noise,
        }
    }
}

pub fn humanized_rotation(bot: &Client, cfg: &PacketCfg, yaw: f32, pitch: f32) {
    if !cfg.enabled {
        bot.set_direction(yaw, pitch);
        return;
    }
    let mut rng = rand::thread_rng();
    let overshoot = rng.gen_bool(0.18);
    if overshoot {
        let oy = yaw + rng.gen_range(-3.5..3.5);
        let op = (pitch + rng.gen_range(-2.0..2.0)).clamp(-89.0, 89.0);
        bot.set_direction(oy, op);
    }
    let ny = yaw + rng.gen_range(-0.25..0.25);
    let np = (pitch + rng.gen_range(-0.15..0.15)).clamp(-89.0, 89.0);
    bot.set_direction(ny, np);
}

pub fn idle_micro_rotation(bot: &Client, cfg: &PacketCfg, yaw: f32, pitch: f32) {
    if !cfg.enabled || cfg.micro_noise <= 0.0 {
        return;
    }
    let mut rng = rand::thread_rng();
    let scale = (cfg.micro_noise * 180.0) as f32;
    let ny = yaw + rng.gen_range(-scale..scale);
    let np = (pitch + rng.gen_range(-scale..scale) * 0.5).clamp(-89.0, 89.0);
    bot.set_direction(ny, np);
}

pub fn jitter_ticks(cfg: &PacketCfg, rng: &mut impl Rng, base: u64) -> u64 {
    if !cfg.enabled || !cfg.network_jitter {
        return base;
    }
    let delta = rng.gen_range(0..=3);
    if rng.gen_bool(0.5) {
        base.saturating_add(delta)
    } else {
        base.saturating_sub(delta)
    }
}

pub fn redundant_skip(cfg: &PacketCfg, rng: &mut impl Rng) -> bool {
    cfg.enabled && cfg.network_jitter && rng.gen_bool(0.12)
}
