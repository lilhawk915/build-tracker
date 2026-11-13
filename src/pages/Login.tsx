import { useState, type FormEvent } from 'react';
import { store } from '../data';

export function Login() {
  const [byEmail, setByEmail] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = () => email.trim().toLowerCase();

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await store.signInPassword(username, password);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

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

  const swap = () => { setByEmail(!byEmail); setErr(''); setMsg(''); };

  return (
    <div className="center">
      <div className="panel login">
        <h1>Build Tracker</h1>
        {!byEmail ? (
          <form className="stack" onSubmit={signIn}>
            <label className="field">
              Username
              <input required autoFocus autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="field">
              Password
              <span className="row nowrap">
                <input type={show ? 'text' : 'password'} required autoComplete="current-password" style={{ flex: 1 }} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="btn tiny" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            <button className="btn primary big" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <p className="muted small">Don't have a username or forgot your password? Ask Ryan. He can set it on the Team page.</p>
          </form>
        ) : (
          <>
            <form className="stack" onSubmit={send}>
              <label className="field">
                Email
                <input type="email" required autoFocus={!sent} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <span className="help">We'll email you a sign-in code and link.</span>
              </label>
              <button className={`btn${sent ? '' : ' primary'}`} disabled={busy}>{sent ? 'Send a new code' : 'Email me a code'}</button>
            </form>
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
          </>
        )}
        {msg && <div className="alert calm" role="status">{msg}</div>}
        {err && <div className="alert" role="alert">{err}</div>}
        <button type="button" className="linkish small muted" onClick={swap}>{byEmail ? 'Use my username and password' : 'Sign in with an emailed code instead'}</button>
      </div>
    </div>
  );
}
