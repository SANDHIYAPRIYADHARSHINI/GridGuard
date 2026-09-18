import streamlit as st
import pandas as pd
from pathlib import Path

st.set_page_config(page_title="GridGuard Dashboard", layout="wide")
st.title("GridGuard — Smart Meter Security Dashboard")

LOG_FILE = Path(__file__).parent.parent / "logs" / "incident_log.csv"

st.header("Live Meter Status")
col1, col2 = st.columns(2)
with col1:
    st.metric("Meter A (MTR-001)", "Normal")
with col2:
    st.metric("Meter B (MTR-002)", "Normal")

st.header("Security Alerts")
if LOG_FILE.exists():
    df = pd.read_csv(LOG_FILE)
    st.dataframe(df)
else:
    st.info("No incidents recorded yet.")