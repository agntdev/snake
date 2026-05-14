import type { Cell } from '@snake/shared'
import { cellsEqual, type GameState } from './state'
import { canTurn, nextHead } from './movement'
import { isInsideBoard } from './state'

/** Random source — defaults to Math.random, injectable for deterministic tests. */
export type Rng = () => number

/**
 * Pick a random empty cell (not occupied by any snake segment) and return it as the new food.
 * Returns `null` only when the snake fills the entire board (player wins).
 *
 * Uses a candidate-list approach instead of "rejection-sample on a random (x, y)" so it
 * runs in O(boardSize^2) worst case, with no chance of an infinite loop on a near-full board.
 */
export function spawnFood(snake: Cell[], boardSize: number, rng: Rng = Math.random): Cell | null {
  const occupied = new Set<string>()
  for (const seg of snake) occupied.add(`${seg.x},${seg.y}`)

  const free: Cell[] = []
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }

  if (free.length === 0) return null
  const idx = Math.floor(rng() * free.length)
  // Guard against rng() returning exactly 1.0 (rare, but spec-allowed for some PRNGs).
  const safeIdx = Math.min(idx, free.length - 1)
  return free[safeIdx] ?? null
}

/**
 * Single tick of the full game (movement + food + collisions + scoring).
 *
 * Layered on top of the pure movement logic from T02:
 *  1. Resolve next direction (turn buffer)
 *  2. Compute next head
 *  3. Wall collision -> gameover
 *  4. Decide whether food was eaten this tick
 *  5. Self-collision: if eating, the tail does NOT vacate, so check against full body;
 *     otherwise check against body without tail (tail vacates).
 *  6. Build new snake (grow if eaten), respawn food, increment score.
 */
export function tick(state: GameState, rng: Rng = Math.random): GameState {
  if (state.status !== 'running') return state

  const direction = canTurn(state.direction, state.pendingDirection, state.snake.length)
    ? state.pendingDirection
    : state.direction

  const head = state.snake[0]
  if (!head) return state

  const newHead = nextHead(head, direction)

  if (!isInsideBoard(newHead, state.boardSize)) {
    return { ...state, direction, status: 'gameover' }
  }

  const ateFood = state.food !== null && cellsEqual(newHead, state.food)

  // If we eat, the snake grows -> tail stays. If not, tail vacates this tick.
  const bodyAfterMove = ateFood ? state.snake : state.snake.slice(0, -1)
  for (const seg of bodyAfterMove) {
    if (cellsEqual(seg, newHead)) {
      return { ...state, direction, status: 'gameover' }
    }
  }

  const newSnake: Cell[] = [newHead, ...bodyAfterMove]
  const newScore = ateFood ? state.score + 1 : state.score
  const newFood = ateFood ? spawnFood(newSnake, state.boardSize, rng) : state.food

  // Edge case: ate the final empty cell -> snake fills the board, no spawn possible.
  // We still consider that a "running" state so the player sees the win-fill; a gameover
  // would feel wrong because they didn't lose. UI can read score / snake.length to detect.

  return {
    ...state,
    direction,
    snake: newSnake,
    score: newScore,
    food: newFood,
  }
}

/**
 * Convenience: ensure the state has a food cell. Used to seed food when leaving the
 * 'idle' status for the first time (or from a fresh state without food).
 */
export function withInitialFood(state: GameState, rng: Rng = Math.random): GameState {
  if (state.food !== null) return state
  return { ...state, food: spawnFood(state.snake, state.boardSize, rng) }
}
