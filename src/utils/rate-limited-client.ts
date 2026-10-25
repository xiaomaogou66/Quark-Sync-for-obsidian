import { WebDAVClient } from 'webdav'
import i18n from '~/i18n'
import { apiLimiter } from './api-limiter'

/**
 * How long a single gateway request may take before the sync gives up on it.
 *
 * Neither `webdav` nor its fetch layer expose a timeout, so a gateway that
 * forwards to a flaky upstream (Quark behind OpenList, for instance) can leave
 * a request pending for minutes. The UI then sits on "checking remote
 * directory" with no progress and no error, which looks exactly like a hang.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000

export class RemoteRequestTimeoutError extends Error {
	constructor(
		readonly operation: string,
		readonly timeoutMs: number,
	) {
		super(
			i18n.t('sync.error.requestTimeout', {
				operation,
				seconds: Math.round(timeoutMs / 1000),
			}),
		)
		this.name = 'RemoteRequestTimeoutError'
	}
}

export function isRemoteRequestTimeoutError(
	error: unknown,
): error is RemoteRequestTimeoutError {
	return error instanceof RemoteRequestTimeoutError
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return promise
	}
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			reject(new RemoteRequestTimeoutError(operation, timeoutMs))
		}, timeoutMs)
		promise.then(
			(value) => {
				window.clearTimeout(timer)
				resolve(value)
			},
			(error: unknown) => {
				window.clearTimeout(timer)
				reject(error instanceof Error ? error : new Error(String(error)))
			},
		)
	})
}

/**
 * Serialises every client call through the shared limiter so a WebDAV gateway
 * (Alist/OpenList) is not hammered during traversal, and bounds how long any
 * single call may block the sync.
 *
 * The timeout only stops this caller from waiting: the aborted request may
 * still finish on the gateway side, which is harmless because every operation
 * here is idempotent (stat/list/put/delete of a known path).
 */
export function createRateLimitedWebDAVClient(
	client: WebDAVClient,
	options?: { timeoutMs?: number },
): WebDAVClient {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
	return new Proxy(client, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver) as unknown
			if (typeof value === 'function') {
				const callable = value as (...args: unknown[]) => unknown
				return (...args: unknown[]) => {
					return apiLimiter.schedule(() =>
						withTimeout(
							Promise.resolve(callable.apply(target, args)),
							timeoutMs,
							String(prop),
						),
					)
				}
			}
			return value
		},
	})
}
