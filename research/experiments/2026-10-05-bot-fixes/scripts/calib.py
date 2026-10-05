import json, sys, math, collections

for f in sys.argv[1:]:
    by = collections.defaultdict(lambda: [0, 0])
    byc = collections.defaultdict(lambda: [0, 0, 0.0])
    rows = []
    for line in open(f):
        r = json.loads(line)
        d = r['declarer']
        bids = [b for b in r['bids'] if b['seat'] == d and isinstance(b['action'], dict) and 'Bid' in b['action']]
        if not bids:
            continue
        b = bids[-1]
        c = b['action']['Bid']['count']
        e = b['estimate']
        made = r['team_points'] >= r['contract']['count']
        m = e - c
        k = max(-2, min(6, math.floor(m * 2) / 2))
        by[k][0] += 1
        by[k][1] += made
        cc = r['contract']['count']
        byc[cc][0] += 1
        byc[cc][1] += made
        byc[cc][2] += r['payoffs'][d]
        rows.append((m, made, c))
    print(f, len(rows))
    for k in sorted(by):
        n, mk = by[k]
        print(f"  margin {k:+.1f}: n={n:5d} made {mk / n:.2f}")
    for k in sorted(byc):
        n, mk, p = byc[k]
        print(f"  contract {k}: n={n:5d} made {mk / n:.2f} declarer payoff {p / n:+.2f}")
    a, b = 0.0, 0.3
    for _ in range(3000):
        ga = gb = 0.0
        for m, y, c in rows:
            p = 1 / (1 + math.exp(-(a + b * m)))
            ga += y - p
            gb += (y - p) * m
        a += ga / len(rows)
        b += gb / len(rows) * 0.2
    print(f"  logistic a={a:.3f} b={b:.3f} (50% at margin {-a / b:.2f})")

print("--- by contract and margin")
for f in sys.argv[1:]:
    t = collections.defaultdict(lambda: [0, 0, 0.0])
    for line in open(f):
        r = json.loads(line)
        d = r['declarer']
        bids = [b for b in r['bids'] if b['seat'] == d and isinstance(b['action'], dict) and 'Bid' in b['action']]
        if not bids:
            continue
        b = bids[-1]
        c = b['action']['Bid']['count']
        m = min(3, math.floor(b['estimate'] - c))
        made = r['team_points'] >= r['contract']['count']
        t[(c, m)][0] += 1
        t[(c, m)][1] += made
        t[(c, m)][2] += r['payoffs'][d]
    print(f)
    for k in sorted(t):
        n, mk, p = t[k]
        if n >= 30:
            print(f"  bid {k[0]} margin {k[1]}: n={n:5d} made {mk / n:.2f} payoff {p / n:+.2f}")
