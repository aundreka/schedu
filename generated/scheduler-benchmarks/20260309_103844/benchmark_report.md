# Scheduler Benchmark Results

## Configuration

- Repeats per scenario: 5
- Seed base: 20260309
- Significance tests: paired t-test and Wilcoxon signed-rank (normal approximation)

## Summary (Average Across Scenario × Repeat)

| Rank | Algorithm | n | Objective Mean | Objective CI95 | Coverage % | Lesson Order % | Assess Window % | Load Balance % | Runtime ms | Runtime CI95 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Rules Engine | 20 | 83.564 | 0.534 | 100 | 100 | 49.668 | 57.534 | 0.48 | 0.162 |

## Significance (Objective Score Pairwise)

| Algorithm A | Algorithm B | n pairs | Mean diff A-B | Paired t p-value | Wilcoxon p-value |
|---|---|---:|---:|---:|---:|

## Per Run Detail

| Scenario | Repeat | Seed | Algorithm | Objective | Coverage % | Lesson Order % | Assess Window % | Load Balance % | Runtime ms | Items |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| S1 | 1 | 20260310 | Rules Engine | 84.459 | 100 | 100 | 55.556 | 55.652 | 1.988 | 19 |
| S1 | 2 | 20260311 | Rules Engine | 84.459 | 100 | 100 | 55.556 | 55.652 | 0.324 | 19 |
| S1 | 3 | 20260312 | Rules Engine | 84.459 | 100 | 100 | 55.556 | 55.652 | 0.292 | 19 |
| S1 | 4 | 20260313 | Rules Engine | 84.459 | 100 | 100 | 55.556 | 55.652 | 0.242 | 19 |
| S1 | 5 | 20260314 | Rules Engine | 84.459 | 100 | 100 | 55.556 | 55.652 | 0.314 | 19 |
| S2 | 1 | 20270310 | Rules Engine | 84.978 | 100 | 100 | 56.522 | 57.825 | 0.344 | 41 |
| S2 | 2 | 20270311 | Rules Engine | 84.978 | 100 | 100 | 56.522 | 57.825 | 0.368 | 41 |
| S2 | 3 | 20270312 | Rules Engine | 84.978 | 100 | 100 | 56.522 | 57.825 | 0.36 | 41 |
| S2 | 4 | 20270313 | Rules Engine | 84.978 | 100 | 100 | 56.522 | 57.825 | 0.305 | 41 |
| S2 | 5 | 20270314 | Rules Engine | 84.978 | 100 | 100 | 56.522 | 57.825 | 0.291 | 41 |
| S3 | 1 | 20280310 | Rules Engine | 82.701 | 100 | 100 | 42.308 | 61.594 | 0.46 | 80 |
| S3 | 2 | 20280311 | Rules Engine | 82.701 | 100 | 100 | 42.308 | 61.594 | 0.466 | 80 |
| S3 | 3 | 20280312 | Rules Engine | 82.701 | 100 | 100 | 42.308 | 61.594 | 0.503 | 80 |
| S3 | 4 | 20280313 | Rules Engine | 82.701 | 100 | 100 | 42.308 | 61.594 | 0.636 | 80 |
| S3 | 5 | 20280314 | Rules Engine | 82.701 | 100 | 100 | 42.308 | 61.594 | 0.353 | 80 |
| S4 | 1 | 20290310 | Rules Engine | 82.117 | 100 | 100 | 44.286 | 55.064 | 0.559 | 104 |
| S4 | 2 | 20290311 | Rules Engine | 82.117 | 100 | 100 | 44.286 | 55.064 | 0.39 | 104 |
| S4 | 3 | 20290312 | Rules Engine | 82.117 | 100 | 100 | 44.286 | 55.064 | 0.392 | 104 |
| S4 | 4 | 20290313 | Rules Engine | 82.117 | 100 | 100 | 44.286 | 55.064 | 0.517 | 104 |
| S4 | 5 | 20290314 | Rules Engine | 82.117 | 100 | 100 | 44.286 | 55.064 | 0.495 | 104 |

## Scenarios

- S1: Light Load (8 weeks, 2 meetings/week); lessons=10, WW=3, PT=2, EX=1
- S2: Standard Load (12 weeks, 3 meetings/week); lessons=18, WW=6, PT=4, EX=2
- S3: Dense Load (18 weeks, 4 meetings/week); lessons=28, WW=10, PT=7, EX=3
- S4: Very Dense (20 weeks, 5 meetings/week); lessons=34, WW=12, PT=9, EX=4
