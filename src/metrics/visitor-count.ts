let scheduled = false

/** Best-effort after-load analytics. No learning storage, auth token or dependency,
 * response parsing, retry, console output or user-facing failure state. */
export function scheduleVisitorCount() {
  try {
    if (scheduled || REACT_APP_DEPLOY_ENV === 'pages' || import.meta.env.VITE_QWERTY_SYNC_DISABLED === 'true' || navigator.webdriver) return
    scheduled = true
    const send = () => {
      try {
        // Persist synchronously BEFORE the request, so a first-visit workspace
        // initialization/reload cannot race two server-issued identities.
        const prior = document.cookie.match(/(?:^|;\s*)qp_uv=([a-f0-9]{32})(?=;|$)/)?.[1]
        const id = prior || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
        document.cookie = `qp_uv=${id}; Path=/; Max-Age=86400; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`
        // Blocked cookies mean analytics is omitted, not a new ID per request.
        if (!document.cookie.split(';').some(value => value.trim() === 'qp_uv=' + id)) return
        void fetch('/api/visits', {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        }).catch(() => undefined)
      } catch { /* Statistics must never affect page entry. */ }
    }
    const idle = () => {
      if (window.requestIdleCallback) window.requestIdleCallback(send, { timeout: 2000 })
      else window.setTimeout(send, 1000)
    }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
  } catch { /* Unsupported/blocked analytics is simply omitted. */ }
}
