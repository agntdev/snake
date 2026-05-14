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
  /** 1-based position in the leaderboard response (optional, server-supplied). */
  rank?: number
}

export interface SubmitScoreRequest {
  player: string
  score: number
  /** Optional client metadata persisted on the session row. */
  meta?: Record<string, unknown>
}

/** Response shape of `POST /api/scores`. */
export interface SubmitScoreResponse {
  entry: ScoreEntry
  /** Player's all-time best score after this submission. */
  bestScore: number
}

/** Response shape of `GET /api/leaderboard?limit=N`. */
export interface LeaderboardResponse {
  entries: ScoreEntry[]
  /** When the server generated this response, ISO-8601. */
  generatedAt: string
}

/** Response shape of `POST /api/users/register`. */
export interface RegisterUserResponse {
  id: string
  player: string
  /** Bearer token for `X-Player-Token` header on subsequent writes. */
  token: string
}
