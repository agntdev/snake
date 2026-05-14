import type { Cell, Direction } from '@snake/shared'
import { GAME_BOARD_SIZE } from '@snake/shared'

/**
 * Game lifecycle phases.
 *  - 'idle'    : initial state, awaiting first input / start
 *  - 'running' : tick loop is advancing the snake
 *  - 'paused'  : tick loop is suspended; resumable
 *  - 'gameover': snake hit wall or itself; only resettable
 */
export type GameStatus = 'idle' | 'running' | 'paused' | 'gameover'

export interface GameState {
  /** Snake body, head first. Length >= 1. */
  snake: Cell[]
  /** Currently committed direction (the direction that will be applied on next tick). */
  direction: Direction
  /** Buffered direction queued by user input; applied at the start of next tick. */
  pendingDirection: Direction
  status: GameStatus
  boardSize: number
}

export const INITIAL_SNAKE_LENGTH = 3

/**
 * Builds a fresh game state with a centred snake facing right.
 */
export function createInitialState(boardSize: number = GAME_BOARD_SIZE): GameState {
  const midY = Math.floor(boardSize / 2)
  const startX = Math.floor(boardSize / 2)

  // Head is the right-most cell; tail extends left so the snake faces right.
  const snake: Cell[] = []
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    snake.push({ x: startX - i, y: midY })
  }

  return {
    snake,
    direction: 'right',
    pendingDirection: 'right',
    status: 'idle',
    boardSize,
  }
}

/** Two cells refer to the same board square. */
export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y
}

/** True if the cell lies inside the board bounds. */
export function isInsideBoard(cell: Cell, boardSize: number): boolean {
  return cell.x >= 0 && cell.x < boardSize && cell.y >= 0 && cell.y < boardSize
}
