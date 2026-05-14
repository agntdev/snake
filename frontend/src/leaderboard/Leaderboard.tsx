/**
 * Leaderboard panel.
 *
 * Polls `GET /api/leaderboard` every `pollMs` (default 5s) and renders the
 * top-N players in a table. Handles loading, error, and empty states; the
 * polling interval is paused when the document tab is hidden so we don't
 * burn server cycles on background tabs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    ConversionConfig,
    LeaderboardResponse,
    RewardTierConfig,
    ScoreEntry,
} from '@snake/shared'
import {
    LeaderboardError,
    claimReward,
    fetchLeaderboard,
    fetchRewardsConfig,
    registerPlayer,
} from './api'

const IDENTITY_STORAGE_KEY = 'snake.identity.v1'

interface PlayerIdentity {
    handle: string
    token: string
}

function loadIdentity(): PlayerIdentity | null {
    try {
        const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<PlayerIdentity>
        if (typeof parsed.handle === 'string' && typeof parsed.token === 'string') {
            return { handle: parsed.handle, token: parsed.token }
        }
        return null
    } catch {
        return null
    }
}

function saveIdentity(identity: PlayerIdentity): void {
    try {
        window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity))
    } catch {
        // localStorage disabled — claim button still works for the session.
    }
}

/**
 * Pick the highest tier whose `minScore <= score`. Mirrors the server-side
 * `pickTier` so the UI can label rows without a server round-trip per row.
 */
function pickTierForScore(
    tiers: ReadonlyArray<RewardTierConfig>,
    score: number,
): RewardTierConfig | null {
    if (tiers.length === 0) return null
    const sorted = [...tiers].sort((a, b) => a.minScore - b.minScore)
    let chosen: RewardTierConfig = sorted[0]!
    for (const t of sorted) {
        if (t.minScore <= score) chosen = t
        else break
    }
    return chosen
}

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

    // Active reward conversion config, fetched once on mount. Used to label
    // each row with its tier (bronze/silver/gold/legendary) without polling
    // the server per row.
    const [conversion, setConversion] = useState<ConversionConfig | null>(null)

    // Player identity — persisted in localStorage. The claim button is only
    // shown on rows whose `player` matches the saved handle (case-insensitive).
    const [identity, setIdentity] = useState<PlayerIdentity | null>(() => loadIdentity())
    const [handleInput, setHandleInput] = useState('')
    const [identityError, setIdentityError] = useState<string | null>(null)
    const [claimState, setClaimState] = useState<{
        scoreId: string
        status: 'pending' | 'ok' | 'err'
        message: string
    } | null>(null)

    const onSaveIdentity = useCallback(async () => {
        const handle = handleInput.trim()
        if (!handle) return
        setIdentityError(null)
        try {
            const reg = await registerPlayer(handle)
            const next: PlayerIdentity = { handle: reg.player, token: reg.token }
            saveIdentity(next)
            setIdentity(next)
            setHandleInput('')
        } catch (e) {
            setIdentityError(e instanceof Error ? e.message : 'failed to register')
        }
    }, [handleInput])

    const onClaim = useCallback(
        async (entry: ScoreEntry) => {
            if (!identity) return
            setClaimState({ scoreId: entry.id, status: 'pending', message: 'Claiming…' })
            try {
                const res = await claimReward(entry.id, identity.token)
                const verb = res.alreadyClaimed ? 'Already claimed' : 'Claimed'
                setClaimState({
                    scoreId: entry.id,
                    status: 'ok',
                    message: `${verb}: ${res.reward.amountSnake.toLocaleString()} SNAKE (${res.reward.tier})`,
                })
            } catch (e) {
                setClaimState({
                    scoreId: entry.id,
                    status: 'err',
                    message: e instanceof Error ? e.message : 'claim failed',
                })
            }
        },
        [identity],
    )

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

    // Fetch the conversion config once. Failures are non-fatal: rows simply
    // skip the tier badge if we never get a config.
    useEffect(() => {
        const ctrl = new AbortController()
        fetchRewardsConfig(ctrl.signal)
            .then((res) => setConversion(res.config))
            .catch(() => {
                /* silent — tier badges will be hidden */
            })
        return () => ctrl.abort()
    }, [])

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
                            <th scope="col" className="leaderboard__reward">
                                Reward
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry, index) => {
                            const isMine =
                                identity !== null &&
                                entry.player.toLowerCase() === identity.handle.toLowerCase()
                            const claimMsg =
                                claimState && claimState.scoreId === entry.id ? claimState : null
                            const tier = conversion
                                ? pickTierForScore(conversion.tiers, entry.score)
                                : null
                            return (
                                <tr key={entry.id}>
                                    <td className="leaderboard__rank">{entry.rank ?? index + 1}</td>
                                    <td className="leaderboard__player">
                                        {entry.player}
                                        {tier && (
                                            <span
                                                className={`leaderboard__tier leaderboard__tier--${tier.label}`}
                                                title={`Tier ${tier.label} (×${tier.multiplier})`}
                                            >
                                                {tier.label}
                                            </span>
                                        )}
                                    </td>
                                    <td className="leaderboard__score">
                                        {entry.score.toLocaleString()}
                                    </td>
                                    <td className="leaderboard__when">
                                        {formatRelative(entry.createdAt)}
                                    </td>
                                    <td className="leaderboard__reward">
                                        {isMine ? (
                                            <button
                                                type="button"
                                                className="leaderboard__claim"
                                                onClick={() => void onClaim(entry)}
                                                disabled={claimMsg?.status === 'pending'}
                                            >
                                                {claimMsg?.status === 'pending'
                                                    ? '…'
                                                    : 'Claim'}
                                            </button>
                                        ) : (
                                            <span className="leaderboard__reward-dash">—</span>
                                        )}
                                        {claimMsg && (
                                            <span
                                                className={
                                                    claimMsg.status === 'err'
                                                        ? 'leaderboard__claim-msg leaderboard__claim-msg--err'
                                                        : 'leaderboard__claim-msg'
                                                }
                                                role="status"
                                            >
                                                {claimMsg.message}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}

            <div className="leaderboard__identity">
                {identity ? (
                    <p className="leaderboard__identity-status">
                        Playing as <strong>{identity.handle}</strong>{' '}
                        <button
                            type="button"
                            className="leaderboard__identity-clear"
                            onClick={() => {
                                window.localStorage.removeItem(IDENTITY_STORAGE_KEY)
                                setIdentity(null)
                            }}
                            aria-label="Forget player identity"
                        >
                            forget
                        </button>
                    </p>
                ) : (
                    <form
                        className="leaderboard__identity-form"
                        onSubmit={(e) => {
                            e.preventDefault()
                            void onSaveIdentity()
                        }}
                    >
                        <label htmlFor="snake-handle" className="leaderboard__identity-label">
                            Your handle:
                        </label>
                        <input
                            id="snake-handle"
                            type="text"
                            className="leaderboard__identity-input"
                            value={handleInput}
                            onChange={(e) => setHandleInput(e.target.value)}
                            placeholder="alice"
                            maxLength={32}
                        />
                        <button type="submit" className="leaderboard__identity-save">
                            Save
                        </button>
                        {identityError && (
                            <span
                                className="leaderboard__identity-error"
                                role="alert"
                            >
                                {identityError}
                            </span>
                        )}
                    </form>
                )}
            </div>

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
