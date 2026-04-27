# Example: Fix Issue

This example demonstrates how Rookie Agent can help fix a bug in your codebase.

## Scenario

A user reports that the application crashes when processing files larger than 100MB. The error message indicates a memory issue.

## Prerequisites

- Rookie Agent CLI installed
- A project with a known issue (we'll create one for this example)

## Setup

First, let's create a sample project with a bug:

```bash
mkdir -p /tmp/sample-project
cd /tmp/sample-project
git init

# Create a file with a bug
cat > processFile.js << 'EOF'
const fs = require('fs');

function processFile(filePath) {
  // BUG: This loads the entire file into memory
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').length;
}

module.exports = { processFile };
EOF

# Create a test
cat > test.js << 'EOF'
const { processFile } = require('./processFile');
const fs = require('fs');

// Create a large test file
const largeContent = 'line\n'.repeat(1000000);
fs.writeFileSync('large.txt', largeContent);

console.log('Processing large file...');
const lineCount = processFile('large.txt');
console.log(`File has ${lineCount} lines`);

// Cleanup
fs.unlinkSync('large.txt');
EOF
```

## Using Rookie Agent

### 1. Initialize the Session

```bash
cd /tmp/sample-project
rookie init
```

### 2. Describe the Issue

```
> I have a bug in processFile.js. When processing large files (>100MB), 
> the application crashes with an out-of-memory error. Can you help fix it?
```

### 3. Rookie Agent's Approach

Rookie Agent will:

1. **Investigate**: Read the problematic file
2. **Analyze**: Identify that `readFileSync` loads the entire file into memory
3. **Propose Solution**: Use streaming to process the file line by line
4. **Implement**: Apply the fix
5. **Verify**: Run the test to confirm the fix works

### 4. Expected Fix

Rookie Agent should produce something like:

```javascript
const fs = require('fs');
const readline = require('readline');

async function processFile(filePath) {
  // FIX: Use streaming to process large files efficiently
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
  }

  return lineCount;
}

module.exports = { processFile };
```

### 5. Verify the Fix

```bash
node test.js
```

Output:
```
Processing large file...
File has 1000000 lines
```

## Key Learnings

1. **Memory Efficiency**: Streaming is essential for processing large files
2. **Tool Usage**: Rookie Agent uses `Read`, `Edit`, and `Bash` tools to investigate and fix
3. **Verification**: Always run tests to confirm fixes work
4. **Skill Creation**: After fixing similar issues multiple times, Rookie Agent can suggest creating a "fix-memory-issue" skill

## Related Skills

This example could generate the following skills:

- `fix-memory-issue`: Handle out-of-memory errors
- `optimize-file-processing`: Improve file I/O performance
- `streaming-patterns`: Apply streaming patterns in Node.js

## Next Steps

- Try the [Codebase QA](./codebase-qa) example
- Learn about [Self-optimization](../guide/self-optimization)
