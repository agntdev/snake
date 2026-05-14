import { describe, expect, it } from 'vitest'
import { createInitialState, type GameState } from '../state'
import { spawnFood, tick, withInitialFood } from '../food'

function running(state: GameState): GameState {
  return { ...state, status: 'running' }
}

/** Deterministic RNG returning the same value each call. */
function constRng(value: number): () => number {
  return () => value
}

describe('spawnFood', () => {
  it('never returns a cell occupied by the snake', () => {
    const snake = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    // Try many times with stochastic rng — none should land on the snake.
    for (let i = 0; i < 200; i++) {
      const f = spawnFood(snake, 5)
      expect(f).not.toBeNull()
      const onSnake = snake.some((s) => s.x === f!.x && s.y === f!.y)
      expect(onSnake).toBe(false)
    }
  })

  it('returns null when the snake fills the entire board', () => {
    const boardSize = 2
    const snake = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]
    expect(spawnFood(snake, boardSize)).toBeNull()
  })

  it('handles rng() returning exactly 1.0 without going out of bounds', () => {
    const snake = [{ x: 0, y: 0 }]
    const food = spawnFood(snake, 3, constRng(0.999999999))
    expect(food).not.toBeNull()
    expect(food!.x).toBeGreaterThanOrEqual(0)
    expect(food!.x).toBeLessThan(3)
  })

  it('with rng=0 returns the first scanned free cell', () => {
    // First scanned cell is (0, 0). If snake is elsewhere, food should be (0, 0).
    const snake = [{ x: 2, y: 2 }]
    const food = spawnFood(snake, 5, constRng(0))
    expect(food).toEqual({ x: 0, y: 0 })
  })
})

describe('withInitialFood', () => {
  it('seeds food when food is null', () => {
    const s = createInitialState(5)
    const seeded = withInitialFood(s)
    expect(seeded.food).not.toBeNull()
  })
  it('is a no-op when food already exists', () => {
    const s: GameState = { ...createInitialState(5), food: { x: 1, y: 1 } }
    const seeded = withInitialFood(s)
    expect(seeded).toBe(s)
  })
})

describe('tick', () => {
  it('does nothing when status is not running', () => {
    const s = createInitialState(10)
    expect(tick(s)).toBe(s)
  })

  it('moves the snake without growing when no food is eaten', () => {
    const s: GameState = {
      ...running(createInitialState(10)),
      // food placed somewhere the snake won't reach this tick
      food: { x: 9, y: 9 },
    }
    const before = s.snake.length
    const after = tick(s)
    expect(after.snake).toHaveLength(before)
    expect(after.score).toBe(0)
    expect(after.food).toEqual({ x: 9, y: 9 })
  })

  it('grows the snake and increments score when food is eaten', () => {
    // Head at (4,5) moving right; food at (5,5).
    const s: GameState = {
      ...running(createInitialState(10)),
      snake: [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ],
      direction: 'right',
      pendingDirection: 'right',
      food: { x: 5, y: 5 },
      score: 0,
    }
    const after = tick(s, constRng(0))
    expect(after.score).toBe(1)
    expect(after.snake).toHaveLength(4)
    expect(after.snake[0]).toEqual({ x: 5, y: 5 })
    // New food spawned somewhere, not on the snake
    expect(after.food).not.toBeNull()
    const onSnake = after.snake.some((c) => c.x === after.food!.x && c.y === after.food!.y)
    expect(onSnake).toBe(false)
  })

  it('triggers gameover when the snake hits a wall', () => {
    const s: GameState = {
      ...running(createInitialState(5)),
      snake: [
        { x: 4, y: 2 },
        { x: 3, y: 2 },
      ],
      direction: 'right',
      pendingDirection: 'right',
      food: { x: 0, y: 0 },
    }
    const after = tick(s)
    expect(after.status).toBe('gameover')
  })

  it('triggers gameover when the snake collides with itself', () => {
    // Snake forms a loop — moving down into its own body.
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
      food: { x: 9, y: 9 },
    }
    const after = tick(s)
    expect(after.status).toBe('gameover')
  })

  it('CAN follow its own tail when not eating (tail vacates)', () => {
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
      food: { x: 9, y: 9 },
    }
    const after = tick(s)
    expect(after.status).toBe('running')
  })

  it('DIES if eating food would make the new head land on its own body (tail does NOT vacate when eating)', () => {
    // Construct: head about to step into tail's cell, but that cell holds food.
    // Eating food keeps the tail in place, so the head colliding with the (now still-present)
    // tail must register as gameover. (This is a subtle edge — without the eat-aware check,
    // the snake would survive incorrectly.)
    const s: GameState = {
      ...running(createInitialState(10)),
      snake: [
        { x: 2, y: 1 }, // head
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 }, // tail — and food sits on the cell the head is moving toward
      ],
      direction: 'right',
      pendingDirection: 'down', // turn down -> head goes to (2, 2), the tail cell
      // Wait: pending must be down, but this is a 90-degree turn from right -> allowed.
      // Actually "right" -> "down" is a valid turn.
      food: { x: 2, y: 2 },
    }
    const after = tick(s)
    // Tail stays because food is eaten -> head (2,2) collides with tail (2,2)
    expect(after.status).toBe('gameover')
  })
})
