# tools\check_impact.py  (root se: python tools\check_impact.py)
import json
from collections import Counter

d = json.load(open(r"server\data\impact.json", encoding="utf-8"))
imp = [x for x in d if x["alert"] != "LOW"]
print("impacted:", len(imp), "/", len(d))
print("alert:", dict(Counter(x["alert"] for x in imp)))
print("arrival method:", dict(Counter(x["arrivalMethod"] for x in imp)))

print("\n--- south of 30.3N (Rishikesh side), depth ke hisaab se ---")
south = sorted((x for x in imp if x["lat"] < 30.3), key=lambda x: -x["maxDepthM"])
for x in south[:15]:
    print(f'{x["name"]!s:28} lat={x["lat"]}  depth={x["maxDepthM"]:>6} m  arr={x["arrivalTimeH"]} h ({x["arrivalMethod"]})')
print("south count:", len(south))

print("\n--- overall top 15 by depth ---")
for x in sorted(imp, key=lambda x: -x["maxDepthM"])[:15]:
    print(f'{x["name"]!s:28} lat={x["lat"]}  depth={x["maxDepthM"]:>6} m  arr={x["arrivalTimeH"]} h ({x["arrivalMethod"]})')

print("\n--- interpolated arrivals (asli time wale) ---")
for x in sorted((x for x in imp if x["arrivalMethod"] == "interpolated"), key=lambda x: x["arrivalTimeH"])[:15]:
    print(f'{x["name"]!s:28} lat={x["lat"]}  arr={x["arrivalTimeH"]} h  depth={x["maxDepthM"]} m')