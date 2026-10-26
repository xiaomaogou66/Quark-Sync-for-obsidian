import { describe, expect, it, vi } from 'vitest'
import type { WebDAVClient } from 'webdav'
import { WebDAVRemoteFs } from './webdav-remote-fs'

const fs = (client: Record<string, unknown>) =>
	new WebDAVRemoteFs(client as unknown as WebDAVClient)

const payload = new ArrayBuffer(12)

describe('WebDAVRemoteFs.writeFile', () => {
	it('succeeds without a verification stat when the upload worked', async () => {
		const stat = vi.fn()
		await expect(
			fs({ putFileContents: async () => true, stat }).writeFile(
				'/a.jpg',
				payload,
			),
		).resolves.toBeUndefined()
		expect(stat).not.toHaveBeenCalled()
	})

	it('treats a failed upload as done when the remote already holds the bytes', async () => {
		// OpenList answers 405 when its rename hits Quark's "存在同名文件" conflict,
		// even though the target file is already complete.
		const fsUnderTest = fs({
			putFileContents: async () => {
				throw new Error('Method Not Allowed')
			},
			stat: async () => ({ size: 12 }),
		})
		await expect(
			fsUnderTest.writeFile('/a.jpg', payload),
		).resolves.toBeUndefined()
	})

	it('still fails when the remote copy has the wrong size', async () => {
		const fsUnderTest = fs({
			putFileContents: async () => {
				throw new Error('Method Not Allowed')
			},
			stat: async () => ({ size: 0 }),
		})
		await expect(fsUnderTest.writeFile('/a.jpg', payload)).rejects.toThrow(
			'Method Not Allowed',
		)
	})

	it('still fails when the verification stat fails too', async () => {
		const fsUnderTest = fs({
			// resolves false: the client says 'not stored' without throwing
			putFileContents: async () => false,
			stat: async () => {
				throw new Error('boom')
			},
		})
		await expect(fsUnderTest.writeFile('/a.jpg', payload)).rejects.toThrow(
			'Upload failed',
		)
	})

	it('compares string payloads by encoded byte length (UTF-8)', async () => {
		const fsUnderTest = fs({
			putFileContents: async () => {
				throw new Error('Method Not Allowed')
			},
			stat: async () => ({ size: 6 }),
		})
		await expect(
			fsUnderTest.writeFile('/a.md', '你好'),
		).resolves.toBeUndefined()
	})
})
