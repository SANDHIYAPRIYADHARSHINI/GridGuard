"""Dashboard styling and small HTML helpers.

Meter IDs and packet contents arrive over the network, so anything dynamic that goes into
HTML is passed through esc() first.
"""
from __future__ import annotations

import html
import time
from datetime import datetime

import streamlit as st

from gateway.core import LIMITS

esc = lambda s: html.escape(str(s), quote=True)  # noqa: E731

SEV_COL = {"critical": "#b42318", "high": "#c2410c", "medium": "#a16207", "low": "#1d4ed8", "info": "#66707d"}
METER_COL = {"MTR-001": "#1d4ed8", "MTR-002": "#c2410c"}
OK, WARN, BAD, ISO, MUTED = "#2f7d4f", "#a16207", "#b42318", "#5b6472", "#66707d"

CSS = """
<style>
:root{--bg:#f4f5f7;--panel:#fff;--line:#d8dce2;--txt:#1f2933;--mut:#66707d;--accent:#1d4ed8;
--ok:#2f7d4f;--warn:#a16207;--bad:#b42318;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
html,body,.stApp,[data-testid="stMarkdownContainer"]{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--txt)}
.stApp{background:var(--bg)}
[data-testid="stHeader"]{background:transparent}
#MainMenu,footer,[data-testid="stToolbar"],[data-testid="stDecoration"]{visibility:hidden;height:0}
.block-container{padding-top:1.4rem;padding-bottom:3rem;max-width:1400px}

/* sidebar */
[data-testid="stSidebar"]{background:#fff;border-right:1px solid var(--line)}
.brand{font-size:18px;font-weight:700;margin:2px 0 0}
.brand-sub{font-size:12px;color:var(--mut);margin-bottom:14px}
.side-h{font-size:12px;font-weight:600;color:var(--mut);margin:20px 0 6px}
.side-note{font-size:12px;color:var(--mut);margin-top:22px;line-height:1.6}
[role="radiogroup"]{gap:2px}
[data-testid="stRadioOption"],[role="radiogroup"]>label{padding:6px 10px;border-radius:4px;border-left:3px solid transparent;cursor:pointer}
[data-testid="stSidebar"] [data-testid="stRadioOption"],[data-testid="stSidebar"] [role="radiogroup"]>label,[data-testid="stSidebar"] [data-testid="stRadioGroup"]>div{width:100%}
[data-testid="stRadioOption"]:hover,[role="radiogroup"]>label:hover{background:#f0f2f5}
[data-testid="stRadioOption"][data-selected="true"],[role="radiogroup"]>label:has(input:checked){background:#eef2fb;border-left-color:var(--accent)}
[data-testid="stRadioOption"]>div>div:first-child,[role="radiogroup"]>label>div:first-child{display:none}
[data-testid="stRadioOption"] p,[role="radiogroup"]>label p{font-size:14px}
[data-testid="stRadioOption"][data-selected="true"] p{font-weight:600}

/* header */
.top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;gap:12px;flex-wrap:wrap}
.top h1{font-size:22px;font-weight:650;margin:0;padding:0}
.top .meta{font-size:13px;color:var(--mut)}
.top .meta b{font-weight:600}
.notice{border:1px solid var(--line);border-left:4px solid var(--c);background:var(--panel);padding:10px 14px;border-radius:4px;margin-bottom:14px;font-size:14px}
.notice b{color:var(--c)}

/* numbers row */
.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:4px}
@media(max-width:1100px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px 14px}
.stat .l{font-size:12px;color:var(--mut)}
.stat .v{font-size:26px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}
.stat .v small{font-size:13px;color:var(--mut);font-weight:400;margin-left:3px}
.stat .s{font-size:12px;color:var(--mut);margin-top:1px}

.sec{font-size:15px;font-weight:650;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.note{font-size:13px;color:var(--mut);margin:-4px 0 12px}

/* panels */
.panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px 16px;margin-bottom:8px}
.panel.iso{background:#f0f1f3}
.ph{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.pn{font-size:16px;font-weight:650}
.ps{font-size:12.5px;color:var(--mut);margin-top:2px}
.st{font-size:12.5px;font-weight:650;color:var(--c);white-space:nowrap}
.reads{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0 10px;padding-top:12px;border-top:1px solid #eceef1}
@media(max-width:1300px){.reads{grid-template-columns:repeat(2,minmax(0,1fr))}}
.reads .l{font-size:12px;color:var(--mut)}
.reads .v{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--c)}
.reads .v small{font-size:12px;color:var(--mut);font-weight:400;margin-left:2px}
.pf{font-size:12.5px;color:var(--mut)}
.pf b{color:var(--txt);font-weight:600}
.isonote{margin-top:8px;font-size:13px;color:#3d4653}
.kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eceef1;font-size:13px}
.kv:last-child{border-bottom:none}.kv span:first-child{color:var(--mut)}

/* tables */
.tblwrap{background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:8px}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;font-weight:600;color:var(--mut);font-size:12px;padding:8px 12px;border-bottom:1px solid var(--line);background:#fafbfc}
.tbl td{padding:8px 12px;border-bottom:1px solid #eceef1;vertical-align:top}
.tbl tr:last-child td{border-bottom:none}
.sev{font-weight:650;color:var(--c)}
.mono{font-family:var(--mono);font-size:12px}
.mut{color:var(--mut)}
.empty{padding:22px;text-align:center;color:var(--mut);background:var(--panel);border:1px dashed var(--line);border-radius:6px;font-size:14px}

/* verdicts */
.verdict{display:flex;gap:14px;padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:4px;margin-bottom:6px}
.verdict .vl{font-size:12.5px;font-weight:700;color:var(--c);min-width:70px}
.verdict .vd{font-size:13.5px}.verdict .vr{font-size:12.5px;color:var(--mut);margin-top:2px}

/* widgets */
.stButton>button,[data-testid="stDownloadButton"] button{border-radius:4px;border:1px solid #b9c0ca;background:#fff;color:var(--txt);font-weight:500;padding:.4rem .9rem}
.stButton>button:hover,[data-testid="stDownloadButton"] button:hover{background:#f0f2f5;border-color:#8b95a3;color:var(--txt)}
.stButton>button[kind="primary"],.stButton>button[data-testid="stBaseButton-primary"]{border-color:#e0a9a3;color:var(--bad)}
.stButton>button[kind="primary"]:hover,.stButton>button[data-testid="stBaseButton-primary"]:hover{background:#fdf1f0;border-color:var(--bad)}
[data-testid="stExpander"]{border:1px solid var(--line);border-radius:6px;background:var(--panel)}
.stTextArea textarea{font-family:var(--mono);font-size:12.5px}
</style>
"""


