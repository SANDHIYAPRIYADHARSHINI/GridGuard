"""
GridGuard dashboard

    streamlit run dashboard/app.py          # from the repo root

Reads the SQLite database the gateway writes (logs/gridguard.db). With "Use built-in simulator"
on, it also generates normal meter traffic itself, and the Attack simulation page sends test
packets straight into the gateway engine.
"""
import inspect
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402
import plotly.graph_objects as go  # noqa: E402
import streamlit as st  # noqa: E402

from dashboard import reporting, theme  # noqa: E402
from gateway import simulator as sim  # noqa: E402
from gateway.core import DB_PATH, LIMITS, METERS, SEV_RANK, GridGuardEngine  # noqa: E402

st.set_page_config(page_title="GridGuard", page_icon=None, layout="wide", initial_sidebar_state="expanded")
theme.inject()


@st.cache_resource
def get_engine() -> GridGuardEngine:
    return GridGuardEngine()


eng = get_engine()

PAGES = ["Overview", "Alerts", "Meters", "Attack simulation", "Reports"]


def _stretch(fn) -> dict:
    """Streamlit renamed use_container_width to width='stretch'; support both."""
    return {"width": "stretch"} if "width" in inspect.signature(fn).parameters else {"use_container_width": True}


def show_fig(fig: go.Figure, key: str) -> None:
    st.plotly_chart(fig, key=key, config={"displayModeBar": False}, **_stretch(st.plotly_chart))


def show_df(df: pd.DataFrame, **kw) -> None:
    st.dataframe(df, hide_index=True, **_stretch(st.dataframe), **kw)


# --------------------------------------------------------------------------- sidebar
with st.sidebar:
    theme.md('<div class="brand">GridGuard</div><div class="brand-sub">Smart meter monitoring</div>')
    page = st.radio("Navigation", PAGES, label_visibility="collapsed", key="page")

    theme.md('<div class="side-h">Data source</div>')
    sim_on = st.toggle("Use built-in simulator", value=True, key="sim_on",
                       help="On: the dashboard generates signed, normal telemetry for both meters. "
                            "Off: it only shows what an external gateway (gateway_r2.py) writes to the database.")

    theme.md('<div class="side-h">Refresh</div>')
    auto = st.toggle("Auto-refresh", value=True, key="auto")
    every = st.slider("Interval (seconds)", 1, 10, 2, key="every", disabled=not auto)

    theme.md('<div class="side-h">Gateway settings</div>')
    eng.auto_isolate = st.toggle("Auto-isolate faulty meters", value=True, key="auto_iso",
                                 help=f"Isolate a meter after {eng.auto_isolate_strikes} high/critical packets within {LIMITS['strike_window']:.0f}s.")
    eng.strict_hmac = st.toggle("Require signed packets", value=False, key="strict",
                                help="Off keeps the Review 1 Wokwi firmware (unsigned JSON) working. On rejects any packet without a valid HMAC.")
    theme.md(f'<div class="side-note">Database: {theme.esc(DB_PATH.name)}</div>')


# --------------------------------------------------------------------------- charts
def metric_chart(df: pd.DataFrame, col: str, title: str, unit: str, min_span: float, lines: list, key: str, floor0: bool = False) -> None:
    fig = go.Figure()
    for mid in METERS:
        d = df[df.meter_id == mid]
        if d.empty:
            continue
        c = theme.METER_COL[mid]
        fig.add_trace(go.Scatter(x=d.dt, y=d[col], name=METERS[mid]["name"], mode="lines", line=dict(color=c, width=1.8),
                                 hovertemplate="%{y:.2f} " + unit))
        bad = d[d.flagged == 1]
        if not bad.empty:
            fig.add_trace(go.Scatter(x=bad.dt, y=bad[col], mode="markers", showlegend=False, hoverinfo="skip",
                                     marker=dict(color="#b42318", size=8, symbol="x")))
    dmin, dmax = float(df[col].min()), float(df[col].max())
    half = max((dmax - dmin) / 2, min_span / 2) * 1.3
    lo, hi = (dmin + dmax) / 2 - half, (dmin + dmax) / 2 + half
    if floor0:
        lo = max(0.0, lo)
    for y, colr in lines:
        if lo <= y <= hi:
            fig.add_hline(y=y, line=dict(color=colr, width=1, dash="dash"), opacity=.8)
    fig.update_layout(
        title=dict(text=f"{title} ({unit})", x=0, font=dict(size=13, color="#1f2933")),
        height=260, margin=dict(l=8, r=8, t=40, b=8), hovermode="x unified", paper_bgcolor="#fff", plot_bgcolor="#fff",
        font=dict(color="#66707d", size=11), legend=dict(orientation="h", y=1.15, x=1, xanchor="right"),
        xaxis=dict(showgrid=False, tickformat="%H:%M:%S", linecolor="#d8dce2"),
        yaxis=dict(range=[lo, hi], gridcolor="#eceef1", zeroline=False))
    show_fig(fig, key)


