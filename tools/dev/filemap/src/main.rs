//! filemap: scans the repo (tracked AND ignored files such as .tmp) and writes
//! `.tmp/qa/filemap.tsv` (for agents) and `.tmp/qa/filemap.html` (colored folder tables).
//! Usage: filemap [repo_root]   (std only, no dependencies)
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::UNIX_EPOCH;

const SKIP: [&str; 7] = ["node_modules", ".git", "target", "dist", ".venv", "__pycache__", ".pytest_cache"];
const MAX_ROWS: usize = 40;

struct F { name: String, size: u64, mtime: u64, tracked: bool }

fn walk(root: &Path, dir: &Path, tracked: &std::collections::HashSet<String>, out: &mut BTreeMap<String, Vec<F>>, skipped: &mut BTreeMap<String, usize>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
        let Ok(md) = e.metadata() else { continue };
        if md.is_dir() {
            if SKIP.contains(&name.as_str()) {
                *skipped.entry(rel).or_default() += 1;
                continue;
            }
            walk(root, &p, tracked, out, skipped);
        } else {
            let parent = rel.rsplit_once('/').map(|x| x.0).unwrap_or(".").to_string();
            let mtime = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.entry(parent).or_default().push(F { name, size: md.len(), mtime, tracked: tracked.contains(&rel) });
        }
    }
}

