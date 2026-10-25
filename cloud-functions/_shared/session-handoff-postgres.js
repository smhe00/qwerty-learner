/* eslint-env node */
/**
 * Reference durable adapter. The pool uses the node-postgres connect/query/
 * release contract. No database is provisioned and no gateway uses this module
 * by default. Apply the paired SQL file to an isolated qualification database.
 *
 * Only the short state transition holds a DB transaction. Blob work runs AFTER
 * COMMIT, protected by the durable active marker, NOT by a connection lock.
 * Losing the connection cannot expire that marker and admit a second writer.
 */
export function createPostgresHandoffStore(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('PostgreSQL pool required')
  return Object.freeze({
    async transact(key, update) {
      if (typeof key !== 'string' || key.length > 160 || typeof update !== 'function') {
        throw new Error('Invalid handoff transaction')
      }
      const client = await pool.connect()
      let discard = false
      try {
        await client.query('BEGIN')
        // Do not accept a session configured for asynchronous commit.
        await client.query('SET LOCAL synchronous_commit = on')
        await client.query(`INSERT INTO qwerty_handoff.account_barriers(account_key)
          VALUES ($1) ON CONFLICT (account_key) DO NOTHING`, [key])
        const read = await client.query(`SELECT state FROM qwerty_handoff.account_barriers
          WHERE account_key = $1 FOR UPDATE`, [key])
        if (read.rows.length !== 1) throw new Error('Missing handoff state')
        const changed = update(read.rows[0].state)
        if (!changed || typeof changed.then === 'function' ||
            !Object.hasOwn(changed, 'state') || !Object.hasOwn(changed, 'result')) {
          throw new Error('Handoff transition must be synchronous')
        }
        await client.query(`UPDATE qwerty_handoff.account_barriers
          SET state = $2::jsonb, updated_at = clock_timestamp()
          WHERE account_key = $1`, [key, JSON.stringify(changed.state)])
        await client.query('COMMIT')
        return changed.result
      } catch (error) {
        // COMMIT may already be durable. Never rerun the transition or report
        // rollback as proof that a possibly granted operation does not exist.
        discard = true
        try { await client.query('ROLLBACK') } catch { /* preserve the original ambiguity */ }
        throw error
      } finally {
        client.release(discard)
      }
    },
  })
}
