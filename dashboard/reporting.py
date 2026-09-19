"""PDF incident report (ReportLab). Returns bytes so Streamlit can offer it as a download."""
from __future__ import annotations

import io
from datetime import datetime
from xml.sax.saxutils import escape

SEV_HEX = {"critical": "#e11d48", "high": "#ea580c", "medium": "#ca8a04", "low": "#2563eb", "info": "#64748b"}


def build_pdf(stats: dict, meters: dict, events) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=colors.HexColor("#0f172a"), fontSize=22, alignment=0)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=colors.HexColor("#0e7490"), spaceBefore=14)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9.5, leading=13)
    cell = ParagraphStyle("c", parent=ss["BodyText"], fontSize=7.5, leading=9.5)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="GridGuard Incident Report")
    el = [Paragraph("GridGuard — Incident Report", h1),
          Paragraph(f"Generated {datetime.now().strftime('%d %b %Y, %H:%M:%S')} · Simulated smart-grid lab environment", body),
          Spacer(1, 6), Paragraph("Executive summary", h2)]

    threat = {"SECURE": "Secure", "ELEVATED": "Elevated risk", "ATTACK": "Active threat"}[stats["threat"]]
    summ = [["Current posture", threat], ["Packets verified & accepted", f"{stats['accepted']:,}"],
            ["Packets rejected", f"{stats['rejected']:,}"], ["Packets blocked from isolated meters", f"{stats['blocked']:,}"],
            ["Security events logged", f"{stats['threats']:,}"], ["Meters isolated", str(stats["isolated"])]]
    t = Table(summ, colWidths=[75 * mm, 60 * mm])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#cbd5e1")),
                           ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")), ("PADDING", (0, 0), (-1, -1), 5)]))
    el += [t, Paragraph("Asset status", h2)]

    rows = [["Meter", "Site", "Status", "Accepted", "Rejected", "Blocked", "Score"]]
    for mid, m in meters.items():
        rows.append([f"{m['name']} ({mid})", m["site"], m["status"].upper(), m["accepted"], m["rejected"], m["blocked"], m["score"]])
    t = Table(rows, repeatRows=1)
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#cbd5e1")),
                           ("PADDING", (0, 0), (-1, -1), 4)]))
    el += [t, Paragraph("Most recent security events", h2)]

    if events.empty:
        el.append(Paragraph("No security events recorded.", body))
    else:
        rows = [["Time", "Meter", "Severity", "Type", "Reason", "Action", "Source"]]
        for _, e in events.head(40).iterrows():
            col = SEV_HEX.get(e["severity"], "#64748b")
            rows.append([e["dt"].strftime("%H:%M:%S"), Paragraph(escape(str(e["meter_id"] or "?")), cell),
                         Paragraph(f'<font color="{col}"><b>{escape(e["severity"].upper())}</b></font>', cell),
                         Paragraph(escape(e["type"]), cell), Paragraph(escape(e["reason"]), cell), e["action"],
                         Paragraph(escape(str(e.get("addr") or "-")), cell)])
        t = Table(rows, colWidths=[15 * mm, 18 * mm, 16 * mm, 30 * mm, 54 * mm, 15 * mm, 24 * mm], repeatRows=1)
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7.5), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                               ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), .3, colors.HexColor("#cbd5e1")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"), ("PADDING", (0, 0), (-1, -1), 3)]))
        el.append(t)
    el += [Spacer(1, 10), Paragraph("Controls in force: device allow-list · HMAC-SHA256 message authentication · sequence + timestamp replay "
                                    "protection · rate limiting · plausibility and threshold anomaly rules · automatic meter isolation.", body)]
    doc.build(el)
    return buf.getvalue()
