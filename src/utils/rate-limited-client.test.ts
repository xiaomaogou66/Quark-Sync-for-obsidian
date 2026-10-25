import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
	if (typeof globalThis.window === 'undefined') {
		vi.stubGlobal('window', globalThis)
	}
})

import {
	createRateLimitedWebDAVClient,
	isRemoteRequestTimeoutError,
} from './rate-limited-client'

const client = (impl: Record<string, unknown>) => impl as never

describe('createRateLimitedWebDAVClient', () => {
	it('passes results through', async () => {
		const wrapped = createRateLimitedWebDAVClient(
			client({ getDirectoryContents: async () => ['a'] }),
		)
		await expect(wrapped.getDirectoryContents('/x')).resolves.toEqual(['a'])
	})

	it('rejects a call that never settles', async () => {
		const wrapped = createRateLimitedWebDAVClient(
			client({ getDirectoryContents: () => new Promise(() => {}) }),
			{ timeoutMs: 30 },
		)
		const error = await wrapped.getDirectoryContents('/x').catch((e) => e)
		expect(isRemoteRequestTimeoutError(error)).toBe(true)
		expect((error as Error).message).toContain('getDirectoryContents')
	})

	it('does not leak the timer on success', async () => {
		const wrapped = createRateLimitedWebDAVClient(
			client({ exists: async () => true }),
			{ timeoutMs: 30 },
		)
		await expect(wrapped.exists('/x')).resolves.toBe(true)
		// If the timer leaked, the process would still be pending; a second call
		// must still work.
		await expect(wrapped.exists('/x')).resolves.toBe(true)
	})

	it('propagates the original rejection', async () => {
		const wrapped = createRateLimitedWebDAVClient(
			client({
				exists: async () => {
					throw new Error('Invalid response: 404 Not Found')
				},
			}),
			{ timeoutMs: 1000 },
		)
		await expect(wrapped.exists('/x')).rejects.toThrow('404')
	})

	it('exposes non-function properties untouched', () => {
		const raw = client({ someProp: { a: 1 } })
		const wrapped = createRateLimitedWebDAVClient(raw)
		expect((wrapped as unknown as Record<string, unknown>).someProp).toEqual({
			a: 1,
		})
	})
})
