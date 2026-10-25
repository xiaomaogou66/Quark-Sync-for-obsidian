import requestUrl from '~/utils/request-url'
import type { QuarkHttpFn } from './http'

/**
 * Obsidian `requestUrl` backed transport.
 *
 * `requestUrl` bypasses CORS and works on mobile, which is why the rest of the
 * plugin uses it instead of `fetch`.
 */
export const obsidianQuarkHttp: QuarkHttpFn = async (request) => {
	const response = await requestUrl({
		url: request.url,
		method: request.method ?? 'GET',
		headers: {
			Accept: 'application/json, text/plain, */*',
			...request.headers,
		},
		body: request.body,
		throw: false,
	})

	const headers: Record<string, string> = {}
	for (const [key, value] of Object.entries(response.headers ?? {})) {
		headers[key.toLowerCase()] = value
	}

	return {
		status: response.status,
		headers,
		arrayBuffer: response.arrayBuffer,
		text: response.text,
	}
}
