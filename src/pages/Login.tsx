import { useState, type FormEvent } from 'react';
import { store } from '../data';

export function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      setMsg(await store.signIn(email.trim().toLowerCase()));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="panel login" onSubmit={go}>
        <h1>Build Tracker</h1>
        <label className="field">
          Email
          <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="help">We'll email you a sign-in link. You need an invite from the owner first.</span>
        </label>
        <button className="btn primary" disabled={busy}>Email me a link</button>
        {msg && <div className="alert calm" role="status">{msg}</div>}
        {err && <div className="alert" role="alert">{err}</div>}
      </form>
    </div>
  );
}
