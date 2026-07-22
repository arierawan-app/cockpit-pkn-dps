#!/usr/bin/env python3
"""
Dashboard Intelijen Aset BMN Provinsi Bali
Streamlit + DuckDB + Parquet — dijalankan di MacBook Air 8 GB RAM.
"""

import os
from pathlib import Path
import streamlit as st
import duckdb
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import folium
from streamlit_folium import st_folium

BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "data_cache"
PARQUET_FILE = CACHE_DIR / "master_aset_bali.parquet"

st.set_page_config(
    page_title="Dashboard Aset BMN",
    page_icon="🏛️",
    layout="wide",
    initial_sidebar_state="expanded",
)


@st.cache_resource
def init_duckdb(parquet_path: str) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(database=":memory:")
    con.execute(f"CREATE VIEW master_aset AS SELECT * FROM read_parquet('{parquet_path}')")
    return con


def fmt_rupiah(val):
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


GOLONGAN_SORT = [
    "TANAH",
    "PERALATAN DAN MESIN",
    "GEDUNG DAN BANGUNAN",
    "JALAN, IRIGASI DAN JARINGAN",
    "ASET TETAP LAINNYA",
    "KONSTRUKSI DALAM PENGERJAAN",
    "ASET TAK BERWUJUD",
    "TIDAK DIKENAL",
]

GOLONGAN_ORDER_SQL = "CASE golongan_bmn " + " ".join(
    f"WHEN '{g}' THEN {i}" for i, g in enumerate(GOLONGAN_SORT)
) + " END"

KAB_CLEAN = {
    "badung": "KAB. BADUNG", "kab badung": "KAB. BADUNG", "badung ": "KAB. BADUNG",
    "bangli": "KAB. BANGLI", "kab bangli": "KAB. BANGLI", "bangli ": "KAB. BANGLI",
    "buleleng": "KAB. BULELENG", "kab buleleng": "KAB. BULELENG", "buleleng ": "KAB. BULELENG",
    "bulelen": "KAB. BULELENG",
    "gianyar": "KAB. GIANYAR", "kab gianyar": "KAB. GIANYAR", "gianyar ": "KAB. GIANYAR",
    "jembrana": "KAB. JEMBRANA", "kab jembrana": "KAB. JEMBRANA", "jembrana ": "KAB. JEMBRANA",
    "jembrabna": "KAB. JEMBRANA", "jembarana": "KAB. JEMBRANA",
    "karangasem": "KAB. KARANGASEM", "kab karangasem": "KAB. KARANGASEM", "karangasen": "KAB. KARANGASEM",
    "klungkung": "KAB. KLUNGKUNG", "kab klungkung": "KAB. KLUNGKUNG", "klungkung ": "KAB. KLUNGKUNG",
    "tabanan": "KAB. TABANAN", "kab tabanan": "KAB. TABANAN",
    "denpasar": "KOTA DENPASAR", "kota denpasar": "KOTA DENPASAR", "benpasar": "KOTA DENPASAR",
}

def clean_kab(name):
    if name is None:
        return None
    n = name.strip().lower()
    if n in KAB_CLEAN:
        return KAB_CLEAN[n]
    n_norm = n.replace(".", "").replace("kab ", "").replace("kota ", "").strip()
    if n_norm in ("badung",): return "KAB. BADUNG"
    if n_norm in ("bangli",): return "KAB. BANGLI"
    if n_norm in ("buleleng",): return "KAB. BULELENG"
    if n_norm in ("gianyar",): return "KAB. GIANYAR"
    if n_norm in ("jembrana",): return "KAB. JEMBRANA"
    if n_norm in ("karangasem",): return "KAB. KARANGASEM"
    if n_norm in ("klungkung",): return "KAB. KLUNGKUNG"
    if n_norm in ("tabanan",): return "KAB. TABANAN"
    if n_norm in ("denpasar", "bali"): return "KOTA DENPASAR"
    return name.strip().upper() if name else None

BALI_CENTER = [-8.45, 115.075]
BALI_BOUNDS = [[-8.85, 114.40], [-8.05, 115.75]]

BALI_CENTERS = {
    "KAB. BADUNG":       (-8.5819, 115.1775),
    "KAB. BANGLI":       (-8.4543, 115.3547),
    "KAB. BULELENG":     (-8.1852, 114.9367),
    "KAB. GIANYAR":      (-8.5439, 115.3268),
    "KAB. JEMBRANA":     (-8.3147, 114.5901),
    "KAB. KARANGASEM":   (-8.4095, 115.6114),
    "KAB. KLUNGKUNG":    (-8.5627, 115.4207),
    "KAB. TABANAN":      (-8.5437, 115.0576),
    "KOTA DENPASAR":     (-8.6529, 115.2196),
}


