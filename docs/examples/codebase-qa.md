# Example: Codebase QA

This example demonstrates how to use Rookie Agent to understand and query your codebase.

## Scenario

You're a new team member trying to understand how authentication works in a large codebase. Instead of manually tracing through files, you ask Rookie Agent to explain it.

## Prerequisites

- Rookie Agent CLI installed
- A project with authentication logic

## Setup

Let's create a sample project with authentication:

```bash
mkdir -p /tmp/auth-example/src/{auth,middleware,routes}
cd /tmp/auth-example

# Create auth module
cat > src/auth/index.js << 'EOF'
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

class AuthService {
  constructor(userStore) {
    this.userStore = userStore;
  }

  async login(username, password) {
    const user = await this.userStore.findByUsername(username);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return { token, user: { id: user.id, username: user.username } };
  }

  async verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
  }
}

module.exports = { AuthService };
EOF

# Create middleware
cat > src/middleware/auth.js << 'EOF'
const { AuthService } = require('../auth');

function requireAuth(authService) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const payload = await authService.verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = payload;
    next();
  };
}

module.exports = { requireAuth };
EOF

# Create routes
cat > src/routes/auth.js << 'EOF'
const express = require('express');

function createAuthRoutes(authService) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const result = await authService.login(username, password);
      res.json(result);
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  });

  router.post('/logout', (req, res) => {
    // In a stateless JWT setup, logout is handled client-side
    res.json({ message: 'Logged out' });
  });

  return router;
}

module.exports = { createAuthRoutes };
EOF

git init
git add .
git commit -m "Initial auth setup"
```

## Using Rookie Agent

### 1. Start a Session

```bash
cd /tmp/auth-example
rookie
```

### 2. Ask About Authentication

```
> How does authentication work in this codebase? 
> Explain the flow from login to accessing protected routes.
```

### 3. Rookie Agent's Response

Rookie Agent will:

1. **Search** for auth-related files
2. **Read** the key files (`src/auth/index.js`, `src/middleware/auth.js`, `src/routes/auth.js`)
3. **Analyze** the flow
4. **Explain** in natural language

### 4. Expected Explanation

```
## Authentication Flow

1. **Login** (`src/routes/auth.js`):
   - POST /login receives username/password
   - AuthService validates credentials against user store
   - On success, returns JWT token valid for 24 hours

2. **Token Verification** (`src/auth/index.js`):
   - JWT signed with JWT_SECRET
   - Contains userId and username
   - Expires after 24 hours

3. **Protected Routes** (`src/middleware/auth.js`):
   - `requireAuth` middleware checks Authorization header
   - Extracts Bearer token
   - Verifies token with AuthService
   - Attaches user info to request

## Key Files

- `src/auth/index.js` - Core authentication logic
- `src/middleware/auth.js` - Express middleware for protection
- `src/routes/auth.js` - Login/logout endpoints
```

### 5. Follow-up Questions

You can ask follow-up questions:

```
> Where is the JWT_SECRET configured?
> How would I add refresh tokens?
> Show me all files that use requireAuth
```

## Key Learnings

1. **Code Understanding**: Rookie Agent can quickly analyze and explain code structure
2. **Navigation**: Use natural language to find relevant code
3. **Context**: Follow-up questions maintain context from previous queries
4. **Memory**: Rookie Agent remembers explanations for future reference

## Advanced Queries

### Find All Protected Endpoints

```
> Find all routes that use authentication middleware
```

### Security Audit

```
> Are there any security issues in the auth implementation?
```

### Generate Documentation

```
> Generate API documentation for the auth endpoints
```

## Related Skills

- `explain-codebase`: Explain how specific features work
- `find-security-issues`: Identify potential security problems
- `generate-api-docs`: Create API documentation from code

## Next Steps

- Try the [PR Review](./pr-review) example
- Learn about [Memory](../guide/memory)
