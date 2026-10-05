
### Training replica: 1502 self-play hands, 108610 decisions (dmc-v2's final weights, its actors' exploration and exploring starts)

| Phase | Decisions per hand | R² of Q(chosen) |
| --- | ---: | ---: |
| bidding | 17.3 | 0.069 |
| exchange | 5.0 | 0.204 |
| early tricks | 25.0 | 0.520 |
| late tricks | 25.0 | 0.737 |

Bidding decisions: 17.3 a hand, 69.8% in deals later thrown in; passes 87.2%, misdeals 5.3%, bids 7.5% (forced by exploring starts 1.7%, other exploration 11.2%).
R² of Q(chosen): all 0.069; played deal only 0.247; thrown-in only -0.006; against the deal-consistent target (0 for a thrown-in deal) 0.231.
SD of the target: thrown-in 23.6, played 23.3; mean target thrown-in +0.04.
forced bids: 441 (0.29 a hand), mean payoff -21.8, mean Q -18.5.
own bids (not forced): 1511 (1.01 a hand), mean payoff -13.6, mean Q -14.2.
Hands with a contract: 1502 of 1502; the declarer's mean payoff -21.5 (winning bid forced: 335, mean -29.7; not forced: mean -19.2).
The winning bid was the network's greedy choice in 25 hands (mean declarer payoff +6.5), an exploratory or forced one in 1477 (-22.0); commonest winning bids: bid nt13 881, bid nt14 184, bid nt15 85, bid nt16 43, bid ♠14 27, bid ♣15 21.

### dmc-table: 16392 bidding decisions, 300 hands

In deals later thrown in: 90.8%; kinds: bid 355, pass 15031, misdeal 1006

| Subset | n | SD payoff | Q raw | Q fit | simple fit | search raw | search fit | simple+search+Q fit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all (DMC's label) | 5458 | 16.7 | 0.005 | 0.006 | -0.013 | -0.002 | 0.001 | -0.011 |
| played deal only | 486 | 17.3 | 0.088 | 0.095 | 0.017 | 0.010 | 0.015 | 0.028 |
| played deal, bids | 101 | 26.0 | 0.074 | 0.084 | -0.040 | -0.057 | -0.021 | -0.058 |
| played deal, passes | 385 | 13.6 | 0.022 | 0.022 | 0.005 | -0.013 | -0.005 | 0.007 |

Decisions in a played deal where a bid and a pass were both legal: 486. The network's best bid minus pass: mean -20.8, above 0 in 0.8%. The search's (simple bot's cheapest bid in its trump) minus pass: mean -6.6, above 0 in 28.0%, above +3 in 14.8%. Correlation of the two: 0.78.
Where the search says bid and the network says pass: 133 decisions (27.4%), the search's margin averaging +4.1 points.

### normal-table: 30193 bidding decisions, 4000 hands

In deals later thrown in: 28.4%; kinds: bid 6923, pass 21053, misdeal 2217

| Subset | n | SD payoff | Q raw | Q fit | simple fit | search raw | search fit | simple+search+Q fit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all (DMC's label) | 30193 | 11.2 | -1.451 | 0.016 | 0.048 | 0.075 | 0.076 | 0.075 |
| played deal only | 21606 | 11.2 | -1.854 | 0.023 | 0.083 | 0.121 | 0.120 | 0.122 |
| played deal, bids | 5606 | 15.7 | -3.201 | -0.001 | 0.059 | 0.077 | 0.078 | 0.080 |
| played deal, passes | 16000 | 8.7 | -0.591 | 0.011 | 0.017 | 0.081 | 0.081 | 0.082 |

Decisions in a played deal where a bid and a pass were both legal: 21606. The network's best bid minus pass: mean -22.6, above 0 in 0.2%. The search's (simple bot's cheapest bid in its trump) minus pass: mean -3.1, above 0 in 29.3%, above +3 in 12.6%. Correlation of the two: 0.47.
Where the search says bid and the network says pass: 6289 decisions (29.1%), the search's margin averaging +3.5 points.
