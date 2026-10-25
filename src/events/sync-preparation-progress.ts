import { Subject } from 'rxjs'
import type { RemoteTraversalProgress } from '~/utils/traverse-remote'

export type SyncPreparationPhase =
	| 'checkingRemote'
	| 'loadingState'
	| 'traversingRemote'
	| 'analyzing'
	| 'savingCache'

export interface SyncPreparationProgress {
	phase: SyncPreparationPhase
	traversal?: RemoteTraversalProgress
}

const syncPreparationProgress = new Subject<SyncPreparationProgress>()

export const onSyncPreparationProgress = () =>
	syncPreparationProgress.asObservable()

export const emitSyncPreparationProgress = (
	progress: SyncPreparationProgress,
) => syncPreparationProgress.next(progress)
