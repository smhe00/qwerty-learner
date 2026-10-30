import type { Page } from '@playwright/test'
import { buildSync } from 'esbuild'
import { resolve } from 'node:path'

const seal = buildSync({
  stdin: {
    contents: `export { refreshWorkspaceMigrationWitness, assertWorkspaceMigrationWitness } from ${JSON.stringify(
      resolve('src/sync/workspace-storage-witness.ts'),
    )}`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  globalName: 'adminWitnessFixture',
}).outputFiles[0].text
export async function seedSealedLegacyAdministrator(page: Page, auth: unknown, sourceOwner?: string) {
  await page.addScriptTag({ content: seal })
  return page.evaluate(
    async ({ auth, sourceOwner }) => {
      const a = auth as any
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const r = indexedDB.open('RecordDB')
        r.onsuccess = () => ok(r.result)
        r.onerror = () => fail(r.error)
      })
      await new Promise<void>((ok, fail) => {
        const tx = db.transaction('wordRecords', 'readwrite')
        tx.objectStore('wordRecords').put({
          id: 999,
          word: 'preserved-admin-word',
          dict: 'cet4',
          chapter: 0,
          timeStamp: 1800000000,
          timing: [100],
          wrongCount: 0,
          mistakes: {},
          sourceMode: 'learn',
        })
        tx.oncomplete = () => ok()
        tx.onerror = () => fail(tx.error)
      })
      db.close()
      const vault = await new Promise<IDBDatabase>((ok, fail) => {
        const r = indexedDB.open('QwertyPlusWorkspaceVaultV1')
        r.onsuccess = () => ok(r.result)
        r.onerror = () => fail(r.error)
      })
      let anonymousFingerprint = ''
      await new Promise<void>((ok, fail) => {
        const tx = vault.transaction(['registry', 'snapshots'], 'readwrite')
        const head = tx.objectStore('registry').get('head')
        head.onsuccess = () =>
          tx
            .objectStore('registry')
            .put(
              {
                ...head.result,
                generation: head.result.generation + 1,
                active: { kind: 'account', accountId: sourceOwner || a.user.userId },
              },
              'head',
            )
        const anon = tx.objectStore('snapshots').get('anonymous')
        anon.onsuccess = () => {
          anonymousFingerprint = anon.result.fingerprint
        }
        tx.oncomplete = () => ok()
        tx.onerror = () => fail(tx.error)
      })
      vault.close()
      localStorage.setItem(
        'qwerty.cloudAuth.v1',
        JSON.stringify(sourceOwner ? { ...a, user: { ...a.user, userId: sourceOwner, username: 'ordinary-user', role: undefined } } : a),
      )
      ;(window as any).adminWitnessFixture.refreshWorkspaceMigrationWitness()
      return { anonymousFingerprint, witness: localStorage.getItem('qwerty.s1.workspace-migrated.v1') }
    },
    { auth, sourceOwner },
  )
}
export async function inspectReturnedWorkspace(page: Page, adminId: string) {
  await page.addScriptTag({ content: seal })
  return page.evaluate(async (adminId) => {
    ;(window as any).adminWitnessFixture.assertWorkspaceMigrationWitness()
    const open = (name: string) =>
      new Promise<IDBDatabase>((ok, fail) => {
        const r = indexedDB.open(name)
        r.onsuccess = () => ok(r.result)
        r.onerror = () => fail(r.error)
      })
    const db = await open('RecordDB')
    const rows = await new Promise<unknown[]>((ok, fail) => {
      const r = db.transaction('wordRecords').objectStore('wordRecords').getAll()
      r.onsuccess = () => ok(r.result)
      r.onerror = () => fail(r.error)
    })
    db.close()
    const vault = await open('QwertyPlusWorkspaceVaultV1')
    const data = await new Promise<any>((ok, fail) => {
      const tx = vault.transaction(['registry', 'snapshots'])
      let registry: any, anon: any, account: any, keys: any
      const r = tx.objectStore('registry').get('head')
      r.onsuccess = () => {
        registry = r.result
      }
      const a = tx.objectStore('snapshots').get('anonymous')
      a.onsuccess = () => {
        anon = a.result
      }
      const b = tx.objectStore('snapshots').get('account:' + adminId)
      b.onsuccess = () => {
        account = b.result
      }
      const k = tx.objectStore('snapshots').getAllKeys()
      k.onsuccess = () => {
        keys = k.result
      }
      tx.oncomplete = () =>
        ok({
          active: registry.active,
          anonymousFingerprint: anon.fingerprint,
          adminSnapshot: account?.json,
          rollbackCount: keys.filter((key: string) => key.startsWith('manual-import-rollback:')).length,
        })
      tx.onerror = () => fail(tx.error)
    })
    vault.close()
    return {
      ...data,
      rows,
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      management: sessionStorage.getItem('qwerty.administrator.session.v1'),
      returnTicket: sessionStorage.getItem('qwerty.administrator.return.v1'),
    }
  }, adminId)
}
