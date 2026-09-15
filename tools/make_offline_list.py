"""Writes offline-files.json: every file sw.js saves to the device so the game runs offline.

Run from the repo root after adding or renaming assets:  python3 tools/make_offline_list.py
"""
import json
import os

ROOTS = ["Scripts", "Assets/Audio", "Assets/Images", "Assets/Font"]
EXTRA = ["index.html", "manifest.webmanifest"]
SKIP_EXT = {".txt", ".iml", ".psd", ".md"}

files = list(EXTRA)
total = sum(os.path.getsize(f) for f in EXTRA)
for root in ROOTS:
    for folder, _, names in os.walk(root):
        for name in sorted(names):
            if name.startswith(".") or os.path.splitext(name)[1].lower() in SKIP_EXT:
                continue
            path = os.path.join(folder, name).replace(os.sep, "/")
            files.append(path)
            total += os.path.getsize(path)

with open("offline-files.json", "w") as out:
    json.dump({"bytes": total, "files": sorted(files)}, out, indent=0)
print(f"{len(files)} files, {total / 1048576:.0f} MB")