def inject() -> None:
    st.markdown(CSS, unsafe_allow_html=True)


def md(s: str) -> None:
    """Render an HTML snippet (blank lines / indentation would break Markdown's HTML block)."""
    st.markdown("\n".join(ln.strip() for ln in s.splitlines() if ln.strip()), unsafe_allow_html=True)


def section(title: str) -> None:
    md(f'<div class="sec">{esc(title)}</div>')


def note(text: str) -> None:
    md(f'<div class="note">{esc(text)}</div>')


def empty(text: str) -> None:
    md(f'<div class="empty">{esc(text)}</div>')


# --------------------------------------------------------------------------- page chrome
def header(title: str, stats: dict) -> None:
    label, col = {"SECURE": ("Normal", OK), "ELEVATED": ("Warning", WARN), "ATTACK": ("Alert", BAD)}[stats["threat"]]
    md(f'<div class="top"><h1>{esc(title)}</h1><div class="meta">Updated {datetime.now().strftime("%H:%M:%S")} &nbsp;·&nbsp; '
       f'System status: <b style="color:{col}">{label}</b></div></div>')


def banner(stats: dict, e: dict | None) -> None:
    if stats["threat"] == "SECURE" or not e:
        return
    col = BAD if stats["threat"] == "ATTACK" else WARN
    md(f'<div class="notice" style="--c:{col}"><b>Active alert</b> &nbsp;{esc(e["meter_id"] or "unknown")}: '
       f'{esc(e["type"].replace("_", " "))} — {esc(e["reason"])}</div>')


def stats_row(items: list[tuple]) -> None:
    """items: (label, value, unit, sub)"""
    cards = "".join(f'<div class="stat"><div class="l">{esc(l)}</div><div class="v">{esc(v)}<small>{esc(u)}</small></div>'
                    f'<div class="s">{esc(s)}</div></div>' for l, v, u, s in items)
    md(f'<div class="stats">{cards}</div>')


# --------------------------------------------------------------------------- meters
def _state(kind: str, x: float) -> str:
    L = LIMITS
    if kind == "v":
        return "bad" if not L["volt_crit"][0] <= x <= L["volt_crit"][1] else "warn" if not L["volt_warn"][0] <= x <= L["volt_warn"][1] else ""
    if kind == "i":
        return "bad" if x > L["cur_crit"] else "warn" if x > L["cur_warn"] else ""
    if kind == "t":
        return "bad" if x > L["temp_crit"] else "warn" if x > L["temp_warn"] else ""
    return "bad" if x > L["pow_crit"] else "warn" if x > L["pow_warn"] else ""


def ago(ts: float | None) -> str:
    if not ts:
        return "never"
    d = max(0, time.time() - ts)
    return f"{d:.0f}s ago" if d < 90 else f"{d / 60:.0f} min ago" if d < 5400 else f"{d / 3600:.0f} h ago"


def meter_status(m: dict) -> tuple[str, str, str]:
    """-> (css class, text, colour)"""
    lat = m["latest"]
    if m["status"] == "isolated":
        return "iso", "Isolated", ISO
    if m["level"] == "high":
        return "", "Alert", BAD
    if m["level"] == "medium":
        return "", "Warning", WARN
    if lat is None or time.time() - lat["ts"] > 12:
        return "", "No signal", MUTED
    return "", "Online", OK


