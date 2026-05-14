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

// ---------- Token rewards (T07) --------------------------------------------

/** 1 SNAKE expressed in nano-units. Authoritative on-wire amounts use nano. */
export const SNAKE_NANO_PER_TOKEN = 1_000_000_000

/**
 * Why a token is awarded.
 *   - 'score'  : per-game payout claimed via POST /api/rewards/claim
 *   - 'top1' / 'top3' / 'top10' : reserved for periodic leaderboard bonuses
 *     (T07 ships the placeholder amounts in the bonuses endpoint; payouts
 *     of these reasons land in a follow-up).
 */
export type RewardReason = 'score' | 'top1' | 'top3' | 'top10'

/** A single SNAKE reward row, returned by claim and history endpoints. */
export interface RewardEntry {
  id: string
  playerId: string
  player: string
  scoreId: string | null
  /** Raw SNAKE amount in nano-units. String to avoid JS bigint precision loss. */
  amountNano: string
  /** Convenience whole-SNAKE float; UI-friendly, not authoritative. */
  amountSnake: number
  reason: RewardReason
  /** Human-readable tier label (e.g. `'flat'`, `'bronze'`, `'gold'`). */
  tier: string
  createdAt: string
}

export interface ClaimRewardRequest {
  scoreId: string
}

export interface ClaimRewardResponse {
  reward: RewardEntry
  /** True when the reward already existed and was returned as-is (idempotent claim). */
  alreadyClaimed: boolean
}

export interface MyRewardsResponse {
  rewards: RewardEntry[]
  /** Sum of `amountNano` as a decimal string. */
  totalNano: string
  totalSnake: number
}

export interface LeaderboardBonusEntry {
  position: number
  amountNano: string
  amountSnake: number
}

export interface LeaderboardBonusesResponse {
  bonuses: LeaderboardBonusEntry[]
}
