#!/usr/bin/env python3
"""
Pipeline: Konversi 4 file Excel Master Aset BMN → Satu file Parquet terkompresi.
Memproses Export_UAKPB.xlsx → satker_bali.parquet + satker_detail.parquet.
Optimasi RAM: Membaca file satu per satu via openpyxl read-only streaming,
memproses dalam chunk 50K baris, menulis langsung ke disk.
"""

import os
import sys
import gc
from pathlib import Path
from datetime import datetime

import openpyxl
import polars as pl

BASE_DIR = Path(__file__).resolve().parent
INPUT_DIR = BASE_DIR / "input_data"
CACHE_DIR = BASE_DIR / "data_cache"

COLUMN_ORDER = ["nomor", "jenis_bmn", "kode_satker", "nama_satker", "kode_barang", "nup", "golongan_bmn"]

GOLONGAN_MAP = {
    "1": "PERSEDIAAN",
    "2": "TANAH",
    "3": "PERALATAN DAN MESIN",
    "4": "GEDUNG DAN BANGUNAN",
    "5": "JALAN, IRIGASI DAN JARINGAN",
    "6": "ASET TETAP LAINNYA",
    "7": "KONSTRUKSI DALAM PENGERJAAN",
    "8": "ASET TAK BERWUJUD",
}

KOLOM_KEYS = {
    "no": "nomor",
    "jenis_bmn": "jenis_bmn",
    "jenis": "jenis_bmn",
    "kode_satker": "kode_satker",
    "kode satker": "kode_satker",
    "nama_satker": "nama_satker",
    "nama satker": "nama_satker",
    "kode_barang": "kode_barang",
    "kode barang": "kode_barang",
    "nup": "nup",
    "nomor_urut_pendaftaran": "nup",
}


def normalisasi_kolom(df: pl.DataFrame) -> pl.DataFrame:
    mapping = {}
    for col in df.columns:
        key = col.strip().lower().replace("  ", " ")
        if key in KOLOM_KEYS:
            mapping[col] = KOLOM_KEYS[key]
    if mapping:
        df = df.rename(mapping)
    return df


def cari_file_excel(base_dir: Path) -> list[Path]:
    if INPUT_DIR.exists():
        files = sorted(INPUT_DIR.glob("*.xlsx"))
        if files:
            return files
    files = sorted(base_dir.parent.glob("*.xlsx"))
    return files


def baca_excel_chunking(filepath: Path, chunk_size: int = 50_000) -> pl.DataFrame:
    """Baca Excel via openpyxl read-only mode, chunk per chunk untuk hemat RAM."""
    MAX_ROW = 99_999_999

    print(f"  Membuka: {filepath.name} ({filepath.stat().st_size / 1024 / 1024:.1f} MB)")

    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active
    print(f"  Sheet: {ws.title}")

    header_row = next(ws.iter_rows(min_row=1, max_row=MAX_ROW, values_only=True))
    headers = [str(h).strip() if h is not None else f"col_{i}" for i, h in enumerate(header_row)]

    chunks = []
    batch = []
    processed = 0
    skipped_empty = 0

    for row in ws.iter_rows(min_row=2, max_row=MAX_ROW, values_only=True):
        vals = list(row)
        if all(v is None for v in vals):
            skipped_empty += 1
            continue

        batch.append(vals)
        processed += 1

        if len(batch) >= chunk_size:
            df_chunk = pl.DataFrame(batch, schema=headers, orient="row")
            chunks.append(df_chunk)
            batch = []
            print(f"    → {processed:,} baris terbaca...")
            gc.collect()

    if batch:
        df_chunk = pl.DataFrame(batch, schema=headers, orient="row")
        chunks.append(df_chunk)

    wb.close()

    if skipped_empty > 0:
        print(f"    ℹ {skipped_empty} baris kosong dilewati")

    if not chunks:
        print("    ⚠ Tidak ada data.")
        return pl.DataFrame(schema=headers)

    print(f"    → Menggabungkan {len(chunks)} chunk...")
    df = pl.concat(chunks, how="vertical")
    print(f"    → Total: {df.height:,} baris, {df.width} kolom")
    return df


