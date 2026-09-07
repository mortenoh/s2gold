//! First-run asset conversion: turn the user's own GOG installer into the
//! converted asset tree under app data.
//!
//! The conversion itself is still the Python pipeline (`src/s2gold`, run via
//! `uv`); this module locates it, runs it with the app-data output paths, and
//! streams its log lines back to the caller. It is the interim "option (a)" of
//! ROADMAP section G: a Rust port of the pipeline replaces `converter_command`
//! without touching the command surface or the first-run screen.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Output layout under the app-data directory.
pub struct Layout {
    pub assets_dir: PathBuf,
    pub extracted_dir: PathBuf,
}

impl Layout {
    pub fn under(app_data: &Path) -> Self {
        Self {
            assets_dir: app_data.join("assets"),
            extracted_dir: app_data.join("extracted"),
        }
    }
}

/// Where the converter and its external tools were found (or not). Shown on
/// the first-run screen so a missing `uv`/`innoextract` is diagnosed before
/// the user picks a file.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ConverterStatus {
    pub available: bool,
    /// Human-readable description of the converter that will run.
    pub converter: String,
    pub innoextract: Option<String>,
    pub fluidsynth: Option<String>,
    pub ffmpeg: Option<String>,
    pub assets_dir: String,
    pub problems: Vec<String>,
}

/// Source tree this binary was built from (the Python pipeline lives there).
fn repo_root() -> PathBuf {
    let raw = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    raw.canonicalize().unwrap_or(raw)
}

/// PATH for child processes: GUI apps on macOS start with a minimal PATH that
/// lacks Homebrew and user-local bins, where `uv` and `innoextract` live.
pub fn tool_path() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(d));
    }
    let mut path = std::env::var("PATH").unwrap_or_default();
    for d in dirs {
        let d = d.to_string_lossy().to_string();
        if !path.split(':').any(|p| p == d) {
            if !path.is_empty() {
                path.push(':');
            }
            path.push_str(&d);
        }
    }
    path
}

fn which(tool: &str) -> Option<String> {
    tool_path().split(':').find_map(|dir| {
        let candidate = Path::new(dir).join(tool);
        candidate
            .is_file()
            .then(|| candidate.to_string_lossy().to_string())
    })
}

/// The converter invocation for one installer, without the installer/output
/// arguments. `S2GOLD_CONVERTER` (whitespace-split) overrides discovery.
fn converter_program() -> Result<(Vec<String>, String), String> {
    if let Ok(custom) = std::env::var("S2GOLD_CONVERTER") {
        let parts: Vec<String> = custom.split_whitespace().map(str::to_string).collect();
        if parts.is_empty() {
            return Err("S2GOLD_CONVERTER is set but empty".to_string());
        }
        return Ok((parts, format!("S2GOLD_CONVERTER: {custom}")));
    }
    let repo = repo_root();
    let uv = which("uv");
    match (uv, repo.join("pyproject.toml").is_file()) {
        (Some(uv), true) => Ok((
            vec![
                uv,
                "run".to_string(),
                "--project".to_string(),
                repo.to_string_lossy().to_string(),
                "s2gold".to_string(),
            ],
            format!("uv run --project {} s2gold", repo.display()),
        )),
        (None, _) => Err(
            "`uv` was not found on PATH (https://docs.astral.sh/uv/); the asset pipeline \
             needs it until the Rust converter lands"
                .to_string(),
        ),
        (Some(_), false) => Err(format!(
            "the s2gold source tree this app was built from is gone ({}); set S2GOLD_CONVERTER \
             to a command that runs the `s2gold` CLI",
            repo.display()
        )),
    }
}

pub fn status(layout: &Layout) -> ConverterStatus {
    let mut problems = Vec::new();
    let converter = match converter_program() {
        Ok((_, desc)) => desc,
        Err(e) => {
            problems.push(e);
            "unavailable".to_string()
        }
    };
    let innoextract = which("innoextract");
    if innoextract.is_none() {
        problems.push(
            "`innoextract` was not found on PATH (brew install innoextract); it unpacks the GOG \
             installer"
                .to_string(),
        );
    }
    ConverterStatus {
        available: problems.is_empty(),
        converter,
        innoextract,
        fluidsynth: which("fluidsynth"),
        ffmpeg: which("ffmpeg"),
        assets_dir: layout.assets_dir.to_string_lossy().to_string(),
        problems,
    }
}

/// Run the conversion, forwarding each output line to `on_line`. Returns once
/// the manifest exists; errors carry the tail of the log.
pub fn run(installer: &Path, layout: &Layout, mut on_line: impl FnMut(&str)) -> Result<(), String> {
    if !installer.is_file() {
        return Err(format!("installer not found: {}", installer.display()));
    }
    let st = status(layout);
    if !st.available {
        return Err(st.problems.join("\n"));
    }
    let (program, _) = converter_program()?;
    std::fs::create_dir_all(&layout.assets_dir).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&program[0]);
    cmd.args(&program[1..])
        .arg("install")
        .arg(installer)
        .arg("--assets")
        .arg(&layout.assets_dir)
        .arg("--extracted")
        .arg(&layout.extracted_dir)
        .env("PATH", tool_path())
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    on_line(&format!("$ {}", program.join(" ")));
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", program[0]))?;
    let stderr = child.stderr.take().expect("piped stderr");
    let stdout = child.stdout.take().expect("piped stdout");
    let err_thread = std::thread::spawn(move || {
        BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
            .collect::<Vec<_>>()
    });
    let mut tail: Vec<String> = Vec::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        on_line(&line);
        tail.push(line);
        if tail.len() > 20 {
            tail.remove(0);
        }
    }
    let errors = err_thread.join().unwrap_or_default();
    for line in &errors {
        on_line(line);
    }
    let code = child.wait().map_err(|e| e.to_string())?;
    if !code.success() {
        let mut msg = format!("converter exited with {code}");
        for line in errors.iter().rev().take(8).rev() {
            msg.push('\n');
            msg.push_str(line);
        }
        return Err(msg);
    }
    if !layout.assets_dir.join("manifest.json").is_file() {
        return Err("converter finished but wrote no manifest.json".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_path_adds_homebrew_once() {
        let p = tool_path();
        assert!(p.split(':').any(|d| d == "/opt/homebrew/bin"));
        assert_eq!(
            p.split(':').filter(|d| *d == "/opt/homebrew/bin").count(),
            1
        );
    }

    #[test]
    fn custom_converter_overrides_discovery() {
        // SAFETY: tests in this module run single-threaded per process key.
        unsafe { std::env::set_var("S2GOLD_CONVERTER", "/bin/echo fake") };
        let (program, desc) = converter_program().unwrap();
        assert_eq!(program, vec!["/bin/echo", "fake"]);
        assert!(desc.contains("fake"));
        unsafe { std::env::remove_var("S2GOLD_CONVERTER") };
    }
}
