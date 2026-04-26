# Scheduler Benchmark

Measured against the current planner pipeline: `buildSlots -> buildPacingPlan -> buildBlocks -> placeBlocks -> validatePlan`.

| scenario | label | slot_count | lesson_count | block_count | runtime_ms | validation_errors | utilization_rate_pct | scheduled_required_lessons | total_required_lessons | scheduled_required_ww | total_required_ww | scheduled_required_pt | total_required_pt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| benchmark_light | Light | 12 | 6 | 13 | 428.611 | 2 | 83.333 | 6 | 6 | 4 | 4 | 1 | 1 |
| benchmark_mid | Mid | 30 | 12 | 36 | 840.811 | 2 | 62.857 | 12 | 12 | 8 | 8 | 3 | 3 |
| benchmark_holiday | Holiday Pressure | 41 | 14 | 42 | 18280.245 | 2 | 53.763 | 14 | 14 | 10 | 10 | 4 | 4 |