def pipeline():
    print("=" * 60)
    print("PIPELINE KONVERSI EXCEL → PARQUET")
    print(f"Waktu mulai: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    files = cari_file_excel(BASE_DIR)
    if not files:
        print("Tidak ditemukan file Excel (.xlsx) di folder input_data/ atau root proyek.")
        print("Silakan letakkan 4 file Excel di folder input_data/")
        sys.exit(1)

    print(f"\nDitemukan {len(files)} file Excel:")
    for f in files:
        print(f"   - {f.name} ({f.stat().st_size / 1024 / 1024:.1f} MB)")
    print()

    semua_dfs = []
    total_rows = 0

    for idx, filepath in enumerate(files, 1):
        print(f"[{idx}/{len(files)}] Proses file...")
        df = baca_excel_chunking(filepath)

        if df.height == 0:
            print("    File kosong, dilewati.\n")
            continue

        df = normalisasi_kolom(df)
        df = df.with_columns(
            [
                pl.lit(filepath.stem).alias("sumber_file"),
                pl.col("kode_barang").str.slice(0, 1).replace(GOLONGAN_MAP, default="TIDAK DIKENAL").alias("golongan_bmn"),
            ]
        )

        for col in COLUMN_ORDER:
            if col not in df.columns:
                df = df.with_columns(pl.lit(None).alias(col))

        cols_lain = [c for c in df.columns if c not in COLUMN_ORDER]
        df = df.select(COLUMN_ORDER + cols_lain)

        df = df.with_columns(
            [
                pl.col("nomor").cast(pl.Int64, strict=False),
                pl.col("nup").cast(pl.Int64, strict=False),
                pl.col("jenis_bmn").cast(pl.Utf8),
                pl.col("kode_satker").cast(pl.Utf8),
                pl.col("nama_satker").cast(pl.Utf8),
                pl.col("kode_barang").cast(pl.Utf8),
                pl.col("golongan_bmn").cast(pl.Utf8),
                pl.col("sumber_file").cast(pl.Utf8),
            ]
        )

        semua_dfs.append(df)
        total_rows += df.height
        print(f"    Selesai memproses {df.height:,} baris\n")

    print("-" * 60)
    print(f"Menggabungkan {len(semua_dfs)} DataFrame...")
    df_gabungan = pl.concat(semua_dfs, how="vertical")
    print(f"   Total baris: {df_gabungan.height:,}")
    print(f"   Total kolom: {df_gabungan.width}")
    size_mb = df_gabungan.estimated_size("mb")
    print(f"   Estimasi memori: {size_mb:.1f} MB")

    parquet_path = CACHE_DIR / "master_aset_bali.parquet"
    print(f"\nMenulis file Parquet: {parquet_path}")
    df_gabungan.write_parquet(parquet_path, compression="snappy", statistics=True)
    size_mb = parquet_path.stat().st_size / 1024 / 1024
    print(f"   Tersimpan: {size_mb:.1f} MB")

    print("\n" + "=" * 60)
    print("PIPELINE SELESAI")
    print(f"   File output: {parquet_path}")
    print(f"   Total baris: {df_gabungan.height:,}")
    print(f"   Waktu selesai: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    return df_gabungan


def pipeline_uakpb():
    """Proses Export_UAKPB.xlsx → satker_bali.parquet → satker_detail.parquet"""
    uakpb_file = BASE_DIR.parent / "Export_UAKPB.xlsx"
    if not uakpb_file.exists():
        print(f"\n⚠ Export_UAKPB.xlsx tidak ditemukan di {uakpb_file}, skip.")
        return

    print("\n" + "=" * 60)
    print("PIPELINE UAKPB → SATKER DETAIL")
    print("=" * 60)

    wb = openpyxl.load_workbook(uakpb_file, read_only=True, data_only=True)
    ws = wb.active

    KAB_CLEAN_MAP = {
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

    def _clean(raw):
        if raw is None:
            return None
        r = str(raw).strip().lower().replace(", bali", "").replace("kab.", "kab ")
        if r in KAB_CLEAN_MAP:
            return KAB_CLEAN_MAP[r]
        for pattern, target in KAB_CLEAN_MAP.items():
            if pattern in r:
                return target
        return None

    rows = []
    for row in ws.iter_rows(min_row=2, max_row=99999999, min_col=1, max_col=25, values_only=True):
        vals = list(row)
        if all(v is None for v in vals):
            continue
        status = str(vals[19]).strip() if vals[19] else ""
        if status != "AKTIF":
            continue
        kode_kl = vals[3]
        nama_kl = vals[4]
        kode_satker = vals[1]
        nama_satker = vals[2]
        kab_raw = vals[22]
        rows.append([str(kode_kl) if kode_kl else "", str(nama_kl) if nama_kl else "",
                     str(kode_satker) if kode_satker else "", str(nama_satker) if nama_satker else "",
                     kab_raw])

    wb.close()

    df = pl.DataFrame(
        rows,
        schema=["kode_kl", "nama_kl", "kode_satker", "nama_satker", "kab_kota_raw"],
        orient="row",
    )

    df = df.with_columns(
        pl.col("kab_kota_raw").map_elements(_clean, return_dtype=pl.Utf8).alias("kab_kota")
    )
    df = df.filter(pl.col("kab_kota").is_not_null())
    df = df.select(["kode_kl", "nama_kl", "kode_satker", "nama_satker", "kab_kota"]).unique()

    satker_bali_path = CACHE_DIR / "satker_bali.parquet"
    df.write_parquet(satker_bali_path, compression="snappy")
    print(f"  satker_bali.parquet: {df.height} entries")

    # Join dengan master aset
    parquet_path = CACHE_DIR / "master_aset_bali.parquet"
    if parquet_path.exists():
        df_master = pl.read_parquet(parquet_path).select("nama_satker").unique()
        df_detail = df.join(df_master, on="nama_satker", how="inner").unique()

        df_detail = df_detail.rename({
            "kode_kl": "Kode K/L",
            "nama_kl": "Nama K/L",
            "kode_satker": "Kode Satker",
            "nama_satker": "Nama Satker",
            "kab_kota": "Kab/Kota",
        })
        df_detail = df_detail.select(["Kode K/L", "Nama K/L", "Kode Satker", "Nama Satker", "Kab/Kota"])
        df_detail = df_detail.sort(["Kab/Kota", "Nama K/L", "Nama Satker"])

        satker_detail_path = CACHE_DIR / "satker_detail.parquet"
        df_detail.write_parquet(satker_detail_path, compression="snappy")
        print(f"  satker_detail.parquet: {df_detail.height} entries (join dengan master aset)")
    else:
        print("  ⚠ master_aset_bali.parquet belum ada, skip join")

    print("=" * 60)


if __name__ == "__main__":
    pipeline()
    pipeline_uakpb()
