import { WebDAVClient } from 'webdav'
import { apiLimiter } from './api-limiter'

/**
 * Serialises every client call through the shared limiter so a WebDAV gateway
 * (Alist/OpenList) is not hammered during traversal.
 */
export function createRateLimitedWebDAVClient(
	client: WebDAVClient,
): WebDAVClient {
	return new Proxy(client, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver) as unknown
			if (typeof value === 'function') {
				const callable = value as (...args: unknown[]) => unknown
				return (...args: unknown[]) => {
					return apiLimiter.schedule(() =>
						Promise.resolve(callable.apply(target, args)),
					)
				}
			}
			return value
		},
	})
}
