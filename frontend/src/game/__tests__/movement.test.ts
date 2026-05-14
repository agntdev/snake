import { describe, expect, it } from 'vitest'
import { createInitialState, type GameState } from '../state'
import {
  canTurn,
  keyToDirection,
  nextHead,
  requestDirection,
  resetGame,
  stepMovement,
} from '../movement'

function running(state: GameState): GameState {
  return { ...state, status: 'running' }
}

describe('nextHead', () => {
  it('moves up by decrementing y', () => {
    expect(nextHead({ x: 5, y: 5 }, 'up')).toEqual({ x: 5, y: 4 })
  })
  it('moves down by incrementing y', () => {
    expect(nextHead({ x: 5, y: 5 }, 'down')).toEqual({ x: 5, y: 6 })
  })
  it('moves left/right on the x axis', () => {
    expect(nextHead({ x: 5, y: 5 }, 'left')).toEqual({ x: 4, y: 5 })
    expect(nextHead({ x: 5, y: 5 }, 'right')).toEqual({ x: 6, y: 5 })
  })
})

describe('canTurn', () => {
  it('rejects 180-degree reversal for snake longer than 1', () => {
    expect(canTurn('right', 'left', 3)).toBe(false)
    expect(canTurn('up', 'down', 3)).toBe(false)
  })
  it('allows perpendicular turns', () => {
    expect(canTurn('right', 'up', 3)).toBe(true)
    expect(canTurn('right', 'down', 3)).toBe(true)
  })
  it('allows reversal for length-1 snake', () => {
    expect(canTurn('right', 'left', 1)).toBe(true)
  })
})

describe('keyToDirection', () => {
  it('maps arrow keys', () => {
    expect(keyToDirection('ArrowUp')).toBe('up')
    expect(keyToDirection('ArrowDown')).toBe('down')
    expect(keyToDirection('ArrowLeft')).toBe('left')
    expect(keyToDirection('ArrowRight')).toBe('right')
  })
  it('maps WASD', () => {
    expect(keyToDirection('w')).toBe('up')
    expect(keyToDirection('S')).toBe('down')
  })
  it('returns null for unknown keys', () => {
    expect(keyToDirection('Enter')).toBeNull()
    expect(keyToDirection('q')).toBeNull()
  })
})

describe('requestDirection', () => {
  it('buffers a valid turn into pendingDirection without changing direction', () => {
    const s = running(createInitialState(20))
    const next = requestDirection(s, 'up')
    expect(next.pendingDirection).toBe('up')
    expect(next.direction).toBe('right') // unchanged until tick
  })
  it('rejects reversal', () => {
    const s = running(createInitialState(20))
    const next = requestDirection(s, 'left')
    expect(next).toBe(s) // reference equality — no-op
  })
  it('does nothing when game is over', () => {
    const s: GameState = { ...running(createInitialState(20)), status: 'gameover' }
    expect(requestDirection(s, 'up')).toBe(s)
  })
})

describe('stepMovement', () => {
  it('does not advance unless status is running', () => {
    const idle = createInitialState(20)
    expect(stepMovement(idle)).toBe(idle)
  })
  it('shifts the snake one cell in the current direction without growing', () => {
    const s = running(createInitialState(20))
    const after = stepMovement(s)
    expect(after.snake).toHaveLength(s.snake.length)
    const head = s.snake[0]!
    expect(after.snake[0]).toEqual({ x: head.x + 1, y: head.y })
  })
  it('commits pendingDirection on tick', () => {
    const s = requestDirection(running(createInitialState(20)), 'up')
    const after = stepMovement(s)
    expect(after.direction).toBe('up')
    const head = s.snake[0]!
    expect(after.snake[0]).toEqual({ x: head.x, y: head.y - 1 })
  })
  it('triggers gameover on wall collision', () => {
    // Place head at right edge, moving right
    const s: GameState = {
      ...running(createInitialState(5)),
      snake: [
        { x: 4, y: 2 },
        { x: 3, y: 2 },
        { x: 2, y: 2 },
      ],
      direction: 'right',
      pendingDirection: 'right',
    }
    const after = stepMovement(s)
    expect(after.status).toBe('gameover')
    // Snake position is preserved on death
    expect(after.snake).toEqual(s.snake)
  })
  it('triggers gameover on self-collision', () => {
    // Snake forms a U; turning into its own body should kill it.
    // Body: head (2,1) - (1,1) - (1,2) - (2,2). Move down -> (2,2) which is body.
    const s: GameState = {
      ...running(createInitialState(10)),
      snake: [
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      direction: 'down',
      pendingDirection: 'down',
    }
    const after = stepMovement(s)
    expect(after.status).toBe('gameover')
  })
  it('allows the snake to follow its own tail (tail vacates)', () => {
    // Snake of length 4 chasing its tail in a tight loop should NOT die when head
    // would land on the current tail cell — that cell is vacated this tick.
    const s: GameState = {
      ...running(createInitialState(10)),
      snake: [
        { x: 2, y: 1 }, // head
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 }, // tail
      ],
      direction: 'right',
      pendingDirection: 'right',
    }
    const after = stepMovement(s)
    // Head moves to (3,1); old tail (2,2) is gone.
    expect(after.status).toBe('running')
    expect(after.snake[0]).toEqual({ x: 3, y: 1 })
    expect(after.snake).toHaveLength(4)
  })
})

describe('resetGame', () => {
  it('returns a fresh state with same boardSize', () => {
    const s = createInitialState(15)
    const dead: GameState = { ...s, status: 'gameover', snake: [{ x: 0, y: 0 }] }
    const reset = resetGame(dead)
    expect(reset.boardSize).toBe(15)
    expect(reset.status).toBe('idle')
    expect(reset.snake.length).toBeGreaterThan(1)
  })
})