fn day(secs: u64) -> String {
    // civil-from-days (Howard Hinnant)
    let z = (secs / 86400) as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn kb(n: u64) -> String {
    if n >= 1 << 20 { format!("{:.1} MB", n as f64 / 1048576.0) } else { format!("{:.1} KB", n as f64 / 1024.0) }
}

fn hue(top: &str) -> u32 {
    top.bytes().fold(7u32, |h, b| h.wrapping_mul(31).wrapping_add(b as u32)) % 360
}

fn esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;") }

fn main() {
    let root = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    let root = fs::canonicalize(root).expect("root");
    let git = Command::new("git").arg("-C").arg(&root).args(["ls-files", "-z"]).output().expect("git");
    let tracked: std::collections::HashSet<String> =
        String::from_utf8_lossy(&git.stdout).split('\0').filter(|s| !s.is_empty()).map(String::from).collect();

    let mut dirs = BTreeMap::new();
    let mut skipped = BTreeMap::new();
    walk(&root, &root, &tracked, &mut dirs, &mut skipped);

    let qa = root.join(".tmp/qa");
    fs::create_dir_all(&qa).unwrap();

    let mut tsv = String::from("dir\tname\tbytes\tmodified\ttracked\n");
    let mut html = String::from("<!doctype html><meta charset=utf-8><title>filemap</title><style>\
body{font:13px system-ui;background:#111;color:#ddd;margin:16px}h1{font-size:18px}\
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}\
.c{border-radius:8px;overflow:hidden;border:1px solid var(--b);background:#181818}\
.c h2{margin:0;padding:6px 10px;font-size:13px;background:var(--h);color:#fff;word-break:break-all}\
table{width:100%;border-collapse:collapse}td{padding:2px 8px;border-top:1px solid #262626}\
td.n{word-break:break-all}td.s,td.d{color:#888;white-space:nowrap;text-align:right}\
.u td.n{color:#ffb454}.more td{color:#888;font-style:italic}.k{color:#888;font-size:12px}</style>\
<h1>filemap</h1><p class=k>Biały = w git. <span style='color:#ffb454'>Pomarańczowy = poza git (ignorowane/.tmp/niedodane)</span>.</p><div class=g>");

    // FILEMAP_SKIP=.tmp keeps the html readable (the tsv still lists everything)
    let skip = std::env::var("FILEMAP_SKIP").unwrap_or_default();
    for (dir, files) in &mut dirs {
        files.sort_by(|a, b| a.name.cmp(&b.name));
        let top = dir.split('/').next().unwrap_or(".");
        let h = hue(top);
        let n_un = files.iter().filter(|f| !f.tracked).count();
        for f in files.iter() {
            tsv.push_str(&format!("{dir}\t{}\t{}\t{}\t{}\n", f.name, f.size, day(f.mtime), if f.tracked { "git" } else { "local" }));
        }
        if !skip.is_empty() && (dir == &skip || dir.starts_with(&format!("{skip}/"))) { continue; }
        html.push_str(&format!(
            "<div class=c style='--h:hsl({h} 45% 28%);--b:hsl({h} 45% 40%)'><h2>{} <small>({} plików{})</small></h2><table>",
            esc(dir), files.len(), if n_un > 0 { format!(", {n_un} poza git") } else { String::new() }));
        // untracked/newest first inside crowded folders, so the interesting files survive the cap
        let mut shown: Vec<&F> = files.iter().collect();
        if shown.len() > MAX_ROWS { shown.sort_by(|a, b| b.mtime.cmp(&a.mtime)); }
        for f in shown.iter().take(MAX_ROWS) {
            html.push_str(&format!("<tr{}><td class=n>{}<td class=s>{}<td class=d>{}</tr>",
                if f.tracked { "" } else { " class=u" }, esc(&f.name), kb(f.size), day(f.mtime)));
        }
        if shown.len() > MAX_ROWS {
            html.push_str(&format!("<tr class=more><td colspan=3>+{} starszych plików (pełna lista w filemap.tsv)</tr>", shown.len() - MAX_ROWS));
        }
        html.push_str("</table></div>");
    }
    html.push_str("</div><p class=k>Pominięte katalogi: ");
    html.push_str(&skipped.keys().cloned().collect::<Vec<_>>().join(", "));
    html.push_str("</p>");

    fs::write(qa.join("filemap-tree.html"), tree_html(&dirs)).unwrap();
    fs::write(qa.join("filemap.tsv"), tsv).unwrap();
    fs::write(qa.join("filemap.html"), html).unwrap();
    println!("{} folderów, {} plików -> .tmp/qa/filemap.{{tsv,html}}", dirs.len(), dirs.values().map(|v| v.len()).sum::<usize>());
}

#[derive(Default)]
struct Node { dirs: BTreeMap<String, Node>, files: Vec<(String, u64, bool)>, count: usize, bytes: u64 }

/// Collapsible file tree; `.tmp/<name>` is summarised (thousands of files), everything else is listed.
fn tree_html(dirs: &BTreeMap<String, Vec<F>>) -> String {
    let mut root = Node::default();
    for (dir, files) in dirs {
        let parts: Vec<&str> = if dir == "." { vec![] } else { dir.split('/').collect() };
        let depth = if parts.first() == Some(&".tmp") { parts.len().min(2) } else { parts.len() };
        let mut n = &mut root;
        for p in &parts[..depth] { n = n.dirs.entry(p.to_string()).or_default(); }
        let summarised = parts.first() == Some(&".tmp") && parts.len() >= 2;
        for f in files {
            if summarised { n.count += 1; n.bytes += f.size; } else { n.files.push((f.name.clone(), f.size, f.tracked)); }
        }
    }
    let mut out = String::from("<!doctype html><meta charset=utf-8><title>tree</title><style>body{font:13px ui-monospace,Consolas,monospace;background:#111;color:#ddd;margin:16px}details{margin-left:16px;border-left:2px solid hsl(var(--h) 50% 35%);padding-left:6px}summary{cursor:pointer;color:hsl(var(--h) 70% 72%);font-weight:600;padding:1px 0}summary small{color:#777;font-weight:400}.f{margin-left:18px;padding:0 0 0 6px}.f i{color:#777;font-style:normal;margin-left:8px}.u{color:#ffb454}</style><p>Biały = w git, <span class=u>pomarańczowy = poza git</span>. Kliknij folder, by rozwinąć.</p>");
    for (name, n) in &root.dirs { render(name, n, 0, hue(name), &mut out); }
    for f in &root.files { out.push_str(&format!("<div class=f>{}<i>{}</i></div>", esc(&f.0), kb(f.1))); }
    out
}

fn total(n: &Node) -> (usize, u64) {
    n.dirs.values().map(total).fold((n.files.len() + n.count, n.files.iter().map(|f| f.1).sum::<u64>() + n.bytes), |a, b| (a.0 + b.0, a.1 + b.1))
}

fn render(name: &str, n: &Node, depth: usize, h: u32, out: &mut String) {
    let (c, b) = total(n);
    out.push_str(&format!("<details style='--h:{h}'{}><summary>{}/ <small>{c} plików, {}</small></summary>",
        if depth < 1 { " open" } else { "" }, esc(name), kb(b)));
    for (d, child) in &n.dirs { render(d, child, depth + 1, h, out); }
    for f in &n.files {
        out.push_str(&format!("<div class='f{}'>{}<i>{}</i></div>", if f.2 { "" } else { " u" }, esc(&f.0), kb(f.1)));
    }
    out.push_str("</details>");
}
