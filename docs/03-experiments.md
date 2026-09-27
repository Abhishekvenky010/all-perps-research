# Experiments


## Skew coefficient analysis


k = 0.05

Average Price:
111.40


k = 0.2

Average Price:
118.07


k = 1

Average Price:
153.67


Observation:

Higher skew coefficient creates stronger resistance.


## Scenario Testing


Healthy Market:

Average price:
104.11


Long Crowded:

Average price:
137.33


Capacity Stress:

Trade rejected.


Observation:

The model responds differently depending on market conditions.



====================
Healthy Market
====================
Average execution price: 104.11336891094174
Price movement: [
  103.33333333333334,
  103.50336134453781,
  103.67457627118644,
  103.84700854700854,
  104.02068965517242,
  104.19565217391305,
  104.3719298245614,
  104.54955752212389,
  104.72857142857144,
  104.90900900900901
]
Final state: {
  symbol: 'BTC-PERP',
  indexPrice: 100,
  longOpenInterest: 25000,
  shortOpenInterest: 20000
}

====================
Long Crowded Market
====================
Average execution price: 137.3385701587714
Price movement: [
  128,
  129.5157894736842,
  131.17777777777778,
  133.01176470588234,
  135.05,
  137.33333333333334,
  139.9142857142857,
  142.86153846153846,
  146.26666666666668,
  150.25454545454545
]
Final state: {
  symbol: 'BTC-PERP',
  indexPrice: 100,
  longOpenInterest: 70000,
  shortOpenInterest: 20000
}

====================
Capacity Stress
====================
Trade rejected: MARKET_CAPACITY_EXCEEDED