def severity_bars(ev: pd.DataFrame, key: str) -> None:
    order = ["critical", "high", "medium", "low", "info"]
    cnt = ev.severity.value_counts().reindex(order).fillna(0)
    fig = go.Figure(go.Bar(x=[s.capitalize() for s in cnt.index], y=cnt.values, marker_color=[theme.SEV_COL[s] for s in cnt.index]))
    fig.update_layout(title=dict(text="Events by severity", x=0, font=dict(size=13, color="#1f2933")), height=240,
                      margin=dict(l=8, r=8, t=40, b=8), paper_bgcolor="#fff", plot_bgcolor="#fff", font=dict(color="#66707d", size=11),
                      yaxis=dict(gridcolor="#eceef1"), xaxis=dict(showgrid=False))
    show_fig(fig, key)


def type_bars(ev: pd.DataFrame, key: str) -> None:
    top = ev.type.value_counts().head(7).iloc[::-1]
    fig = go.Figure(go.Bar(x=top.values, y=[t.replace("_", " ") for t in top.index], orientation="h", marker_color="#1d4ed8"))
    fig.update_layout(title=dict(text="Most frequent events", x=0, font=dict(size=13, color="#1f2933")), height=240,
                      margin=dict(l=8, r=8, t=40, b=8), paper_bgcolor="#fff", plot_bgcolor="#fff", font=dict(color="#66707d", size=11),
                      xaxis=dict(gridcolor="#eceef1"), yaxis=dict(showgrid=False))
    show_fig(fig, key)


def timeline(ev: pd.DataFrame, key: str) -> None:
    d = ev.copy()
    d["bucket"] = d.dt.dt.floor("30s")
    piv = d.groupby(["bucket", "severity"]).size().unstack(fill_value=0)
    fig = go.Figure()
    for s in ["info", "low", "medium", "high", "critical"]:
        if s in piv:
            fig.add_trace(go.Bar(x=piv.index, y=piv[s], name=s.capitalize(), marker_color=theme.SEV_COL[s]))
    fig.update_layout(barmode="stack", title=dict(text="Events over time (30 s buckets)", x=0, font=dict(size=13, color="#1f2933")),
                      height=240, margin=dict(l=8, r=8, t=40, b=8), paper_bgcolor="#fff", plot_bgcolor="#fff",
                      font=dict(color="#66707d", size=11), legend=dict(orientation="h", y=1.15, x=1, xanchor="right"),
                      xaxis=dict(showgrid=False, tickformat="%H:%M"), yaxis=dict(gridcolor="#eceef1"))
    show_fig(fig, key)


