/**
 * Transport abstraction for the Quark client.
 *
 * The concrete implementation lives in `http-obsidian.ts` (Obsidian
 * `requestUrl`); keeping the type here lets the client be unit tested without
 * pulling in the Obsidian runtime.
 */

export interface QuarkHttpRequest {
	url: string
	method?: string
	headers?: Record<string, string>
	body?: ArrayBuffer | string
}

export interface QuarkHttpResponse {
	status: number
	/** Lower-cased header names. */
	headers: Record<string, string>
	arrayBuffer: ArrayBuffer
	text: string
}

export type QuarkHttpFn = (
	request: QuarkHttpRequest,
) => Promise<QuarkHttpResponse>
