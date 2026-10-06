import json
import matplotlib.pyplot as plt
import os


os.makedirs("results/graphs", exist_ok=True)


# -------------------------
# 1. Skew Impact Graph
# -------------------------

with open("results/skew-impact.json") as f:
    skew_data = json.load(f)


exposure = [
    item["exposure"]
    for item in skew_data["long"]
]

impact = [
    item["impact"]
    for item in skew_data["long"]
]


plt.figure(figsize=(8,5))

plt.plot(
    exposure,
    impact,
    marker="o"
)

plt.xlabel("Long Open Interest")
plt.ylabel("Price Impact (%)")
plt.title("Skew Impact Curve")

plt.grid(True)

plt.savefig(
    "results/graphs/skew-impact.png",
    bbox_inches="tight"
)

plt.close()



# -------------------------
# 2. Capacity Stress Graph
# -------------------------

with open("results/capacity-stress.json") as f:
    capacity_data = json.load(f)


capacity_oi = []
prices = []


for item in capacity_data:

    if item.get("status") == "ACCEPTED":

        capacity_oi.append(
            item["longOI"]
        )

        prices.append(
            item["executionPrice"]
        )


plt.figure(figsize=(8,5))

plt.plot(
    capacity_oi,
    prices,
    marker="o"
)

plt.xlabel("Long Open Interest")
plt.ylabel("Execution Price")
plt.title("Capacity Stress Curve")

plt.grid(True)

plt.savefig(
    "results/graphs/capacity-stress.png",
    bbox_inches="tight"
)

plt.close()



# -------------------------
# 3. Recovery Graph
# -------------------------

with open("results/recovery.json") as f:
    recovery_data = json.load(f)


short_oi = [
    item["shortOI"]
    for item in recovery_data
]

recovery_price = [
    item["executionPrice"]
    for item in recovery_data
]


plt.figure(figsize=(8,5))

plt.plot(
    short_oi,
    recovery_price,
    marker="o"
)

plt.xlabel("Short Open Interest")
plt.ylabel("Execution Price")
plt.title("Market Recovery Curve")

plt.grid(True)

plt.savefig(
    "results/graphs/recovery.png",
    bbox_inches="tight"
)

plt.close()


print("Graphs generated successfully")