def meter_card(mid: str, m: dict) -> None:
    cls, text, col = meter_status(m)
    lat = m["latest"]
    cells = ""
    for label, kind, unit, fmt, key in [("Voltage", "v", "V", ".1f", "voltage_v"), ("Current", "i", "A", ".2f", "current_a"),
                                        ("Power", "p", "kW", ".2f", "power_kw"), ("Temperature", "t", "°C", ".1f", "temp_c")]:
        if lat:
            s = _state(kind, lat[key])
            c = {"bad": BAD, "warn": WARN}.get(s, "inherit")
            cells += f'<div><div class="l">{label}</div><div class="v" style="--c:{c}">{format(lat[key], fmt)}<small>{unit}</small></div></div>'
        else:
            cells += f'<div><div class="l">{label}</div><div class="v">–<small>{unit}</small></div></div>'
    note_ = ""
    if m["status"] == "isolated":
        note_ = f'<div class="isonote">Isolated: {esc(m.get("isolated_reason") or "by operator")}. Incoming packets are being dropped.</div>'
    md(f"""
    <div class="panel {cls}">
      <div class="ph"><div><div class="pn">{esc(m['name'])}</div><div class="ps">{esc(m['meter_id'])} · {esc(m['site'])}</div></div>
      <div class="st" style="--c:{col}">{text}</div></div>
      <div class="reads">{cells}</div>
      <div class="pf">Last seen <b>{ago(m['last_seen'])}</b> &nbsp;·&nbsp; Energy <b>{(m['energy_wh'] or 0):.2f} Wh</b> &nbsp;·&nbsp;
      Sequence <b>{m['last_seq'] or 0}</b> &nbsp;·&nbsp; Health score <b>{m['score']}</b>/100</div>
      {note_}
    </div>""")


def asset_card(mid: str, m: dict) -> None:
    cls, text, col = meter_status(m)
    rows = [("Device ID", mid), ("Location", m["site"]), ("Firmware", m["firmware"]), ("Authentication", "HMAC-SHA256"),
            ("Last seen", ago(m["last_seen"])), ("Packets accepted", f"{m['accepted']:,}"), ("Packets rejected", f"{m['rejected']:,}"),
            ("Packets blocked", f"{m['blocked']:,}"), ("Energy", f"{(m['energy_wh'] or 0):.2f} Wh")]
    body = "".join(f'<div class="kv"><span>{esc(k)}</span><span class="mono">{esc(v)}</span></div>' for k, v in rows)
    md(f'<div class="panel {cls}"><div class="ph"><div><div class="pn">{esc(m["name"])}</div><div class="ps">{esc(m["site"])}</div></div>'
       f'<div class="st" style="--c:{col}">{text}</div></div><div style="margin-top:10px">{body}</div></div>')


# --------------------------------------------------------------------------- events
def _txt(v, dash="-") -> str:
    return v if isinstance(v, str) and v else dash


def event_table(df) -> None:
    rows = ""
    for _, e in df.iterrows():
        c = SEV_COL.get(e["severity"], MUTED)
        rows += (f'<tr><td class="mono mut">{datetime.fromtimestamp(e["ts"]).strftime("%H:%M:%S")}</td>'
                 f'<td class="mono">{esc(e["meter_id"] or "unknown")}</td>'
                 f'<td class="sev" style="--c:{c}">{esc(e["severity"].capitalize())}</td>'
                 f'<td>{esc(e["type"].replace("_", " "))}</td><td class="mut">{esc(e["reason"])}</td>'
                 f'<td>{esc(e["action"].capitalize())}</td><td class="mono mut">{esc(_txt(e.get("addr")))}</td>'
                 f'<td class="mono mut">#{int(e["id"])}</td></tr>')
    md(f'<div class="tblwrap"><table class="tbl"><thead><tr><th>Time</th><th>Meter</th><th>Severity</th><th>Event</th>'
       f'<th>Detail</th><th>Action</th><th>Source</th><th>ID</th></tr></thead><tbody>{rows}</tbody></table></div>')


def verdict_row(desc: str, v) -> str:
    col = {"ACCEPTED": OK, "FLAGGED": SEV_COL[v.severity], "REJECTED": BAD, "BLOCKED": ISO}[v.label]
    why = "<br>".join(f"{esc(f.type)}: {esc(f.reason)}" for f in v.findings[:4])
    if not why:
        why = "Signature valid, sequence fresh, readings within limits" if v.authenticated else "Readings within limits"
    if v.blocked:
        why = "Meter is isolated; packet ignored"
    if v.isolated_now:
        why += "<br><b>Gateway isolated this meter</b>"
    return (f'<div class="verdict" style="--c:{col}"><div class="vl">{v.label.capitalize()}</div>'
            f'<div><div class="vd">{esc(desc)}</div><div class="vr">{why}</div></div></div>')


def attack_card(info: dict) -> None:
    md(f'<div class="panel" style="height:132px"><div class="pn" style="font-size:15px">{esc(info["title"])}</div>'
       f'<div class="ps" style="margin-top:6px;color:#3d4653;font-size:13px">{esc(info["desc"])}</div>'
       f'<div class="ps" style="margin-top:8px">Expected: {esc(info["expect"])}</div></div>')
