# Self-Optimization

Rookie Agent can improve its own prompts through automated evaluation.

## How It Works

1. **Baseline**: Run benchmark with current prompt
2. **Mutate**: Generate prompt variants (paraphrase, reorder, condense)
3. **Evaluate**: Run benchmark for each variant
4. **Select**: Choose the best-performing prompt
5. **Rollback**: Revert if performance degrades

## Running Optimization

```bash
# Create a benchmark suite
rookie-eval init-suite my-suite

# Run optimization
rookie-eval optimize my-skill my-suite
```

## Benchmark Format

```jsonl
{"id":"case-1","task":"Fix bug","expected":"PASS","verifyCmd":"npm test","tags":["bugfix"]}
```

## Reports

Optimization reports are saved to `docs/eval/evolution-<skill>.md`.
