use chrono::Local;
use std::io::Write;

pub const R: &str = "\x1b[0m";
pub const GREEN: &str = "\x1b[92m";
pub const CYAN: &str = "\x1b[96m";
pub const YELLOW: &str = "\x1b[93m";
pub const RED: &str = "\x1b[91m";
pub const MAGENTA: &str = "\x1b[95m";

pub fn cprint(color: &str, msg: &str) {
    let ts = Local::now().format("%H:%M:%S");
    println!("{color}[{ts}] {msg}{R}");
    // In un container lo stdout e' una pipe → Rust fa buffering a blocchi e i
    // log arriverebbero "a scatti". Flush esplicito così la live console via
    // `docker logs --follow` mostra ogni riga in tempo reale.
    let _ = std::io::stdout().flush();
}

#[macro_export]
macro_rules! logln {
    ($color:expr, $($arg:tt)*) => {
        $crate::log::cprint($color, &format!($($arg)*))
    };
}