# --------------------------------------------------------------------------- pages
def page_overview(stats, meters, ev):
    theme.stats_row([
        ("Meters online", f"{stats['online']}", f"of {len(METERS)}", f"{stats['isolated']} isolated"),
        ("Grid load", f"{stats['load_kw']:.2f}", "kW", "online meters combined"),
        ("Packets accepted", f"{stats['accepted']:,}", "", "signature and sequence checked"),
        ("Alerts logged", f"{stats['threats']:,}", "", f"{stats['rejected']:,} packet{'' if stats['rejected'] == 1 else 's'} rejected"),
        ("Packets blocked", f"{stats['blocked']:,}", "", "from isolated meters"),
    ])
    theme.section("Meters")
    for col, (mid, m) in zip(st.columns(2, gap="medium"), meters.items()):
        with col:
            theme.meter_card(mid, m)

    theme.section("Live readings")
    win = st.radio("Time range", ["1 min", "5 min", "15 min", "1 hour"], index=1, horizontal=True, key="win", label_visibility="collapsed")
    df = eng.telemetry_df(since_seconds={"1 min": 60, "5 min": 300, "15 min": 900, "1 hour": 3600}[win])
    if df.empty:
        theme.empty("No telemetry yet. Turn on the simulator or start gateway_r2.py.")
    else:
        L = LIMITS
        c1, c2 = st.columns(2, gap="medium")
        with c1:
            metric_chart(df, "power_kw", "Power", "kW", .5, [(L["pow_warn"], "#a16207"), (L["pow_crit"], "#b42318")], "c_pw", floor0=True)
            metric_chart(df, "current_a", "Current", "A", 1.5, [(L["cur_warn"], "#a16207"), (L["cur_crit"], "#b42318")], "c_cu", floor0=True)
        with c2:
            metric_chart(df, "voltage_v", "Voltage", "V", 12,
                         [(L["volt_warn"][0], "#a16207"), (L["volt_warn"][1], "#a16207"), (L["volt_crit"][0], "#b42318"), (L["volt_crit"][1], "#b42318")], "c_vo")
            metric_chart(df, "temp_c", "Temperature", "°C", 6, [(L["temp_warn"], "#a16207"), (L["temp_crit"], "#b42318")], "c_te")
        metric_chart(df, "energy_wh", "Energy metered (cumulative)", "Wh", 2, [], "c_en", floor0=True)
        theme.note("Dashed lines show the warning (amber) and critical (red) limits once readings get close to them. A red x marks a reading the gateway flagged.")

    theme.section("Recent events")
    if ev.empty:
        theme.empty("No events recorded.")
    else:
        theme.event_table(ev.head(6))


def page_alerts(stats, meters, ev):
    if ev.empty:
        theme.empty("No events recorded. Use the Attack simulation page to generate some.")
        return
    ev = ev.assign(meter_id=ev.meter_id.fillna("unknown"))
    f1, f2, f3 = st.columns([2, 1.3, 1.3])
    sev_all = ["critical", "high", "medium", "low", "info"]
    sev_sel = f1.multiselect("Severity", sev_all, default=sev_all, key="f_sev")
    meter_opts = sorted(ev.meter_id.unique())
    meter_sel = f2.multiselect("Meter", meter_opts, default=meter_opts, key="f_meter")
    act_opts = sorted(ev.action.unique())
    act_sel = f3.multiselect("Action", act_opts, default=act_opts, key="f_act")
    d = ev[ev.severity.isin(sev_sel) & ev.meter_id.isin(meter_sel) & ev.action.isin(act_sel)]

    theme.stats_row([
        ("Critical", str((d.severity == "critical").sum()), "", "events"),
        ("High", str((d.severity == "high").sum()), "", "events"),
        ("Medium", str((d.severity == "medium").sum()), "", "events"),
        ("Rejected", str((d.action == "rejected").sum()), "", "packets"),
        ("Isolations", str((d.action == "isolated").sum()), "", "meters"),
    ])
    if d.empty:
        theme.empty("No events match the current filters.")
        return

    theme.section("Latest events")
    theme.event_table(d.head(15))

    theme.section("Summary")
    c1, c2, c3 = st.columns(3, gap="medium")
    with c1:
        severity_bars(d, "al_sev")
    with c2:
        type_bars(d, "al_types")
    with c3:
        timeline(d, "al_time")

    theme.section("Event details")
    ids = list(d.head(40).id)
    by_id = d.set_index("id")
    pick = st.selectbox("Event", ids, key="ev_pick", format_func=lambda i: f"#{i}  {by_id.loc[i, 'severity']}  {by_id.loc[i, 'type']}")
    row = by_id.loc[pick]
    c1, c2 = st.columns([1, 1.4])
    with c1:
        st.write({"id": int(pick), "time": str(row["dt"]), "meter": row.meter_id, "severity": row.severity, "type": row.type,
                  "action": row.action, "source": row.source, "from": row.get("addr"),
                  "meter state at the time": row.get("meter_state")})
        st.caption(row.reason)
    with c2:
        st.code(sim.pretty(row.raw) if row.raw else "(no packet attached to this event)", language="json")

    with st.expander("All events"):
        show_df(d.rename(columns={"dt": "time"})[["id", "time", "meter_id", "severity", "type", "reason", "action", "source", "addr", "meter_state"]].head(300), height=320)


