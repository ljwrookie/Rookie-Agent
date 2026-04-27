# Installation

## Global Install (Recommended)

```bash
npm install -g @rookie-agent/cli
rookie --help
```

## Project-local Install

```bash
npm install --save-dev @rookie-agent/cli
npx rookie --help
```

## From Source

```bash
git clone https://github.com/bytedance/rookie-agent.git
cd rookie-agent
pnpm install
pnpm build
```

## Post-install Check

Run the doctor command to verify your environment:

```bash
rookie doctor
```

Expected output:

```
Node.js     ✅  v22.x
Rust        ✅  rustc 1.8x
Git         ✅  git version 2.x
Network     ✅  Connected
Permissions ✅  Write access
```

## Upgrade

```bash
rookie update
```
