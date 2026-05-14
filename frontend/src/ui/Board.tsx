import type { GameState } from '../game/state'
import { cellsEqual } from '../game/state'

interface BoardProps {
  state: GameState
  /** Optional food cell — supplied by T03 once food spawning lands. */
  food?: { x: number; y: number } | null
}

/**
 * CSS-grid renderer. Each cell is a div; only enough DOM nodes for a 20x20 board (400),
 * which is well below any perf concern. Canvas would be premature optimisation here.
 */
export function Board({ state, food = null }: BoardProps) {
  const { boardSize, snake, status } = state
  const head = snake[0] ?? null

  const cells: React.JSX.Element[] = []
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      let className = 'cell'
      if (food && food.x === x && food.y === y) {
        className += ' food'
      }
      const onSnake = snake.some((s) => cellsEqual(s, { x, y }))
      if (onSnake) {
        className += ' snake'
        if (head && head.x === x && head.y === y) className += ' head'
      }
      cells.push(<div key={`${x},${y}`} className={className} />)
    }
  }

  return (
    <div
      className={`board status-${status}`}
      style={{
        gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
        gridTemplateRows: `repeat(${boardSize}, 1fr)`,
      }}
      role="grid"
      aria-label={`Snake board ${boardSize} by ${boardSize}, status ${status}`}
    >
      {cells}
    </div>
  )
}
