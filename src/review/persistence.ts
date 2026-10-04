export type SnapshotPersist<T> = (
  snapshot: T,
) => Promise<unknown>

export type SnapshotClone<T> = (value: T) => T

export function createSerializedSnapshotWriter<T>(
  persist: SnapshotPersist<T>,
  cloneSnapshot: SnapshotClone<T> = (value) =>
    structuredClone(value) as T,
) {
  let queue: Promise<unknown> = Promise.resolve()

  return {
    enqueue(value: T): Promise<unknown> {
      const snapshot = cloneSnapshot(value)
      queue = queue
        .catch(() => undefined)
        .then(() => persist(snapshot))
      return queue
    },

    flush(): Promise<unknown> {
      return queue
    },
  }
}
