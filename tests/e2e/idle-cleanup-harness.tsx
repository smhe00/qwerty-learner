import { triggerIdleMaintenance } from '../../src/sync/api'
import AdministratorPanel from '../../src/sync/AdministratorPanel'
import { startIdleMaintenance } from '../../src/sync/idle-maintenance-trigger'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

const token = new URLSearchParams(location.search).get('token') || 'normal'
function Harness() {
  const [count, setCount] = useState(0)
  return <main>
    <h1>登录已完成</h1>
    <button onClick={() => setCount(count + 1)}>继续学习 {count}</button>
    <AdministratorPanel token={token} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
startIdleMaintenance(triggerIdleMaintenance, token)
