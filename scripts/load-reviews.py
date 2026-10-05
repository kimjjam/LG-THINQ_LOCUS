#!/usr/bin/env python3
"""Validate and load the full review bundle from paths outside the repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import requests


EXPECTED_ROWS = 36_027
EXPECTED_NO_EVENT = 34_008
EXPECTED_EVENT = 2_019
EXPECTED_TOPICS = 10
EMBEDDING_DIMENSIONS = 384
EVENT_FROM = pd.Timestamp("2026-07-01T00:00:00Z")
EVENT_TO = pd.Timestamp("2026-08-01T00:00:00Z")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load_env_file(path: Path) -> dict[str, str]:
    require(path.is_file(), f"Environment file not found: {path}")
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_matrix(path: Path, market_names: set[str]) -> pd.DataFrame:
    matrix = pd.read_csv(path)
    require("market" in matrix.columns, f"Missing market column: {path.name}")
    expected_columns = {"market", *(str(topic) for topic in range(EXPECTED_TOPICS))}
    require(set(matrix.columns) == expected_columns, f"Unexpected columns: {path.name}")
    require(len(matrix) == len(market_names), f"Unexpected row count: {path.name}")
    require(matrix["market"].is_unique, f"Duplicate market rows: {path.name}")
    require(set(matrix["market"]) == market_names, f"Unexpected markets: {path.name}")
    numeric = matrix.set_index("market").loc[:, [str(topic) for topic in range(EXPECTED_TOPICS)]].apply(
        pd.to_numeric, errors="raise"
    )
    require(np.isfinite(numeric.to_numpy()).all(), f"Non-finite values: {path.name}")
    return numeric


def source_event_flags(series: pd.Series) -> pd.Series:
    if series.dtype == bool:
        return series
    parsed = series.astype(str).str.strip().str.lower().map({"true": True, "false": False})
    require(parsed.notna().all(), "Invalid values in source 사건 column")
    return parsed.astype(bool)


def assert_required_text(frame: pd.DataFrame, column: str) -> None:
    require(frame[column].notna().all(), f"Null value in {column}")
    require(frame[column].astype(str).str.strip().ne("").all(), f"Blank value in {column}")


def validate_bundle(
    csv_path: Path,
    embedding_path: Path,
    reference_dir: Path,
    repository_root: Path,
) -> tuple[pd.DataFrame, np.ndarray, pd.Series, list[dict[str, Any]], dict[str, Any]]:
    csv_path = csv_path.resolve()
    embedding_path = embedding_path.resolve()
    reference_dir = reference_dir.resolve()
    repository_root = repository_root.resolve()

    require(csv_path.is_file(), f"CSV not found: {csv_path}")
    require(embedding_path.is_file(), f"NPY not found: {embedding_path}")
    require(not csv_path.is_relative_to(repository_root), "Full review CSV must stay outside the repository")
    require(not embedding_path.is_relative_to(repository_root), "Full embedding NPY must stay outside the repository")

    meta = json.loads((reference_dir / "meta.json").read_text(encoding="utf-8"))
    artifact_meta = meta.get("full_artifacts", {})
    for path in (csv_path, embedding_path):
        expected = artifact_meta.get(path.name, {})
        require(expected.get("sha256"), f"Missing trusted SHA-256 for {path.name} in meta.json")
        require(expected.get("bytes") == path.stat().st_size, f"File size mismatch: {path.name}")
        require(sha256_file(path) == expected["sha256"].lower(), f"SHA-256 mismatch: {path.name}")
    require("naive" in meta["timestamp"]["tz"].lower(), "Expected naive source timestamps")
    require(meta["baseline"] == "no_event", "Expected no_event baseline")
    require(
        meta["event_window"]["from"] == "2026-07-01"
        and meta["event_window"]["to"] == "2026-08-01",
        "Unexpected event window",
    )

    frame = pd.read_csv(csv_path)
    required_columns = {
        "lang", "market", "unit", "score", "at", "app_version", "content", "clean", "사건", "topic"
    }
    require(required_columns.issubset(frame.columns), "Full review CSV columns do not match the schema")
    require(len(frame) == EXPECTED_ROWS, f"Expected {EXPECTED_ROWS:,} CSV rows, got {len(frame):,}")

    embeddings = np.load(embedding_path, mmap_mode="r")
    require(embeddings.shape == (EXPECTED_ROWS, EMBEDDING_DIMENSIONS), f"Unexpected NPY shape: {embeddings.shape}")
    for start in range(0, EXPECTED_ROWS, 2_000):
        require(np.isfinite(embeddings[start:start + 2_000]).all(), "Embedding contains a non-finite value")

    market_code_by_name = {market["name"]: market["code"] for market in meta["markets"]}
    market_names = set(market_code_by_name)
    require(set(frame["market"]) == market_names, "CSV markets do not match meta.json")
    require(len(market_code_by_name) == 17, "Expected 17 markets")

    scores = pd.to_numeric(frame["score"], errors="raise")
    topics = pd.to_numeric(frame["topic"], errors="raise")
    require((scores == scores.astype(int)).all() and scores.between(1, 5).all(), "Invalid score")
    require((topics == topics.astype(int)).all() and topics.between(0, 9).all(), "Invalid topic")
    frame["score"] = scores.astype(int)
    frame["topic"] = topics.astype(int)
    for column in ("lang", "market", "unit", "content", "clean"):
        assert_required_text(frame, column)

    timestamps = pd.to_datetime(frame["at"], errors="raise")
    require(timestamps.dt.tz is None, "Expected naive source timestamps")
    timestamps_utc = timestamps.dt.tz_localize("UTC")
    event_flags = (timestamps_utc >= EVENT_FROM) & (timestamps_utc < EVENT_TO)
    require(int(event_flags.sum()) == EXPECTED_EVENT, "Unexpected event row count")
    require(int((~event_flags).sum()) == EXPECTED_NO_EVENT, "Unexpected no-event row count")
    stale_event_flags = source_event_flags(frame["사건"])
    stale_event_mismatches = int((stale_event_flags != event_flags).sum())
    if stale_event_mismatches:
        print(
            f"Ignoring stale source event flags: {int(stale_event_flags.sum()):,} source true vs "
            f"{int(event_flags.sum()):,} UTC-boundary true ({stale_event_mismatches:,} rows differ)."
        )

    analyzed_counts = frame.groupby("market", observed=True).size().to_dict()
    no_event_counts = frame.loc[~event_flags].groupby("market", observed=True).size().to_dict()
    for market in meta["markets"]:
        require(analyzed_counts.get(market["name"]) == market["analyzed_count"], f"Analyzed count mismatch: {market['name']}")
        require(no_event_counts.get(market["name"]) == market["analyzed_no_event"], f"No-event count mismatch: {market['name']}")

    count_values = read_matrix(reference_dir / "topic_counts_no_event.csv", market_names)
    require((count_values >= 0).to_numpy().all(), "Negative topic count")
    require(np.equal(count_values.to_numpy(), np.floor(count_values.to_numpy())).all(), "Non-integer topic count")
    count_matrix = count_values.astype(int)
    actual_counts = pd.crosstab(frame.loc[~event_flags, "market"], frame.loc[~event_flags, "topic"])
    actual_counts = actual_counts.reindex(index=count_matrix.index, columns=range(EXPECTED_TOPICS), fill_value=0)
    actual_counts.columns = actual_counts.columns.astype(str)
    require(actual_counts.equals(count_matrix), "No-event market/topic counts disagree with topic_counts_no_event.csv")
    require(int(count_matrix.to_numpy().sum()) == EXPECTED_NO_EVENT, "Reference counts do not total 34,008")

    centroids = np.load(reference_dir / "topic_centroids.npy")
    require(centroids.shape == (EXPECTED_TOPICS, EMBEDDING_DIMENSIONS), "Unexpected centroid shape")
    centroid_csv = pd.read_csv(reference_dir / "topic_centroids.csv")
    dimensions = [str(index) for index in range(EMBEDDING_DIMENSIONS)]
    require(set(centroid_csv.columns) == {"topic_id", *dimensions}, "Unexpected centroid CSV columns")
    require(len(centroid_csv) == EXPECTED_TOPICS, "Unexpected centroid CSV row count")
    require(set(centroid_csv["topic_id"]) == set(range(EXPECTED_TOPICS)), "Unexpected centroid topic IDs")
    centroid_values = (
        centroid_csv.sort_values("topic_id").loc[:, dimensions].apply(pd.to_numeric, errors="raise").to_numpy()
    )
    require(np.isfinite(centroid_values).all(), "Non-finite centroid value")
    require(np.allclose(centroids, centroid_values, rtol=1e-7, atol=1e-8), "Centroid CSV/NPY mismatch")
    centroid_norms = np.square(centroid_values.astype(np.float64)).sum(axis=1)
    mismatches = 0
    for start in range(0, EXPECTED_ROWS, 2_000):
        chunk = np.asarray(embeddings[start:start + 2_000], dtype=np.float64)
        distances = np.square(chunk).sum(axis=1, keepdims=True) + centroid_norms - 2 * chunk @ centroid_values.T
        predicted = distances.argmin(axis=1)
        mismatches += int(np.count_nonzero(predicted != frame["topic"].to_numpy()[start:start + len(chunk)]))
    require(mismatches == 0, f"CSV/NPY row alignment check failed for {mismatches:,} rows")

    lift = read_matrix(reference_dir / "lift_no_event.csv", market_names)
    residual = read_matrix(reference_dir / "resid_no_event.csv", market_names)
    require((lift >= 0).to_numpy().all(), "Negative lift value")
    stats: list[dict[str, Any]] = []
    for market in meta["markets"]:
        name = market["name"]
        total = int(count_matrix.loc[name].sum())
        for topic in range(EXPECTED_TOPICS):
            count = int(count_matrix.loc[name, str(topic)])
            stats.append({
                "market_code": market_code_by_name[name],
                "topic_id": topic,
                "count": count,
                "share": count / total,
                "lift": float(lift.loc[name, str(topic)]),
                "residual": float(residual.loc[name, str(topic)]),
            })
    require(len(stats) == 170, "Expected 170 market_stats rows")

    frame["market_code"] = frame["market"].map(market_code_by_name)
    frame["at_utc"] = timestamps_utc.map(lambda value: value.isoformat().replace("+00:00", "Z"))
    frame["is_event"] = event_flags
    return frame, embeddings, event_flags, stats, meta


class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base_url = f"{url.rstrip('/')}/rest/v1"
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        })

    @staticmethod
    def error_message(response: requests.Response) -> str:
        try:
            body = response.json()
            return f"{body.get('code', 'unknown')}: {body.get('message', 'request failed')}"
        except ValueError:
            return "non-JSON error response"

    def count(self, table: str, select_column: str, filters: dict[str, str] | None = None) -> int:
        params = {"select": select_column, "limit": "1", **(filters or {})}
        response = self.session.get(
            f"{self.base_url}/{table}",
            params=params,
            headers={"Prefer": "count=exact"},
            timeout=(20, 120),
            allow_redirects=False,
        )
        if not response.ok:
            raise RuntimeError(f"Count failed for {table} ({response.status_code}): {self.error_message(response)}")
        content_range = response.headers.get("Content-Range", "")
        require("/" in content_range, f"Missing Content-Range for {table}")
        return int(content_range.rsplit("/", 1)[1])

    def insert_reviews(self, rows: list[dict[str, Any]], expected_before: int) -> None:
        expected_after = expected_before + len(rows)
        try:
            response = self.session.post(
                f"{self.base_url}/reviews",
                json=rows,
                headers={"Prefer": "return=minimal"},
                timeout=(20, 180),
                allow_redirects=False,
            )
            if response.ok:
                return
            failure = f"{response.status_code}: {self.error_message(response)}"
        except requests.RequestException:
            failure = "network error"

        # Never retry an ambiguous review POST: without a source key, a late commit could duplicate the batch.
        for _ in range(3):
            time.sleep(5)
            observed = self.count("reviews", "id")
            if observed == expected_after:
                return
            if observed != expected_before:
                raise RuntimeError(
                    f"Uncertain review insert state: expected {expected_before:,} or {expected_after:,}, got {observed:,}"
                )
        raise RuntimeError(f"Review batch failed without retry ({failure})")

    def upsert_market_stats(self, rows: list[dict[str, Any]]) -> None:
        for attempt in range(6):
            try:
                response = self.session.post(
                    f"{self.base_url}/market_stats",
                    params={"on_conflict": "market_code,topic_id"},
                    json=rows,
                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                    timeout=(20, 120),
                    allow_redirects=False,
                )
                if response.ok:
                    return
                if response.status_code not in {429, 500, 502, 503, 504}:
                    raise RuntimeError(
                        f"market_stats upsert failed ({response.status_code}): {self.error_message(response)}"
                    )
            except requests.RequestException:
                response = None
            if attempt == 5:
                status = response.status_code if response is not None else "network error"
                raise RuntimeError(f"market_stats upsert failed after retries ({status})")
            time.sleep(min(2 ** attempt, 20))


def nullable_text(value: Any) -> str | None:
    if pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def review_rows(frame: pd.DataFrame, embeddings: np.ndarray, start: int, end: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index in range(start, end):
        row = frame.iloc[index]
        rows.append({
            "market_code": str(row["market_code"]),
            "lang": str(row["lang"]),
            "unit": str(row["unit"]),
            "score": int(row["score"]),
            "at": str(row["at_utc"]),
            "app_version": nullable_text(row["app_version"]),
            "content": str(row["content"]),
            "clean": str(row["clean"]),
            "topic_id": int(row["topic"]),
            "is_event": bool(row["is_event"]),
            "embedding": np.asarray(embeddings[index], dtype=float).tolist(),
        })
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--embeddings", type=Path, required=True)
    parser.add_argument("--references", type=Path, default=Path("data"))
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--batch-size", type=int, default=75)
    parser.add_argument("--apply", action="store_true", help="Write reviews and market_stats to Supabase")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    require(1 <= args.batch_size <= 200, "batch-size must be between 1 and 200")
    root = Path(__file__).resolve().parents[1]
    reference_dir = args.references if args.references.is_absolute() else root / args.references
    env_file = args.env_file if args.env_file.is_absolute() else root / args.env_file
    frame, embeddings, _event_flags, stats, _meta = validate_bundle(
        args.csv, args.embeddings, reference_dir, root
    )
    print(
        f"Bundle OK: {len(frame):,} reviews, {EXPECTED_NO_EVENT:,} no-event, "
        f"{EXPECTED_EVENT:,} event, embeddings {embeddings.shape}, {len(stats)} stats rows."
    )
    if not args.apply:
        return

    env = load_env_file(env_file)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    require(bool(url), "Missing NEXT_PUBLIC_SUPABASE_URL")
    require(bool(service_key), "Missing SUPABASE_SERVICE_ROLE_KEY")
    project_ref_file = root / "supabase" / ".temp" / "project-ref"
    require(project_ref_file.is_file(), "Supabase project is not linked")
    project_ref = project_ref_file.read_text(encoding="utf-8").strip()
    parsed_url = urlparse(str(url))
    require(
        parsed_url.scheme == "https"
        and parsed_url.hostname == f"{project_ref}.supabase.co"
        and parsed_url.port is None
        and not parsed_url.username
        and not parsed_url.password
        and parsed_url.path in {"", "/"}
        and not parsed_url.query
        and not parsed_url.fragment,
        "Supabase URL does not match the linked project",
    )
    database = SupabaseRest(str(url), str(service_key))

    current_reviews = database.count("reviews", "id")
    require(current_reviews == 0, f"Refusing one-shot load into reviews with {current_reviews:,} existing rows")
    for start in range(0, EXPECTED_ROWS, args.batch_size):
        end = min(start + args.batch_size, EXPECTED_ROWS)
        database.insert_reviews(review_rows(frame, embeddings, start, end), start)
        if end % 1_500 == 0 or end == EXPECTED_ROWS:
            print(f"Loaded reviews: {end:,}/{EXPECTED_ROWS:,}", flush=True)

    database.upsert_market_stats(stats)
    final_reviews = database.count("reviews", "id")
    final_no_event = database.count("reviews", "id", {"is_event": "eq.false"})
    final_event = database.count("reviews", "id", {"is_event": "eq.true"})
    final_stats = database.count("market_stats", "market_code")
    require(final_reviews == EXPECTED_ROWS, f"Unexpected final review count: {final_reviews:,}")
    require(final_no_event == EXPECTED_NO_EVENT, f"Unexpected final no-event count: {final_no_event:,}")
    require(final_event == EXPECTED_EVENT, f"Unexpected final event count: {final_event:,}")
    require(final_stats == 170, f"Unexpected final market_stats count: {final_stats:,}")
    print(
        f"Remote OK: {final_reviews:,} reviews ({final_no_event:,} no-event + {final_event:,} event), "
        f"{final_stats} market_stats rows."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"ERROR: {error}") from None
