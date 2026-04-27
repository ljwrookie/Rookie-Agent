# Example: PR Review

This example demonstrates how Rookie Agent can help review pull requests.

## Scenario

You're reviewing a PR that adds a new feature. Rookie Agent helps by analyzing the changes, checking for issues, and providing structured feedback.

## Prerequisites

- Rookie Agent CLI installed
- A git repository with a feature branch

## Setup

Let's create a sample PR:

```bash
mkdir -p /tmp/pr-review-example
cd /tmp/pr-review-example
git init

# Create initial files
cat > calculator.js << 'EOF'
class Calculator {
  add(a, b) {
    return a + b;
  }

  subtract(a, b) {
    return a - b;
  }
}

module.exports = { Calculator };
EOF

cat > test.js << 'EOF'
const { Calculator } = require('./calculator');
const assert = require('assert');

const calc = new Calculator();
assert.strictEqual(calc.add(2, 3), 5);
assert.strictEqual(calc.subtract(5, 3), 2);
console.log('Tests passed');
EOF

git add .
git commit -m "Initial calculator"

# Create feature branch
git checkout -b feature/multiply-divide

# Add new features (with a bug)
cat > calculator.js << 'EOF'
class Calculator {
  add(a, b) {
    return a + b;
  }

  subtract(a, b) {
    return a - b;
  }

  multiply(a, b) {
    return a * b;
  }

  divide(a, b) {
    // BUG: No division by zero check
    return a / b;
  }
}

module.exports = { Calculator };
EOF

cat > test.js << 'EOF'
const { Calculator } = require('./calculator');
const assert = require('assert');

const calc = new Calculator();

// Existing tests
assert.strictEqual(calc.add(2, 3), 5);
assert.strictEqual(calc.subtract(5, 3), 2);

// New tests
assert.strictEqual(calc.multiply(4, 3), 12);
assert.strictEqual(calc.divide(12, 4), 3);

console.log('All tests passed');
EOF

git add .
git commit -m "Add multiply and divide operations"

# Go back to main
git checkout main
```

## Using Rookie Agent

### 1. Start Review

```bash
cd /tmp/pr-review-example
rookie
```

### 2. Request PR Review

```
> Review the feature/multiply-divide branch. 
> Check for code quality, bugs, and test coverage.
```

### 3. Rookie Agent's Review

Rookie Agent will:

1. **Fetch** the PR diff
2. **Analyze** changes line by line
3. **Check** for common issues
4. **Run** tests
5. **Generate** a review report

### 4. Expected Review Output

```markdown
## PR Review: feature/multiply-divide

### Summary
- Files changed: 2
- Lines added: 15
- Lines removed: 2
- Test status: ✅ Passing

### Changes

#### calculator.js
- ✅ Added `multiply()` method - clean implementation
- ⚠️ Added `divide()` method - **missing division by zero check**

#### test.js
- ✅ Tests added for new operations
- ⚠️ No test for edge cases (division by zero)

### Issues Found

**[MEDIUM] Division by zero vulnerability**
```javascript
divide(a, b) {
  // BUG: No division by zero check
  return a / b;
}
```

Recommendation:
```javascript
divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}
```

### Suggestions

1. Add input validation for all operations
2. Add test for division by zero
3. Consider adding TypeScript types

### Overall Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| Correctness | 7/10 | Division by zero bug |
| Tests | 6/10 | Missing edge cases |
| Code Style | 8/10 | Clean and readable |
| Documentation | 5/10 | No JSDoc comments |

**Verdict**: Request changes - fix division by zero before merging
```

### 5. Apply Fixes

After the review, you can ask Rookie Agent to fix the issues:

```
> Fix the division by zero issue in the PR
```

## Key Learnings

1. **Automated Review**: Consistent checks for every PR
2. **Bug Detection**: Catch common issues before they reach production
3. **Structured Feedback**: Clear, actionable review comments
4. **Integration**: Can be integrated with CI/CD pipelines

## CLI Integration

You can also use the CLI for PR review:

```bash
# Review current branch against main
rookie review --base main

# Review specific branch
rookie review --branch feature/multiply-divide --base main

# Generate review report
rookie review --format markdown --output review.md
```

## Custom Review Rules

Create `.rookie/review-rules.md` to customize the review:

```markdown
# Review Rules

## Checklist
- [ ] All new code has tests
- [ ] No console.log statements
- [ ] Error handling implemented
- [ ] JSDoc comments added

## Patterns to Flag
- Division without zero check
- SQL without parameterization
- Hardcoded secrets
```

## Related Skills

- `review-pr`: Automated PR review
- `check-security`: Security-focused code review
- `suggest-refactor`: Code improvement suggestions

## Next Steps

- Try the [Daily Standup](./daily-standup) example
- Learn about [Hooks](../guide/hooks)
