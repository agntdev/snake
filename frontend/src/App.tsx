import { useEffect, useReducer, useRef } from 'react'
import { GAME_BOARD_SIZE, TICK_MS } from '@snake/shared'
import { createInitialState, type GameState } from './game/state'
import { keyToDirection, requestDirection, resetGame } from './game/movement'
import { tick, withInitialFood } from './game/food'
import { Board } from './ui/Board'
import { Leaderboard } from './leaderboard/Leaderboard'

type Action =
  | { type: 'tick' }
  | { type: 'turn'; key: string }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'tick':
      return tick(state)
    case 'turn': {
      const dir = keyToDirection(action.key)
      if (!dir) return state
      const turned = requestDirection(state, dir)
      // First arrow press also kicks the game off from idle (and seeds food).
      if (turned.status === 'idle') {
        return { ...withInitialFood(turned), status: 'running' }
      }
      return turned
    }
    case 'start':
      if (state.status === 'gameover') return withInitialFood(resetGame(state))
      if (state.status === 'idle') return { ...withInitialFood(state), status: 'running' }
      return { ...state, status: 'running' }
    case 'pause':
      if (state.status !== 'running') return state
      return { ...state, status: 'paused' }
    case 'reset':
      return resetGame(state)
    default:
      return state
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    createInitialState(GAME_BOARD_SIZE),
  )
  const stateRef = useRef(state)
  stateRef.current = state

  // Keyboard handling — bound once, reads latest state via ref.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ') {
        e.preventDefault()
        const status = stateRef.current.status
        if (status === 'running') dispatch({ type: 'pause' })
        else dispatch({ type: 'start' })
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        dispatch({ type: 'reset' })
        return
      }
      if (keyToDirection(e.key)) {
        e.preventDefault()
        dispatch({ type: 'turn', key: e.key })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Tick loop — only runs when state.status === 'running'.
  useEffect(() => {
    if (state.status !== 'running') return
    const id = window.setInterval(() => dispatch({ type: 'tick' }), TICK_MS)
    return () => window.clearInterval(id)
  }, [state.status])

  return (
    <main>
      <h1>🐍 Snake</h1>
      <p className="hud">
        Status: <strong>{state.status}</strong> · Score: {state.score} · Length: {state.snake.length}
      </p>
      <Board state={state} food={state.food} />
      <p className="help">
        Arrows / WASD to move · Space to pause/resume · R to reset
      </p>
      <Leaderboard limit={10} pollMs={5000} />
    </main>
  )
}
