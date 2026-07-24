import base64
import mimetypes
from pathlib import Path

import app as upstream
from flask import jsonify


app = upstream.app
_original_run_code_endpoint = app.view_functions["run_code_endpoint"]
_max_file_bytes = 30 * 1024 * 1024
_allowed_extensions = {
    ".csv",
    ".docx",
    ".html",
    ".json",
    ".md",
    ".pdf",
    ".pptx",
    ".txt",
    ".xls",
    ".xlsx",
    ".xml",
    ".zip",
}
_content_types = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
}
_output_roots = (Path.cwd(), Path("/mnt/data"))


def _snapshot_files():
    snapshot = {}
    for root in _output_roots:
        if not root.exists():
            continue
        for path in root.iterdir():
            if path.is_file():
                try:
                    snapshot[str(path)] = (
                        path.stat().st_mtime_ns,
                        path.stat().st_size,
                    )
                except OSError:
                    pass
    return snapshot


def _collect_generated_files(before):
    files = {}
    for root in _output_roots:
        if not root.exists():
            continue
        for path in root.iterdir():
            if not path.is_file() or path.suffix.lower() not in _allowed_extensions:
                continue

            try:
                stat = path.stat()
            except OSError:
                continue

            current = (stat.st_mtime_ns, stat.st_size)
            if before.get(str(path)) == current or stat.st_size > _max_file_bytes:
                continue

            try:
                encoded = base64.b64encode(path.read_bytes()).decode("ascii")
                files[path.name] = {
                    "base64": encoded,
                    "contentType": _content_types.get(path.suffix.lower())
                    or mimetypes.guess_type(path.name)[0]
                    or "application/octet-stream",
                    "size": stat.st_size,
                }
                path.unlink(missing_ok=True)
            except OSError:
                continue

    return files


def run_code_endpoint_with_files(*args, **kwargs):
    before = _snapshot_files()
    response = app.make_response(_original_run_code_endpoint(*args, **kwargs))
    if response.status_code != 200 or not response.is_json:
        return response

    generated_files = _collect_generated_files(before)
    if not generated_files:
        return response

    payload = response.get_json(silent=True) or {}
    payload["files"] = generated_files
    return jsonify(payload), response.status_code


app.view_functions["run_code_endpoint"] = run_code_endpoint_with_files
