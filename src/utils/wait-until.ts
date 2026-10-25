import sleep from './sleep'

/**
 * Polls `condition` until it returns a truthy value.
 *
 * `timeoutMs` bounds the wait: without it a leaked state flag (a sync that
 * never cleared `isSyncing`, a GC that never released its lock) turns every
 * later caller into a permanently pending promise, which shows up in the UI as
 * "sync is already running" with no way to recover short of reloading Obsidian.
 * On timeout the last condition value is returned as-is so callers can decide
 * how to recover.
 */
export default async function waitUntil<T>(
	condition: () => T,
	duration = 100,
	timeoutMs?: number,
): Promise<T> {
	const deadline =
		typeof timeoutMs === 'number' ? Date.now() + timeoutMs : undefined
	while (true) {
		const result = await Promise.resolve(condition())
		if (result) {
			return result
		}
		if (deadline !== undefined && Date.now() >= deadline) {
			return result
		}
		await sleep(duration)
	}
}
