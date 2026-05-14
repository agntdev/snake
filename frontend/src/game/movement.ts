import type { Cell, Direction } from '@snake/shared'
import {
  cellsEqual,
  createInitialState,
  isInsideBoard,
  type GameState,
} from './state'

const DELTAS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITES: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

/** Returns the cell that lies one step in `direction` from `cell`. */
export function nextHead(cell: Cell, direction: Direction): Cell {
  const d = DELTAS[direction]
  return { x: cell.x + d.x, y: cell.y + d.y }
}

/**
 * Validates a requested direction change against the snake's current heading.
 * 180-degree reversals are rejected (a 1-tick reversal would walk the snake into itself).
 * A length-1 snake can turn freely.
 */
export function canTurn(current: Direction, requested: Direction, snakeLength: number): boolean {
  if (snakeLength <= 1) return true
  return OPPOSITES[current] !== requested
}

/**
 * Buffers a direction change. Does NOT mutate `direction` directly — that only flips
 * on the next tick, so a user can't double-input within one tick to suicide.
 */
export function requestDirection(state: GameState, requested: Direction): GameState {
  if (state.status === 'gameover') return state
  if (!canTurn(state.direction, requested, state.snake.length)) return state
  if (state.pendingDirection === requested) return state
  return { ...state, pendingDirection: requested }
}

/**
 * Advance one tick of pure movement (no food, no growth).
 * - Commits pendingDirection
 * - Computes new head
 * - Detects wall collision -> gameover
 * - Detects self collision (against the body that *will* exist after moving the tail) -> gameover
 *
 * Returns a new state; the input is left untouched.
 *
 * NOTE: T03 layers food / growth on top of this primitive via `tick()` in food.ts.
 * Keeping movement pure-and-small makes both layers independently testable.
 */
export function stepMovement(state: GameState): GameState {
  if (state.status !== 'running') return state

  const direction = canTurn(state.direction, state.pendingDirection, state.snake.length)
    ? state.pendingDirection
    : state.direction

  const head = state.snake[0]
  if (!head) return state // unreachable: snake is always length >= 1 by construction

  const newHead = nextHead(head, direction)

  if (!isInsideBoard(newHead, state.boardSize)) {
    return { ...state, direction, status: 'gameover' }
  }

  // The tail cell will be vacated this tick (no growth here), so colliding with the
  // current tail position is allowed. Compare against snake.slice(0, -1) only.
  const bodyAfterMove = state.snake.slice(0, -1)
  for (const segment of bodyAfterMove) {
    if (cellsEqual(segment, newHead)) {
      return { ...state, direction, status: 'gameover' }
    }
  }

  const newSnake: Cell[] = [newHead, ...bodyAfterMove]
  return { ...state, direction, snake: newSnake }
}

/** Reset to a fresh game on the same board. */
export function resetGame(state: GameState): GameState {
  return createInitialState(state.boardSize)
}

/** Map a KeyboardEvent.key to a Direction, or null if it's not an arrow / WASD key. */
export function keyToDirection(key: string): Direction | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up'
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down'
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left'
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right'
    default:
      return null
  }
}
