import numpy as np

Vw = 3.54e9      # m3, reservoir volume
Hw = 240.0       # m, water depth above breach bottom (Tehri ~260 m high; verify)
BASE = 500.0     # m3/s, pre-breach flow (u01 jaisa)
PRE_H = 1.0      # h, pre-breach baseline
SIM_H = 12.0     # h total
DT_MIN = 10

Qp = 0.607 * Vw**0.295 * Hw**1.24            # Froehlich (1995) peak, m3/s
tf = 0.00254 * Vw**0.53 * Hw**-0.90          # Froehlich (1995) formation time, h
base_h = 2 * Vw / Qp / 3600                  # triangular hydrograph: volume = Vw
fall_h = max(base_h - tf, 0.5)

print(f"Qp = {Qp:,.0f} m3/s | tf = {tf:.2f} h | base = {tf + fall_h:.2f} h")

t = np.arange(0, SIM_H * 60 + 1, DT_MIN) / 60.0
t0, tp, te = PRE_H, PRE_H + tf, PRE_H + tf + fall_h
q = np.where(t < t0, BASE,
    np.where(t < tp, BASE + (Qp) * (t - t0) / tf,
    np.where(t < te, BASE + Qp * (te - t) / fall_h, BASE)))

with open("breach_hydrograph.csv", "w", encoding="utf-8") as f:
    f.write("hours,Q_m3s\n")
    for a, b in zip(t, q):
        f.write(f"{a:.3f},{b:.0f}\n")
print("written breach_hydrograph.csv (10 min steps)")
print("Q column HEC-RAS mein paste karo, interval = 10MIN")
