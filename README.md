# 🐍 snake

Play classic Snake, climb leaderboards, earn SNAKE tokens.

## Layout

- `frontend/` — Vite + React + TypeScript client
- `backend/` — Express + TypeScript API
- `shared/` — types and constants shared by both ends

## Prerequisites

- Node 20+

## Quickstart

```bash
npm install
npm run dev    # starts frontend (5173) and backend (8787)
```

Other workspace scripts:

```bash
npm run build       # build all workspaces
npm run typecheck   # tsc --noEmit across workspaces
npm run test        # run workspace tests
```
