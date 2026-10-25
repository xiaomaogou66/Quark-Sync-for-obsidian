/** Minimal shape the batching logic needs from a task. */
export interface BatchableTask {
	localPath: string
	remotePath: string
}

export interface BatchItem<T> {
	index: number
	task: T
}

export function pathsOverlap(a: string, b: string): boolean {
	const left = a.replace(/\/+$/, '')
	const right = b.replace(/\/+$/, '')
	return (
		left === right ||
		left.startsWith(`${right}/`) ||
		right.startsWith(`${left}/`)
	)
}

/**
 * Splits tasks into batches that may run concurrently.
 *
 * A batch is a maximal run of *adjacent* parallel-safe tasks whose paths do not
 * collide (no identical path and no file/folder overlap), capped at
 * `concurrency`. Anything else becomes its own single-task batch, so the
 * ordering guarantees between dependent operations — a mkdir before the upload
 * that needs it, a delete after the read that feeds it — are exactly the ones
 * the original serial loop provided.
 *
 * Adjacency matters: a serial task in the middle of two runs splits them, which
 * keeps "everything before X happened before X" true.
 */
export function buildExecutionBatches<T extends BatchableTask>(
	tasks: T[],
	concurrency: number,
	isParallelSafe: (task: T) => boolean,
): BatchItem<T>[][] {
	const limit = Math.max(1, Math.floor(concurrency))
	const batches: BatchItem<T>[][] = []
	let current: BatchItem<T>[] = []

	const flush = () => {
		if (current.length > 0) {
			batches.push(current)
			current = []
		}
	}

	tasks.forEach((task, index) => {
		const item = { index, task }
		if (limit <= 1 || !isParallelSafe(task)) {
			flush()
			batches.push([item])
			return
		}

		const conflicts = current.some(
			(other) =>
				other.task.localPath === task.localPath ||
				other.task.remotePath === task.remotePath ||
				pathsOverlap(other.task.localPath, task.localPath) ||
				pathsOverlap(other.task.remotePath, task.remotePath),
		)
		if (conflicts) {
			flush()
		}
		current.push(item)
		if (current.length >= limit) {
			flush()
		}
	})
	flush()

	return batches
}