def page_meters(stats, meters, ev):
    for col, (mid, m) in zip(st.columns(2, gap="medium"), meters.items()):
        with col:
            theme.asset_card(mid, m)
            if m["status"] == "isolated":
                st.button("Restore to service", key=f"rs_{mid}", on_click=eng.restore, args=(mid,))
            else:
                st.button("Isolate this meter", key=f"iso_{mid}", type="primary", on_click=eng.isolate, args=(mid,))

    theme.section("Unregistered devices seen")
    rogue = ev[ev.type == "unauthorized_device"]
    if rogue.empty:
        theme.empty("No unregistered devices have tried to connect.")
    else:
        g = rogue.groupby("meter_id").agg(attempts=("id", "count"), first_seen=("dt", "min"), last_seen=("dt", "max"),
                                          source=("addr", "first")).reset_index()
        show_df(g)

    theme.section("Gateway rules")
    L = LIMITS
    rules = [
        ("Device allow-list", "Only registered meter IDs may send telemetry", "Critical", "Reject"),
        ("Message signature", "HMAC-SHA256 over every field, one key per meter", "Critical", "Reject"),
        ("Replay protection", f"Sequence must increase; timestamp within {L['max_skew']:.0f} s", "High", "Reject"),
        ("Rate limit", f"More than {L['rate_max']} packets in {L['rate_window']:.0f} s", "High", "Reject"),
        ("Sensor range", f"Voltage {L['volt_abs'][0]:.0f}-{L['volt_abs'][1]:.0f} V, current up to {L['cur_abs'][1]:.0f} A, temperature {L['temp_abs'][0]:.0f} to {L['temp_abs'][1]:.0f} °C", "Critical", "Reject"),
        ("Voltage", f"Warn outside {L['volt_warn'][0]:.0f}-{L['volt_warn'][1]:.0f} V, critical outside {L['volt_crit'][0]:.0f}-{L['volt_crit'][1]:.0f} V", "Medium / Critical", "Flag"),
        ("Current", f"Warn above {L['cur_warn']} A, critical above {L['cur_crit']} A", "Medium / Critical", "Flag"),
        ("Temperature", f"Warn above {L['temp_warn']:.0f} °C, critical above {L['temp_crit']:.0f} °C", "Medium / Critical", "Flag"),
        ("Power", f"Warn above {L['pow_warn']} kW, critical above {L['pow_crit']} kW", "Medium / Critical", "Flag"),
        ("Power consistency", "Reported kW cannot exceed voltage x current", "High", "Flag"),
        ("Energy rollback", "Cumulative energy reading may not go down", "High", "Flag"),
        ("Sudden spike", f"Power above {L['spike_factor']}x the recent average", "Medium", "Flag"),
        ("Meter self-alert", "Meter sends alert = true", "Medium", "Flag"),
        ("Auto-isolation", f"{eng.auto_isolate_strikes} high/critical packets within {L['strike_window']:.0f} s", "-", "Isolate meter"),
    ]
    show_df(pd.DataFrame(rules, columns=["Rule", "Condition", "Severity", "Action"]), height=35 * (len(rules) + 1) + 3)


def do_attack(kind: str, target: str) -> None:
    st.session_state["lab"] = dict(title=sim.ATTACKS.get(kind, {}).get("title", "Normal packet"), target=target,
                                   rows=sim.run_attack(eng, kind, target))


def do_paste() -> None:
    lines = [ln for ln in st.session_state.get("paste", "").splitlines() if ln.strip()]
    st.session_state["lab"] = dict(title="Pasted serial lines", target="-",
                                   rows=[(ln[:90], eng.ingest(ln, source="serial-paste", addr="pasted-line")) for ln in lines])


def do_reset() -> None:
    eng.reset()
    st.session_state.pop("lab", None)
    st.session_state.pop("pdf", None)


