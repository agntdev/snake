/**
 * Leaderboard panel.
 *
 * Polls `GET /api/leaderboard` every `pollMs` (default 5s) and renders the
 * top-N players in a table. Handles loading, error, and empty states; the
 * polling interval is paused when the document tab is hidden so we don't
 * burn server cycles on background tabs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LeaderboardResponse, ScoreEntry } from '@snake/shared'
import { LeaderboardError, fetchLeaderboard } from './api'

export interface LeaderboardProps {
    /** Number of entries to fetch and render. Default 10. */
    limit?: number
    /** Poll interval in ms. Default 5000. Set to 0 to disable polling. */
    pollMs?: number
}

type Status = 'loading' | 'ready' | 'error'

export function Leaderboard({ limit = 10, pollMs = 5000 }: LeaderboardProps) {
    const [entries, setEntries] = useState<ScoreEntry[]>([])
    const [generatedAt, setGeneratedAt] = useState<string | null>(null)
    const [status, setStatus] = useState<Status>('loading')
    const [error, setError] = useState<string | null>(null)

    // Track the in-flight request so we can cancel it on unmount / next poll.
    const abortRef = useRef<AbortController | null>(null)

    const refresh = useCallback(async () => {
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        try {
            const data: LeaderboardResponse = await fetchLeaderboard(limit, ctrl.signal)
            // Don't clobber state if a newer request has superseded us.
            if (ctrl.signal.aborted) return
            setEntries(data.entries)
            setGeneratedAt(data.generatedAt)
            setStatus('ready')
            setError(null)
        } catch (e) {
            if (ctrl.signal.aborted) return
            const msg =
                e instanceof LeaderboardError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : 'failed to load leaderboard'
            setError(msg)
            // Keep the previous entries visible if we already had some, so a
            // transient network blip doesn't blank the UI.
            setStatus(entries.length > 0 ? 'ready' : 'error')
        }
    }, [limit, entries.length])

    useEffect(() => {
        // Initial load.
        void refresh()
        return () => abortRef.current?.abort()
    }, [refresh])

    useEffect(() => {
        if (pollMs <= 0) return
        let intervalId: number | undefined
        const start = () => {
            stop()
            intervalId = window.setInterval(() => {
                void refresh()
            }, pollMs)
        }
        const stop = () => {
            if (intervalId !== undefined) {
                window.clearInterval(intervalId)
                intervalId = undefined
            }
        }
        const onVisibility = () => {
            if (document.hidden) stop()
            else {
                void refresh()
                start()
            }
        }
        if (!document.hidden) start()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            stop()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [pollMs, refresh])

    return (
        <section className="leaderboard" aria-live="polite">
            <header className="leaderboard__header">
                <h2>Leaderboard</h2>
                <button
                    type="button"
                    className="leaderboard__refresh"
                    onClick={() => void refresh()}
                    aria-label="Refresh leaderboard"
                >
                    Refresh
                </button>
            </header>

            {status === 'loading' && entries.length === 0 && (
                <p className="leaderboard__empty">Loading top scores…</p>
            )}

            {status === 'error' && entries.length === 0 && (
                <p className="leaderboard__error" role="alert">
                    {error ?? 'Unable to load leaderboard.'}
                </p>
            )}

            {entries.length > 0 && (
                <table className="leaderboard__table">
                    <thead>
                        <tr>
                            <th scope="col" className="leaderboard__rank">
                                #
                            </th>
                            <th scope="col">Player</th>
                            <th scope="col" className="leaderboard__score">
                                Score
                            </th>
                            <th scope="col" className="leaderboard__when">
                                When
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry, index) => (
                            <tr key={entry.id}>
                                <td className="leaderboard__rank">{entry.rank ?? index + 1}</td>
                                <td className="leaderboard__player">{entry.player}</td>
                                <td className="leaderboard__score">{entry.score.toLocaleString()}</td>
                                <td className="leaderboard__when">
                                    {formatRelative(entry.createdAt)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {error && entries.length > 0 && (
                <p className="leaderboard__warning" role="status">
                    Last refresh failed: {error}
                </p>
            )}

            {generatedAt && (
                <p className="leaderboard__updated">
                    Updated {formatRelative(generatedAt)}
                </p>
            )}
        </section>
    )
}

/** Render an ISO-8601 timestamp as `Ns ago` / `Nm ago` / `Nh ago` / `Nd ago`. */
function formatRelative(iso: string): string {
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return iso
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
}
