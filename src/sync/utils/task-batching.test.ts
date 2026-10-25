import { describe, expect, it } from 'vitest'
import { buildExecutionBatches, pathsOverlap } from './task-batching'

const task = (localPath: string, remotePath = localPath, safe = true) => ({
	localPath,
	remotePath,
	safe,
})

const safe = (t: { safe: boolean }) => t.safe
const indices = (batches: { index: number }[][]) =>
	batches.map((batch) => batch.map((item) => item.index))

describe('buildExecutionBatches', () => {
	it('keeps everything serial at concurrency 1', () => {
		const tasks = [task('a.md'), task('b.md'), task('c.md')]
		const batches = buildExecutionBatches(tasks, 1, safe)
		expect(indices(batches)).toEqual([[0], [1], [2]])
	})

	it('groups adjacent parallel-safe tasks up to the limit', () => {
		const tasks = [task('a.md'), task('b.md'), task('c.md'), task('d.md')]
		expect(indices(buildExecutionBatches(tasks, 3, safe))).toEqual([
			[0, 1, 2],
			[3],
		])
	})

	it('splits on a task that must stay ordered', () => {
		const tasks = [
			task('a.md'),
			task('b.md'),
			task('dir', 'dir', false),
			task('c.md'),
		]
		expect(indices(buildExecutionBatches(tasks, 4, safe))).toEqual([
			[0, 1],
			[2],
			[3],
		])
	})

	it('never batches colliding paths together', () => {
		const tasks = [task('a.md'), task('a.md'), task('b.md')]
		expect(indices(buildExecutionBatches(tasks, 4, safe))).toEqual([
			[0],
			[1, 2],
		])
	})

	it('detects file/folder overlap', () => {
		const tasks = [task('dir/note.md'), task('dir')]
		expect(indices(buildExecutionBatches(tasks, 4, safe))).toEqual([[0], [1]])
	})

	it('flushes the tail batch', () => {
		const tasks = [task('a.md'), task('b.md')]
		expect(indices(buildExecutionBatches(tasks, 5, safe))).toEqual([[0, 1]])
	})

	it('handles an empty task list', () => {
		expect(buildExecutionBatches([], 3, safe)).toEqual([])
	})

	it('compares remote paths too', () => {
		const tasks = [task('a.md', '/Vault/x.md'), task('b.md', '/Vault/x.md')]
		expect(indices(buildExecutionBatches(tasks, 4, safe))).toEqual([[0], [1]])
	})
})

describe('pathsOverlap', () => {
	it('treats a path as overlapping its descendants only', () => {
		expect(pathsOverlap('dir/a.md', 'dir')).toBe(true)
		expect(pathsOverlap('dir/a.md', 'dir2')).toBe(false)
		expect(pathsOverlap('dir/a.md', 'dir/a.md')).toBe(true)
		expect(pathsOverlap('dir/', 'dir')).toBe(true)
	})
})