def page_lab(stats, meters, ev):
    theme.note("Sends test packets straight into the gateway engine. Nothing leaves this machine and no real device is touched.")
    target = st.radio("Target meter", list(METERS), format_func=lambda m: f"{METERS[m]['name']} ({m})", index=1, horizontal=True, key="target")
    cards = list(sim.ATTACKS.items()) + [("normal", dict(title="Normal packet", desc="A correctly signed reading within limits, for comparison.",
                                                       expect="Accepted, no alert"))]
    for i in range(0, len(cards), 3):
        for col, (k, info) in zip(st.columns(3, gap="medium"), cards[i:i + 3]):
            with col:
                theme.attack_card(info)
                st.button("Run", key=f"atk_{k}", on_click=do_attack, args=(k, target))

    theme.section("Gateway response")
    lab = st.session_state.get("lab")
    if not lab:
        theme.empty("Run a simulation to see how the gateway responds.")
    else:
        theme.note(f"Last run: {lab['title']}, target {lab['target']}")
        theme.md("".join(theme.verdict_row(d, v) for d, v in lab["rows"]))

    theme.section("Send serial output from Wokwi")
    theme.note("Paste one or more JSON lines from a Wokwi serial monitor. The Review 1 firmware format works as-is.")
    st.text_area("Serial lines", key="paste", height=100, label_visibility="collapsed",
                 placeholder='{"meter_id":"MTR-002","temp_c":45.0,"voltage_v":250.0,"current_a":9.5,"power_kw":2.38,"alert":true}')
    st.button("Send to gateway", key="send_paste", on_click=do_paste)


def page_reports(stats, meters, ev):
    label = {"SECURE": "Normal", "ELEVATED": "Warning", "ATTACK": "Alert"}[stats["threat"]]
    theme.stats_row([
        ("Status", label, "", "based on the last 2 minutes"),
        ("Packets accepted", f"{stats['accepted']:,}", "", "verified"),
        ("Packets rejected", f"{stats['rejected']:,}", "", "failed validation"),
        ("Alerts logged", f"{stats['threats']:,}", "", "flagged or rejected"),
        ("Meters isolated", f"{stats['isolated']}", "", "currently"),
    ])
    theme.section("Export")
    c1, c2, c3 = st.columns(3, gap="medium")
    ev_csv = ev.drop(columns=["ts"]).to_csv(index=False).encode() if not ev.empty else b"id\n"
    c1.download_button("Download events (CSV)", ev_csv, "gridguard_events.csv", "text/csv", key="dl_ev")
    tel = eng.telemetry_df(limit=5000)
    c2.download_button("Download telemetry (CSV)", tel.drop(columns=["ts", "raw"]).to_csv(index=False).encode() if not tel.empty else b"id\n",
                       "gridguard_telemetry.csv", "text/csv", key="dl_tel")
    if c3.button("Create PDF report", key="mk_pdf"):
        try:
            st.session_state["pdf"] = reporting.build_pdf(stats, meters, ev)
        except ImportError:
            st.error("PDF export needs ReportLab: pip install reportlab")
    if st.session_state.get("pdf"):
        st.download_button("Download PDF report", st.session_state["pdf"], "gridguard_incident_report.pdf", "application/pdf", key="dl_pdf")

    theme.section("Reset")
    st.checkbox("Delete all telemetry and events", key="confirm_reset")
    st.button("Reset data", key="reset", type="primary", disabled=not st.session_state.get("confirm_reset"), on_click=do_reset)


PAGE_FN = {"Overview": page_overview, "Alerts": page_alerts, "Meters": page_meters, "Attack simulation": page_lab, "Reports": page_reports}


def render():
    if sim_on:
        sim.tick(eng)
    stats, meters = eng.stats(), eng.meters_state()
    ev = eng.events_df(limit=1500)
    theme.header(page, stats)
    hot = None
    if not ev.empty:
        recent = ev[(ev.ts >= time.time() - 120) & ev.action.isin(["flagged", "rejected"]) & (ev.severity.map(SEV_RANK) >= 2)]
        if not recent.empty:
            hot = recent.assign(_r=recent.severity.map(SEV_RANK)).sort_values(["_r", "id"], ascending=False).iloc[0].to_dict()
    theme.banner(stats, hot)
    PAGE_FN[page](stats, meters, ev)


st.fragment(run_every=(every if auto else None))(render)()
