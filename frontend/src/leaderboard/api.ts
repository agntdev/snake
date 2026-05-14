/**
 * Tiny `fetch` wrapper around the leaderboard endpoints from T05.
 *
 * Lives in its own module so the React component stays focused on rendering
 * and so it's trivially mockable in any future tests.
 */

import type { LeaderboardResponse } from '@snake/shared'

export class LeaderboardError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message)
        this.name = 'LeaderboardError'
    }
}

/**
 * Fetch the top-N entries from `/api/leaderboard`.
 *
 * @param limit  Number of entries (server clamps to 1..100).
 * @param signal AbortSignal so the caller can cancel in-flight requests when
 *               unmounting or starting a new poll.
 */
export async function fetchLeaderboard(
    limit: number,
    signal?: AbortSignal,
): Promise<LeaderboardResponse> {
    const url = `/api/leaderboard?limit=${encodeURIComponent(String(limit))}`
    const res = await fetch(url, { signal })
    if (!res.ok) {
        let message = `leaderboard request failed (${res.status})`
        try {
            const body = (await res.json()) as { error?: string }
            if (body?.error) message = body.error
        } catch {
            // Body wasn't JSON — keep the default message.
        }
        throw new LeaderboardError(res.status, message)
    }
    return (await res.json()) as LeaderboardResponse
}
