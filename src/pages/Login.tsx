import { useState, type FormEvent } from 'react';
import { store } from '../data';

export function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = () => email.trim().toLowerCase();

  async function send(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      setMsg(await store.signIn(clean()));
      setSent(true);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A phone home-screen app can't receive the emailed link, so the code signs in right here.
  async function check(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await store.verifyCode(clean(), code);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="panel login">
        <h1>Build Tracker</h1>
        <form className="stack" onSubmit={send}>
          <label className="field">
            Email
            <input type="email" required autoFocus={!sent} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <span className="help">We'll email you a sign-in code and link. You need an invite from the owner first.</span>
          </label>
          <button className={`btn${sent ? '' : ' primary'}`} disabled={busy}>{sent ? 'Send a new code' : 'Email me a code'}</button>
        </form>
        {msg && <div className="alert calm" role="status">{msg}</div>}
        {sent && (
          <form className="stack" onSubmit={check}>
            <label className="field">
              Code or link from the email
              <input autoComplete="one-time-code" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
              <span className="help">On a computer, just click the link in the email. On a phone app, press and hold the link in the email, choose Copy, and paste it here.</span>
            </label>
            <button className="btn primary" disabled={busy}>Sign in</button>
          </form>
        )}
        {err && <div className="alert" role="alert">{err}</div>}
      </div>
    </div>
  );
}