def main():
    if not PARQUET_FILE.exists():
        st.error("❌ File Parquet tidak ditemukan!")
        st.markdown(f"""
        **Langkah yang harus dilakukan:**
        1. Letakkan ke-4 file Excel (`daftar-aset-*.xlsx`) ke folder `input_data/`
        2. Jalankan pipeline konversi:
        ```bash
        python pipeline.py
        ```
        3. Refresh dashboard ini.

        📂 Lokasi yang diperiksa: `{PARQUET_FILE}`
        """)
        return

    con = init_duckdb(str(PARQUET_FILE))

    # ── SIDEBAR FILTER ──
    with st.sidebar:
        st.title("🏛️ Dashboard Aset BMN")
        st.caption("**KPKNL Denpasar**")

        st.markdown("---")
        st.subheader("🔍 Filter Data")

        golongan_list = con.execute(
            "SELECT DISTINCT golongan_bmn FROM master_aset WHERE golongan_bmn IS NOT NULL ORDER BY " + GOLONGAN_ORDER_SQL
        ).fetchall()
        pilihan_golongan = st.multiselect(
            "Golongan BMN",
            options=[g[0] for g in golongan_list],
            default=None,
            placeholder="Semua golongan...",
        )

        jenis_list = con.execute(
            "SELECT DISTINCT jenis_bmn FROM master_aset WHERE jenis_bmn IS NOT NULL ORDER BY jenis_bmn"
        ).fetchall()
        pilihan_jenis = st.multiselect(
            "Jenis BMN",
            options=[j[0] for j in jenis_list],
            default=None,
            placeholder="Semua jenis...",
        )

        satker_list = con.execute(
            "SELECT DISTINCT nama_satker FROM master_aset WHERE nama_satker IS NOT NULL ORDER BY nama_satker"
        ).fetchall()
        pilihan_satker = st.multiselect(
            "Satuan Kerja",
            options=[s[0] for s in satker_list],
            default=None,
            placeholder="Semua satker...",
        )

        st.markdown("---")
        st.caption(f"📂 Sumber: `{PARQUET_FILE.name}`")
        st.caption("⚡ Engine: DuckDB + Parquet")

    # ── QUERY DASAR ──
    kondisi = []
    if pilihan_golongan:
        vals = ", ".join([f"'{g.replace(chr(39), chr(39)+chr(39))}'" for g in pilihan_golongan])
        kondisi.append(f"golongan_bmn IN ({vals})")
    if pilihan_jenis:
        vals = ", ".join([f"'{j.replace(chr(39), chr(39)+chr(39))}'" for j in pilihan_jenis])
        kondisi.append(f"jenis_bmn IN ({vals})")
    if pilihan_satker:
        vals = ", ".join([f"'{s.replace(chr(39), chr(39)+chr(39))}'" for s in pilihan_satker])
        kondisi.append(f"nama_satker IN ({vals})")

    where_clause = "WHERE " + " AND ".join(kondisi) if kondisi else ""

    where_ext = (" AND " + " AND ".join(kondisi)) if kondisi else ""

    # ── METRIC CARDS ──
    total_aset = con.execute(f"SELECT COUNT(*) FROM master_aset {where_clause}").fetchone()[0]
    total_nilai_perolehan = con.execute(
        f"SELECT COALESCE(SUM(nilai_perolehan), 0) FROM master_aset {where_clause}"
    ).fetchone()[0]
    total_nilai_buku = con.execute(
        f"SELECT COALESCE(SUM(nilai_buku), 0) FROM master_aset {where_clause}"
    ).fetchone()[0]
    total_satker = con.execute(
        f"SELECT COUNT(DISTINCT nama_satker) FROM master_aset {where_clause}"
    ).fetchone()[0]

    st.title("🏛️ Dashboard Aset BMN")
    st.caption("📡 Sumber data: SIMAN per 19 Juli 2026")

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("📦 Total Aset", f"{total_aset:,}")
    with col2:
        st.metric("💰 Total Nilai Perolehan", fmt_rupiah(total_nilai_perolehan))
    with col3:
        st.metric("📖 Total Nilai Buku", fmt_rupiah(total_nilai_buku))
    with col4:
        jml_satker_filtered = con.execute(
            f"SELECT COUNT(DISTINCT nama_satker) FROM master_aset WHERE nama_satker IS NOT NULL {where_ext}"
        ).fetchone()[0]
        st.metric("🏢 Satuan Kerja", f"{jml_satker_filtered:,}")

    st.markdown("---")

    # ── MAIN SUMMARY ──
    df_golongan = con.execute(f"""
        SELECT
            golongan_bmn,
            COUNT(*) as jumlah_aset,
            COALESCE(SUM(nilai_perolehan), 0) as total_nilai_perolehan,
            COALESCE(SUM(nilai_buku), 0) as total_nilai_buku
        FROM master_aset {where_clause}
        GROUP BY golongan_bmn
        ORDER BY {GOLONGAN_ORDER_SQL}
    """).df()

    col_a, col_b = st.columns([1, 2])

    with col_a:
        st.subheader("📊 Ringkasan per Golongan")
        df_display = df_golongan.copy()
        df_display["Jumlah Aset"] = df_display["jumlah_aset"].apply(lambda x: f"{x:,}")
        df_display["Total Nilai Perolehan"] = df_display["total_nilai_perolehan"].apply(fmt_rupiah)
        df_display["Total Nilai Buku"] = df_display["total_nilai_buku"].apply(fmt_rupiah)

        total_row = pd.DataFrame([{
            "golongan_bmn": "TOTAL",
            "Jumlah Aset": f"{total_aset:,}",
            "Total Nilai Perolehan": fmt_rupiah(total_nilai_perolehan),
            "Total Nilai Buku": fmt_rupiah(total_nilai_buku),
        }])
        df_display = pd.concat([df_display[["golongan_bmn", "Jumlah Aset", "Total Nilai Perolehan", "Total Nilai Buku"]], total_row], ignore_index=True)

        st.dataframe(
            df_display,
            hide_index=True,
            use_container_width=True,
            height=320,
            column_config={"golongan_bmn": "Golongan BMN"},
        )

    with col_b:
        st.subheader("📈 Grafik Jumlah Aset per Golongan")
        if not df_golongan.empty:
            fig = px.bar(
                df_golongan,
                x="golongan_bmn",
                y="jumlah_aset",
                color="golongan_bmn",
                title="Jumlah Aset per Golongan BMN",
                labels={"golongan_bmn": "Golongan BMN", "jumlah_aset": "Jumlah Aset"},
                height=380,
            )
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="%{y:,.0f} aset<extra></extra>")
            st.plotly_chart(fig)

    st.markdown("---")

    # ── NILAI PER GOLONGAN CHART ──
    col_n1, col_n2 = st.columns(2)
    with col_n1:
        st.subheader("💰 Nilai Perolehan per Golongan")
        if not df_golongan.empty:
            fig = px.bar(
                df_golongan,
                x="golongan_bmn",
                y="total_nilai_perolehan",
                color="golongan_bmn",
                title="Total Nilai Perolehan per Golongan (Rp)",
                labels={"golongan_bmn": "Golongan BMN", "total_nilai_perolehan": "Nilai Perolehan"},
                height=400,
            )
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="Rp %{y:,.0f}<extra></extra>")
            st.plotly_chart(fig)

    with col_n2:
        st.subheader("📖 Nilai Buku per Golongan")
        if not df_golongan.empty:
            fig = px.bar(
                df_golongan,
                x="golongan_bmn",
                y="total_nilai_buku",
                color="golongan_bmn",
                title="Total Nilai Buku per Golongan (Rp)",
                labels={"golongan_bmn": "Golongan BMN", "total_nilai_buku": "Nilai Buku"},
                height=400,
            )
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="Rp %{y:,.0f}<extra></extra>")
            st.plotly_chart(fig)

    st.markdown("---")

    col_chart, col_map = st.columns(2)

    with col_chart:
        st.subheader("Distribusi per Jenis BMN")
        df_jenis = con.execute(f"""
            SELECT jenis_bmn, COUNT(*) as jumlah
            FROM master_aset {where_clause}
            GROUP BY jenis_bmn
            ORDER BY jumlah DESC
        """).df()
        if not df_jenis.empty:
            fig = px.bar(
                df_jenis,
                x="jenis_bmn",
                y="jumlah",
                color="jenis_bmn",
                title="Jumlah Aset per Jenis BMN",
                labels={"jenis_bmn": "Jenis BMN", "jumlah": "Jumlah Aset"},
                height=400,
            )
            fig.update_layout(showlegend=False, xaxis_tickangle=-45, hovermode="x unified")
            fig.update_yaxes(tickformat=",.0f")
            fig.update_traces(hovertemplate="%{y:,.0f} aset<extra></extra>")
            st.plotly_chart(fig)
        else:
            st.info("Tidak ada data untuk ditampilkan.")

    with col_map:
        st.subheader("🗺️ Peta Sebaran NUP per Kabupaten/Kota")

        df_map_nup = con.execute(f"""
            SELECT kab_kota as kab_raw, COUNT(*) as jumlah_aset,
                   COALESCE(SUM(nilai_perolehan), 0) as total_nilai
            FROM master_aset
            WHERE kab_kota IS NOT NULL {where_ext}
            GROUP BY kab_kota
        """).df()

        df_map_nup["kab_clean"] = df_map_nup["kab_raw"].apply(clean_kab)
        df_map_nup = df_map_nup[df_map_nup["kab_clean"].isin(BALI_CENTERS.keys())]
        df_agg_nup = df_map_nup.groupby("kab_clean", as_index=False).agg({
            "jumlah_aset": "sum",
            "total_nilai": "sum",
        })

        m3 = folium.Map(
            location=BALI_CENTER,
            zoom_start=9,
            tiles="CartoDB positron",
            zoom_control=False,
            scrollWheelZoom=False,
            dragging=False,
            doubleClickZoom=False,
        )
        m3.fit_bounds(BALI_BOUNDS)
        for _, row in df_agg_nup.iterrows():
            kab = row["kab_clean"]
            if kab in BALI_CENTERS:
                folium.CircleMarker(
                    location=BALI_CENTERS[kab],
                    radius=max(row["jumlah_aset"] / 600 + 8, 10),
                    popup=folium.Popup(
                        f"<b>{kab}</b><br>Jumlah NUP: {row['jumlah_aset']:,}<br>"
                        f"Total Nilai Perolehan: {fmt_rupiah(row['total_nilai'])}",
                        max_width=280,
                    ),
                    color="#d62728", fill=True, fill_color="#d62728", fill_opacity=0.6, weight=2,
                ).add_to(m3)

        st_folium(m3, width=500, height=400)

    st.markdown("---")

    col_top1, col_top2 = st.columns(2)
    with col_top1:
        top_unit = st.selectbox("Top 20:", options=["Satuan Kerja", "K/L"])
    with col_top2:
        top_filter = st.selectbox("Kategori:", options=["Nilai Perolehan", "Jumlah BMN"])

    if top_unit == "K/L":
        df_kl = con.execute(f"""
            SELECT \"Nama K/L\" as nama, COALESCE(SUM(m.nilai_perolehan), 0) as total_nilai,
                   COUNT(*) as jumlah
            FROM read_parquet('{CACHE_DIR / "satker_detail.parquet"}') s
            JOIN master_aset m ON s.\"Nama Satker\" = m.nama_satker
            GROUP BY \"Nama K/L\"
            ORDER BY total_nilai DESC
            LIMIT 20
        """).df() if top_filter == "Nilai Perolehan" else con.execute(f"""
            SELECT \"Nama K/L\" as nama, COUNT(m.nomor) as total_nilai
            FROM read_parquet('{CACHE_DIR / "satker_detail.parquet"}') s
            JOIN master_aset m ON s.\"Nama Satker\" = m.nama_satker
            GROUP BY \"Nama K/L\"
            ORDER BY total_nilai DESC
            LIMIT 20
        """).df()
        label_y = "K/L"
        label_x = "Nilai Perolehan (Rp)" if top_filter == "Nilai Perolehan" else "Jumlah BMN"
        title_top = f"Top 20 K/L — {label_x}"
    else:
        df_top = con.execute("""
            SELECT nama_satker as nama, COALESCE(SUM(nilai_perolehan), 0) as total_nilai
            FROM master_aset GROUP BY nama_satker ORDER BY total_nilai DESC LIMIT 20
        """).df() if top_filter == "Nilai Perolehan" else con.execute("""
            SELECT nama_satker as nama, COUNT(*) as total_nilai
            FROM master_aset GROUP BY nama_satker ORDER BY total_nilai DESC LIMIT 20
        """).df()
        label_y = "Satuan Kerja"
        label_x = "Nilai Perolehan (Rp)" if top_filter == "Nilai Perolehan" else "Jumlah BMN"
        title_top = f"Top 20 Satker — {label_x}"

    if not df_top.empty:
        fig = px.bar(
            df_top,
            y="nama",
            x="total_nilai",
            orientation="h",
            color="total_nilai",
            title=title_top,
            labels={"nama": label_y, "total_nilai": label_x},
            height=550,
            color_continuous_scale="viridis",
        )
        fig.update_layout(yaxis={"categoryorder": "total ascending"})
        fig.update_xaxes(tickformat=",.0f")
        fig.update_traces(hovertemplate="%{x:,.0f}<extra></extra>")
        st.plotly_chart(fig)
    else:
        st.info("Tidak ada data untuk ditampilkan.")

    # ── DETAIL SATKER ──
    satker_df_path = CACHE_DIR / "satker_detail.parquet"
    if satker_df_path.exists():
        with st.expander("📋 Detail Satuan Kerja", expanded=False):
            df_s_full = con.execute(f"""
                SELECT *, RIGHT(\"Kode Satker\", 2) as tipe_satker
                FROM read_parquet('{satker_df_path}')
            """).df()

            kab_list = sorted(df_s_full["Kab/Kota"].unique())
            kab_terpilih = st.selectbox("Filter Kabupaten/Kota:", options=["Semua"] + kab_list)

            if kab_terpilih != "Semua":
                df_s = df_s_full[df_s_full["Kab/Kota"] == kab_terpilih]
            else:
                df_s = df_s_full

            jml_kl = df_s["Nama K/L"].nunique()
            jml_satker = len(df_s)

            c1, c2, c3, c4, c5, c6, c7 = st.columns(7)
            with c1:
                st.metric("🏛️ K/L", f"{jml_kl}")
            with c2:
                st.metric("🏢 Total", f"{jml_satker}")
            with c3:
                st.metric("KD", f"{len(df_s[df_s['tipe_satker']=='KD'])}")
            with c4:
                st.metric("KP", f"{len(df_s[df_s['tipe_satker']=='KP'])}")
            with c5:
                st.metric("TP", f"{len(df_s[df_s['tipe_satker']=='TP'])}")
            with c6:
                st.metric("DK", f"{len(df_s[df_s['tipe_satker']=='DK'])}")
            with c7:
                st.metric("UB", f"{len(df_s[df_s['tipe_satker']=='UB'])}")

            st.markdown("---")

            col_map, col_table = st.columns([1, 1])

            with col_map:
                st.subheader("🗺️ Peta Sebaran Satker")
                df_map_satker = df_s.groupby("Kab/Kota").size().reset_index(name="jumlah")
                m2 = folium.Map(
                    location=BALI_CENTER,
                    zoom_start=9,
                    tiles="CartoDB positron",
                    zoom_control=False,
                    scrollWheelZoom=False,
                    dragging=False,
                    doubleClickZoom=False,
                )
                for _, row in df_map_satker.iterrows():
                    kab = row["Kab/Kota"]
                    jml = int(row["jumlah"])
                    if jml > 0 and kab in BALI_CENTERS:
                        folium.CircleMarker(
                            location=BALI_CENTERS[kab],
                            radius=16,
                            popup=folium.Popup(
                                f"<b>{kab}</b><br>Jumlah Satker: <b>{jml}</b>",
                                max_width=280,
                            ),
                            color="#d62728", fill=True, fill_color="#d62728", fill_opacity=0.6, weight=2,
                        ).add_to(m2)
                st_folium(m2, width=500, height=400)

            with col_table:
                st.subheader("📊 Jumlah Satker per K/L")
                df_kl = df_s.groupby("Nama K/L").size().reset_index(name="Jumlah Satker")
                df_kl = df_kl.sort_values("Jumlah Satker", ascending=False)
                st.dataframe(df_kl, use_container_width=True, hide_index=True, height=420)

            if kab_terpilih != "Semua":
                st.markdown("---")
                st.subheader(f"📋 Daftar Satker — {kab_terpilih}")
                df_detail_satker = df_s[["Kode Satker", "Nama Satker", "Nama K/L"]].sort_values("Nama K/L")
                st.dataframe(df_detail_satker, use_container_width=True, hide_index=True, height=300)

    # ── FOOTER ──
    st.markdown("---")
    st.caption(
        "⚡ Powered by Streamlit + DuckDB + Apache Parquet | "
        "Data: Master Aset BMN Provinsi Bali"
    )


if __name__ == "__main__":
    main()
