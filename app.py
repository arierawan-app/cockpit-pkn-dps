#!/usr/bin/env python3
"""
Dashboard Intelijen Aset BMN — KPKNL Denpasar
Streamlit + DuckDB + Parquet — refactored for security, robustness, and performance.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
import folium
import pandas as pd
import plotly.express as px
import streamlit as st
from streamlit_folium import st_folium

# ── CONFIG ──────────────────────────────────────────────────────────────────

CONFIG: dict[str, Any] = {
    "page_title": "Dashboard Aset BMN",
    "page_icon": "🏛️",
    "layout": "wide",
    "sidebar_title": "🏛️ Dashboard Aset BMN",
    "sidebar_subtitle": "**KPKNL Denpasar**",
    "default_location": [-8.45, 115.075],
    "map_zoom": 9,
    "tiles": "CartoDB positron",
    "map_width": 500,
    "map_height": 400,
    "nup_map_width": 500,
    "nup_map_height": 400,
    "bali_bounds": [[-8.85, 114.40], [-8.05, 115.75]],
    "marker_color": "#d62728",
    "fallback_color": "#1f77b4",
    "chunk_size": 50_000,
    "max_rows_read": 99_999_999,
    "max_cols_read": 100,
}

GOLONGAN_SORT: list[str] = [
    "TANAH",
    "PERALATAN DAN MESIN",
    "GEDUNG DAN BANGUNAN",
    "JALAN, IRIGASI DAN JARINGAN",
    "ASET TETAP LAINNYA",
    "KONSTRUKSI DALAM PENGERJAAN",
    "ASET TAK BERWUJUD",
    "TIDAK DIKENAL",
]

GOLONGAN_ORDER_SQL: str = (
    "CASE golongan_bmn "
    + " ".join(f"WHEN '{g}' THEN {i}" for i, g in enumerate(GOLONGAN_SORT))
    + " END"
)

BALI_CENTERS: dict[str, tuple[float, float]] = {
    "KAB. BADUNG": (-8.5819, 115.1775),
    "KAB. BANGLI": (-8.4543, 115.3547),
    "KAB. BULELENG": (-8.1852, 114.9367),
    "KAB. GIANYAR": (-8.5439, 115.3268),
    "KAB. JEMBRANA": (-8.3147, 114.5901),
    "KAB. KARANGASEM": (-8.4095, 115.6114),
    "KAB. KLUNGKUNG": (-8.5627, 115.4207),
    "KAB. TABANAN": (-8.5437, 115.0576),
    "KOTA DENPASAR": (-8.6529, 115.2196),
}

KAB_CLEAN_MAP: dict[str, str] = {
    "badung": "KAB. BADUNG", "kab badung": "KAB. BADUNG", "kabupaten badung": "KAB. BADUNG",
    "bangli": "KAB. BANGLI", "kab bangli": "KAB. BANGLI",
    "buleleng": "KAB. BULELENG", "kab buleleng": "KAB. BULELENG",
    "gianyar": "KAB. GIANYAR", "kab gianyar": "KAB. GIANYAR",
    "jembrana": "KAB. JEMBRANA", "kab jembrana": "KAB. JEMBRANA",
    "karangasem": "KAB. KARANGASEM", "kab karangasem": "KAB. KARANGASEM",
    "klungkung": "KAB. KLUNGKUNG", "kab klungkung": "KAB. KLUNGKUNG",
    "tabanan": "KAB. TABANAN", "kab tabanan": "KAB. TABANAN",
    "denpasar": "KOTA DENPASAR", "kota denpasar": "KOTA DENPASAR",
    "deanpasar": "KOTA DENPASAR",
    "semarapura": "KAB. KLUNGKUNG",
    "mangupura": "KAB. BADUNG",
    "kuta": "KAB. BADUNG",
}

REQUIRED_COLUMNS: list[str] = [
    "nomor", "jenis_bmn", "kode_satker", "nama_satker", "kode_barang",
    "nup", "golongan_bmn", "nilai_perolehan", "nilai_buku", "kab_kota",
]

# ── HELPERS ─────────────────────────────────────────────────────────────────

def fmt_rupiah(val: float | None) -> str:
    """Format angka ke string Rupiah dengan satuan T/M/Jt."""
    if val is None or val == 0:
        return "-"
    abs_val = abs(val)
    if abs_val >= 1_000_000_000_000:
        return f"Rp {val / 1_000_000_000_000:,.2f} T"
    if abs_val >= 1_000_000_000:
        return f"Rp {val / 1_000_000_000:,.2f} M"
    if abs_val >= 1_000_000:
        return f"Rp {val / 1_000_000:,.2f} Jt"
    return f"Rp {val:,.0f}"


def clean_kab(name: str | None) -> str | None:
    """Bersihkan dan normalisasi nama Kabupaten/Kota dari data mentah."""
    if name is None:
        return None
    n = str(name).strip().lower()
    if n in KAB_CLEAN_MAP:
        return KAB_CLEAN_MAP[n]
    n_norm = n.replace(".", "").replace("kab ", "").replace("kota ", "").strip()
    nmap: dict[str, str] = {
        "badung": "KAB. BADUNG", "bangli": "KAB. BANGLI",
        "buleleng": "KAB. BULELENG", "gianyar": "KAB. GIANYAR",
        "jembrana": "KAB. JEMBRANA", "karangasem": "KAB. KARANGASEM",
        "klungkung": "KAB. KLUNGKUNG", "tabanan": "KAB. TABANAN",
        "denpasar": "KOTA DENPASAR", "bali": "KOTA DENPASAR",
    }
    if n_norm in nmap:
        return nmap[n_norm]
    return str(name).strip().upper()


def build_where(params: dict[str, Any], con: duckdb.DuckDBPyConnection) -> tuple[str, list[Any]]:
    """Bangun WHERE clause aman dengan parameterized queries."""
    clauses: list[str] = []
    bindings: list[Any] = []

    keys = [
        ("golongan_bmn", "pilihan_golongan"),
        ("jenis_bmn", "pilihan_jenis"),
        ("nama_satker", "pilihan_satker"),
    ]
    for col, key in keys:
        vals = params.get(key, [])
        if vals:
            placeholders = ",".join(["?" for _ in vals])
            clauses.append(f"{col} IN ({placeholders})")
            bindings.extend(vals)

    pilihan_kl = params.get("pilihan_kl", [])
    satker_detail_path = params.get("satker_detail_path")
    if pilihan_kl and satker_detail_path and Path(satker_detail_path).exists():
        kl_placeholders = ",".join(["?" for _ in pilihan_kl])
        clauses.append(
            f"nama_satker IN (SELECT \"Nama Satker\" FROM read_parquet('{satker_detail_path}') "
            f"WHERE \"Nama K/L\" IN ({kl_placeholders}))"
        )
        bindings.extend(pilihan_kl)

    return (" AND ".join(clauses), bindings) if clauses else ("", bindings)


def _safe_query(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> pd.DataFrame:
    """Jalankan query DuckDB dengan parameter binding, return DataFrame."""
    try:
        if params:
            return con.execute(sql, params).df()
        return con.execute(sql).df()
    except Exception:
        return pd.DataFrame()


def _render_map(
    df_agg: pd.DataFrame,
    kab_col: str,
    val_col: str,
    popup_label: str,
    radius_scaler: float = 600.0,
    nup_mode: bool = True,
) -> folium.Map:
    """Render peta Bali dengan CircleMarker berdasarkan agregasi data."""
    m = folium.Map(
        location=CONFIG["default_location"],
        zoom_start=CONFIG["map_zoom"],
        tiles=CONFIG["tiles"],
        zoom_control=False,
        scrollWheelZoom=False,
        dragging=False,
        doubleClickZoom=False,
    )
    m.fit_bounds(CONFIG["bali_bounds"])

    for _, row in df_agg.iterrows():
        kab = row[kab_col]
        val = float(row[val_col]) if row[val_col] else 0
        if kab not in BALI_CENTERS:
            continue
        radius = max(val / radius_scaler + 8, 10) if nup_mode else 16
        if nup_mode:
            popup = f"<b>{kab}</b><br>{popup_label}: {int(val):,}"
        else:
            popup = f"<b>{kab}</b><br>{popup_label}: <b>{int(val)}</b>"
        folium.CircleMarker(
            location=BALI_CENTERS[kab],
            radius=radius,
            popup=folium.Popup(popup, max_width=280),
            color=CONFIG["marker_color"],
            fill=True,
            fill_color=CONFIG["marker_color"],
            fill_opacity=0.6,
            weight=2,
        ).add_to(m)
    return m


# ── STREAMLIT ───────────────────────────────────────────────────────────────

st.set_page_config(
    page_title=CONFIG["page_title"],
    page_icon=CONFIG["page_icon"],
    layout=CONFIG["layout"],
    initial_sidebar_state="expanded",
)


@st.cache_resource
def init_duckdb(parquet_path: str) -> duckdb.DuckDBPyConnection:
    """Inisialisasi koneksi DuckDB dan buat VIEW master_aset."""
    con = duckdb.connect(database=":memory:")
    try:
        con.execute(f"CREATE VIEW master_aset AS SELECT * FROM read_parquet('{parquet_path}')")
    except Exception as e:
        st.error(f"Gagal membaca file Parquet: {e}")
    return con


def main() -> None:
    """Fungsi utama dashboard."""
    BASE_DIR = Path(__file__).resolve().parent
    CACHE_DIR = BASE_DIR / "data_cache"
    PARQUET_FILE = CACHE_DIR / "master_aset_bali.parquet"
    SATKER_DETAIL_PATH = str(CACHE_DIR / "satker_detail.parquet")
    SATKER_DETAIL_EXISTS = Path(SATKER_DETAIL_PATH).exists()

    if not PARQUET_FILE.exists():
        st.error("❌ File Parquet tidak ditemukan!")
        st.markdown(f"""
        **Langkah:**
        1. Letakkan file Excel ke `input_data/`
        2. Jalankan `python pipeline.py`
        3. Refresh halaman.

        📂 `{PARQUET_FILE}`
        """)
        return

    con = init_duckdb(str(PARQUET_FILE))

    # ── SCHEMA VALIDATION ──
    try:
        existing_cols = [c[0] for c in con.execute("SELECT * FROM master_aset LIMIT 0").description]
        missing = [c for c in REQUIRED_COLUMNS if c not in existing_cols]
        if missing:
            st.warning(f"⚠️ Kolom tidak ditemukan: {', '.join(missing)}. Beberapa fitur mungkin tidak berfungsi.")
    except Exception:
        st.warning("⚠️ Gagal memvalidasi skema data.")

    # ── SIDEBAR ──
    with st.sidebar:
        st.title(CONFIG["sidebar_title"])
        st.caption(CONFIG["sidebar_subtitle"])
        st.markdown("---")
        st.subheader("🔍 Filter Data")

        golongan_list_query = (
            "SELECT DISTINCT golongan_bmn FROM master_aset "
            "WHERE golongan_bmn IS NOT NULL ORDER BY " + GOLONGAN_ORDER_SQL
        )
        golongan_list = _safe_query(con, golongan_list_query)
        pilihan_golongan = st.multiselect(
            "Golongan BMN",
            options=golongan_list.iloc[:, 0].tolist() if not golongan_list.empty else [],
            default=None,
            placeholder="Semua golongan...",
        )

        jenis_list = _safe_query(con, "SELECT DISTINCT jenis_bmn FROM master_aset WHERE jenis_bmn IS NOT NULL ORDER BY jenis_bmn")
        pilihan_jenis = st.multiselect(
            "Jenis BMN",
            options=jenis_list.iloc[:, 0].tolist() if not jenis_list.empty else [],
            default=None,
            placeholder="Semua jenis...",
        )

        if SATKER_DETAIL_EXISTS:
            kl_list = _safe_query(con, f"SELECT DISTINCT \"Nama K/L\" FROM read_parquet('{SATKER_DETAIL_PATH}') ORDER BY \"Nama K/L\"")
            pilihan_kl = st.multiselect(
                "K/L",
                options=kl_list.iloc[:, 0].tolist() if not kl_list.empty else [],
                default=None,
                placeholder="Semua K/L...",
            )
        else:
            pilihan_kl = []

        satker_list = _safe_query(con, "SELECT DISTINCT nama_satker FROM master_aset WHERE nama_satker IS NOT NULL ORDER BY nama_satker")
        pilihan_satker = st.multiselect(
            "Satuan Kerja",
            options=satker_list.iloc[:, 0].tolist() if not satker_list.empty else [],
            default=None,
            placeholder="Semua satker...",
        )

        st.markdown("---")
        st.caption(f"📂 `{PARQUET_FILE.name}`")
        st.caption("⚡ DuckDB + Parquet")

    # ── BUILD WHERE ──
    where_clause, where_bindings = build_where(
        {
            "pilihan_golongan": pilihan_golongan,
            "pilihan_jenis": pilihan_jenis,
            "pilihan_kl": pilihan_kl,
            "pilihan_satker": pilihan_satker,
            "satker_detail_path": SATKER_DETAIL_PATH,
        },
        con,
    )

    def _query(sql_template: str, extra_bindings: list[Any] | None = None) -> pd.DataFrame:
        sql = sql_template.replace("{where_and}", (" AND " + where_clause) if where_clause else "")
        if where_clause:
            sql = sql.replace("{where}", "WHERE " + where_clause)
        else:
            sql = sql.replace("{where}", "")
        bindings = list(where_bindings)
        if extra_bindings:
            bindings.extend(extra_bindings)
        return _safe_query(con, sql, bindings if bindings else None)

    # ── METRIC CARDS ──
    total_aset = _query("SELECT COUNT(*) as v FROM master_aset {where}").iloc[0, 0] if _query("SELECT COUNT(*) as v FROM master_aset {where}").shape[0] > 0 else 0
    total_np = _query("SELECT COALESCE(SUM(nilai_perolehan), 0) as v FROM master_aset {where}")
    total_nb = _query("SELECT COALESCE(SUM(nilai_buku), 0) as v FROM master_aset {where}")

    where_satker_only, bindings_satker = build_where(
        {"pilihan_golongan": [], "pilihan_jenis": [], "pilihan_kl": pilihan_kl,
         "pilihan_satker": pilihan_satker, "satker_detail_path": SATKER_DETAIL_PATH}, con)
    total_satker_sql = ("SELECT COUNT(DISTINCT nama_satker) as v FROM master_aset WHERE nama_satker IS NOT NULL"
                        + ((" AND " + where_satker_only) if where_satker_only else ""))
    total_satker_raw = _safe_query(con, total_satker_sql, bindings_satker if where_satker_only else None)

    total_nilai_perolehan = total_np.iloc[0, 0] if not total_np.empty else 0
    total_nilai_buku = total_nb.iloc[0, 0] if not total_nb.empty else 0
    jml_satker_filtered = int(total_satker_raw.iloc[0, 0]) if not total_satker_raw.empty else 0

    st.title("🏛️ Dashboard Aset BMN")
    st.caption("📡 Sumber data: SIMAN per 19 Juli 2026")

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("📦 Total Aset", f"{int(total_aset):,}")
    with col2:
        st.metric("💰 Total Nilai Perolehan", fmt_rupiah(total_nilai_perolehan))
    with col3:
        st.metric("📖 Total Nilai Buku", fmt_rupiah(total_nilai_buku))
    with col4:
        st.metric("🏢 Satuan Kerja", f"{jml_satker_filtered:,}")

    st.markdown("---")

    # ── MAIN SUMMARY ──
    df_golongan = _query(f"""
        SELECT golongan_bmn, COUNT(*) as jumlah_aset,
               COALESCE(SUM(nilai_perolehan), 0) as total_nilai_perolehan,
               COALESCE(SUM(nilai_buku), 0) as total_nilai_buku
        FROM master_aset {{where}}
        GROUP BY golongan_bmn
        ORDER BY {GOLONGAN_ORDER_SQL}
    """)

    col_a, col_b = st.columns([1.2, 1.8])
    with col_a:
        st.subheader("📊 Ringkasan per Golongan")
        if not df_golongan.empty:
            df_display = df_golongan.copy()
            df_display["Jumlah Aset"] = df_display["jumlah_aset"].apply(lambda x: f"{int(x):,}")
            df_display["Total Nilai Perolehan"] = df_display["total_nilai_perolehan"].apply(fmt_rupiah)
            df_display["Total Nilai Buku"] = df_display["total_nilai_buku"].apply(fmt_rupiah)

            total_row = pd.DataFrame([{
                "golongan_bmn": "TOTAL",
                "Jumlah Aset": f"{int(total_aset):,}",
                "Total Nilai Perolehan": fmt_rupiah(total_nilai_perolehan),
                "Total Nilai Buku": fmt_rupiah(total_nilai_buku),
            }])
            df_display = pd.concat([
                df_display[["golongan_bmn", "Jumlah Aset", "Total Nilai Perolehan", "Total Nilai Buku"]],
                total_row,
            ], ignore_index=True)

            st.dataframe(df_display, hide_index=True, use_container_width=True, height=320,
                         column_config={"golongan_bmn": "Golongan BMN"})
        else:
            st.info("Tidak ada data.")

    with col_b:
        st.subheader("📈 Grafik Jumlah Aset per Golongan")
        if not df_golongan.empty:
            fig = px.bar(df_golongan, x="golongan_bmn", y="jumlah_aset", color="golongan_bmn",
                         title="Jumlah Aset per Golongan BMN",
                         labels={"golongan_bmn": "Golongan BMN", "jumlah_aset": "Jumlah Aset"}, height=380)
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="%{y:,.0f} aset<extra></extra>")
            st.plotly_chart(fig)
        else:
            st.info("Tidak ada data.")

    st.markdown("---")

    # ── NILAI PER GOLONGAN ──
    col_n1, col_n2 = st.columns(2)
    with col_n1:
        st.subheader("💰 Nilai Perolehan per Golongan")
        if not df_golongan.empty:
            fig = px.bar(df_golongan, x="golongan_bmn", y="total_nilai_perolehan", color="golongan_bmn",
                         title="Total Nilai Perolehan per Golongan (Rp)",
                         labels={"golongan_bmn": "Golongan BMN", "total_nilai_perolehan": "Nilai Perolehan"}, height=400)
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="Rp %{y:,.0f}<extra></extra>")
            st.plotly_chart(fig)

    with col_n2:
        st.subheader("📖 Nilai Buku per Golongan")
        if not df_golongan.empty:
            fig = px.bar(df_golongan, x="golongan_bmn", y="total_nilai_buku", color="golongan_bmn",
                         title="Total Nilai Buku per Golongan (Rp)",
                         labels={"golongan_bmn": "Golongan BMN", "total_nilai_buku": "Nilai Buku"}, height=400)
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="Rp %{y:,.0f}<extra></extra>")
            st.plotly_chart(fig)

    st.markdown("---")

    # ── JENIS BMN + NUP MAP ──
    col_chart, col_map = st.columns(2)
    with col_chart:
        st.subheader("Distribusi per Jenis BMN")
        df_jenis = _query("""
            SELECT jenis_bmn, COUNT(*) as jumlah FROM master_aset {where}
            GROUP BY jenis_bmn ORDER BY jumlah DESC
        """)
        if not df_jenis.empty:
            fig = px.bar(df_jenis, x="jenis_bmn", y="jumlah", color="jenis_bmn",
                         title="Jumlah Aset per Jenis BMN",
                         labels={"jenis_bmn": "Jenis BMN", "jumlah": "Jumlah Aset"}, height=400)
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="%{y:,.0f} aset<extra></extra>")
            st.plotly_chart(fig)

    with col_map:
        st.subheader("🗺️ Peta Sebaran NUP per Kabupaten/Kota")
        df_map = _query("""
            SELECT kab_kota as kab_raw, COUNT(*) as jumlah_aset,
                   COALESCE(SUM(nilai_perolehan), 0) as total_nilai
            FROM master_aset
            WHERE kab_kota IS NOT NULL {where_and}
            GROUP BY kab_kota
        """)
        if not df_map.empty:
            df_map["kab_clean"] = df_map["kab_raw"].apply(clean_kab)
            df_map = df_map[df_map["kab_clean"].isin(BALI_CENTERS.keys())]
            df_agg = df_map.groupby("kab_clean", as_index=False).agg({"jumlah_aset": "sum", "total_nilai": "sum"})
            m3 = _render_map(df_agg, "kab_clean", "jumlah_aset", "Jumlah NUP", radius_scaler=600.0, nup_mode=True)
            st_folium(m3, width=CONFIG["nup_map_width"], height=CONFIG["nup_map_height"])
        else:
            st.info("Tidak ada data peta.")

    st.markdown("---")

    # ── TOP 20 ──
    col_top1, col_top2 = st.columns(2)
    with col_top1:
        top_unit = st.selectbox("Top 20:", options=["Satuan Kerja", "K/L"])
    with col_top2:
        top_filter = st.selectbox("Kategori:", options=["Nilai Perolehan", "Jumlah BMN"])

    df_top = pd.DataFrame()
    label_y = ""
    label_x = ""
    title_top = ""

    if top_unit == "K/L" and SATKER_DETAIL_EXISTS:
        if top_filter == "Nilai Perolehan":
            df_top = _safe_query(con, f"""
                SELECT \"Nama K/L\" as nama, COALESCE(SUM(m.nilai_perolehan), 0) as total_nilai
                FROM read_parquet('{SATKER_DETAIL_PATH}') s
                JOIN master_aset m ON s.\"Nama Satker\" = m.nama_satker
                GROUP BY \"Nama K/L\" ORDER BY total_nilai DESC LIMIT 20
            """)
            label_x = "Nilai Perolehan (Rp)"
        else:
            df_top = _safe_query(con, f"""
                SELECT \"Nama K/L\" as nama, COUNT(m.nomor) as total_nilai
                FROM read_parquet('{SATKER_DETAIL_PATH}') s
                JOIN master_aset m ON s.\"Nama Satker\" = m.nama_satker
                GROUP BY \"Nama K/L\" ORDER BY total_nilai DESC LIMIT 20
            """)
            label_x = "Jumlah BMN"
        label_y = "K/L"
        title_top = f"Top 20 K/L — {label_x}"
    else:
        if top_filter == "Nilai Perolehan":
            df_top = _safe_query(con, """
                SELECT nama_satker as nama, COALESCE(SUM(nilai_perolehan), 0) as total_nilai
                FROM master_aset GROUP BY nama_satker ORDER BY total_nilai DESC LIMIT 20
            """)
            label_x = "Nilai Perolehan (Rp)"
        else:
            df_top = _safe_query(con, """
                SELECT nama_satker as nama, COUNT(*) as total_nilai
                FROM master_aset GROUP BY nama_satker ORDER BY total_nilai DESC LIMIT 20
            """)
            label_x = "Jumlah BMN"
        label_y = "Satuan Kerja"
        title_top = f"Top 20 Satker — {label_x}"

    if not df_top.empty:
        fig = px.bar(df_top, y="nama", x="total_nilai", orientation="h", color="total_nilai",
                     title=title_top, labels={"nama": label_y, "total_nilai": label_x},
                     height=550, color_continuous_scale="viridis")
        fig.update_layout(yaxis={"categoryorder": "total ascending"})
        fig.update_xaxes(tickformat=",.0f")
        fig.update_traces(hovertemplate="%{x:,.0f}<extra></extra>")
        st.plotly_chart(fig)
    else:
        st.info("Tidak ada data untuk ditampilkan.")

    # ── DETAIL SATKER ──
    if SATKER_DETAIL_EXISTS:
        with st.expander("📋 Detail Satuan Kerja", expanded=False):
            df_s_full = _safe_query(con, f"""
                SELECT *, RIGHT(\"Kode Satker\", 2) as tipe_satker
                FROM read_parquet('{SATKER_DETAIL_PATH}')
            """)

            if not df_s_full.empty:
                kab_list = sorted(df_s_full["Kab/Kota"].unique())
                kab_terpilih = st.selectbox("Filter Kabupaten/Kota:", options=["Semua"] + kab_list)

                df_s = df_s_full if kab_terpilih == "Semua" else df_s_full[df_s_full["Kab/Kota"] == kab_terpilih]

                jml_kl = df_s["Nama K/L"].nunique()
                jml_satker = len(df_s)

                c1, c2, c3, c4, c5, c6, c7 = st.columns(7)
                with c1:
                    st.metric("🏛️ K/L", f"{jml_kl}")
                with c2:
                    st.metric("🏢 Total", f"{jml_satker}")
                for i, tipe in enumerate(["KD", "KP", "TP", "DK", "UB"], start=3):
                    with [c3, c4, c5, c6, c7][i - 3]:
                        st.metric(tipe, f"{len(df_s[df_s['tipe_satker'] == tipe])}")

                st.markdown("---")

                col_mp, col_tbl = st.columns([1, 1])
                with col_mp:
                    st.subheader("🗺️ Peta Sebaran Satker")
                    df_map_satker = df_s.groupby("Kab/Kota").size().reset_index(name="jumlah")
                    m2 = folium.Map(
                        location=CONFIG["default_location"], zoom_start=CONFIG["map_zoom"],
                        tiles=CONFIG["tiles"], zoom_control=False, scrollWheelZoom=False,
                        dragging=False, doubleClickZoom=False,
                    )
                    for _, row in df_map_satker.iterrows():
                        kab = row["Kab/Kota"]
                        jml = int(row["jumlah"])
                        if jml > 0 and kab in BALI_CENTERS:
                            folium.CircleMarker(
                                location=BALI_CENTERS[kab], radius=16,
                                popup=folium.Popup(f"<b>{kab}</b><br>Jumlah Satker: <b>{jml}</b>", max_width=280),
                                color=CONFIG["marker_color"], fill=True,
                                fill_color=CONFIG["marker_color"], fill_opacity=0.6, weight=2,
                            ).add_to(m2)
                    st_folium(m2, width=CONFIG["nup_map_width"], height=CONFIG["nup_map_height"])

                with col_tbl:
                    st.subheader("📊 Jumlah Satker per K/L")
                    df_kl = df_s.groupby("Nama K/L").size().reset_index(name="Jumlah Satker")
                    df_kl = df_kl.sort_values("Jumlah Satker", ascending=False)
                    st.dataframe(df_kl, use_container_width=True, hide_index=True, height=420)

                if kab_terpilih != "Semua":
                    st.markdown("---")
                    st.subheader(f"📋 Daftar Satker — {kab_terpilih}")
                    df_detail = df_s[["Kode Satker", "Nama Satker", "Nama K/L"]].sort_values("Nama K/L")
                    st.dataframe(df_detail, use_container_width=True, hide_index=True, height=300)
            else:
                st.info("Data satker detail tidak tersedia.")

    # ── FOOTER ──
    st.markdown("---")
    st.caption("⚡ Powered by Streamlit + DuckDB + Apache Parquet | Data: Master Aset BMN")


if __name__ == "__main__":
    main()
