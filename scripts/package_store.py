#!/usr/bin/env python3
"""Chrome Web Store 提出用の zip を dist から作る。

manifest.json の key は開発版の拡張IDを固定するためのもので、ストアの拡張とは一致しない。
残すとストアが「key フィールドの値が現在のアイテムと一致していません」で受け付けないので、zip からだけ外す。

使い方: npm run build && python3 scripts/package_store.py [出力先フォルダ]
"""
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
dist = root / "dist"
manifest = json.loads((dist / "manifest.json").read_text(encoding="utf-8-sig"))
manifest.pop("key", None)
out_dir = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root
out = out_dir / f"Snap_Goban_v{manifest['version']}.zip"

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(dist.rglob("*")):
        if not f.is_file() or "icons_backup" in f.parts:
            continue
        name = f.relative_to(dist).as_posix()
        if name == "manifest.json":
            z.writestr(name, json.dumps(manifest, ensure_ascii=False, indent=4))
        else:
            z.write(f, name)

print(out)
