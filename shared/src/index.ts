export const GAME_BOARD_SIZE = 20
export const TICK_MS = 120

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Cell {
  x: number
  y: number
}

export interface ScoreEntry {
  id: string
  player: string
  score: number
  createdAt: string
}

export interface SubmitScoreRequest {
  player: string
  score: number
}
