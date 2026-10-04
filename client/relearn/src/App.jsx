import { useEffect, useRef, useState } from 'react'
import { IMG } from './assets.js'
import LivePage from './LivePage.jsx'
import Login from './Login.jsx'
import Signup from './Signup.jsx'
import McqPage from './McqPage.jsx'
import ProfilePage from './ProfilePage.jsx'
import AdminPage from './AdminPage.jsx'

/* ---------- content ---------- */
const NAV = [['Home', '#top'], ['How it works', '#how'], ['Preview', '#demo'], ['FAQ', '#faq']]
const TICKER = 'Misconception diagnosis  ✦  Targeted intervention  ✦  Verified resolution  ✦  Learner model  ✦  Fresh reassessment  ✦  '
const STEPS = [
  ['01', 'Diagnose', '— the model', 'Reads the learner’s answer, working or code and infers the misconception behind it.', 'var(--sky)', 'var(--brand)'],
  ['02', 'Intervene', '— targeted', 'Generates a fix aimed at that exact misconception, not a generic re-explanation.', 'var(--mint)', 'var(--mint-d)'],
  ['03', 'Reassess', '— verify', 'Checks with a differently-shaped question whether the misconception is really gone.', 'var(--pink)', 'var(--accent)'],
]
const BENEFITS = [
  ['Misconception dataset', 'Correct, incorrect and the reason behind each.'],
  ['Differentiation', 'Tells apart causes that give the same wrong output.'],
  ['Learner model', 'Tracks recurring misconceptions across attempts.'],
  ['Honest evaluation', 'Accuracy, including on misconceptions unseen in training.'],
]
const STATS = [['3', 'Misconceptions diagnosed in the demo'], ['2', 'Learners’ reasons behind the same wrong answer'], ['1', 'Fresh reassessment after every fix']]
const FAQ = [
  ['What is the difference between a wrong output and a misconception?', 'A wrong output is just the result. A misconception is the belief about how code works that produced it. Re:Learn infers that belief so the fix targets the cause.'],
  ['What does it cover?', 'This build focuses on introductory programming: variables, assignment, loops and conditionals.'],
  ['How do you know a misconception is resolved?', 'A correct follow-up is not treated as proof. The learner gets a differently-shaped question that the same misconception would still get wrong.'],
  ['What is the learner model?', 'A running record of the misconceptions a learner repeats and the understanding they have demonstrated across attempts.'],
  ['How is the diagnosis model evaluated?', 'On diagnosis accuracy, and on responses or misconceptions that were not part of training.'],
]

/* demo: intro programming. Two different beliefs can produce the same wrong output (3). */
const M = {
  assign: { name: 'Thinks = accumulates, like +=', fix: 'Each pass overwrites the variable with the current value. Only += adds to it.' },
  range: { name: 'Thinks range(n) counts 1 to n', fix: 'range(3) starts at 0 and stops before 3, so i is 0, 1, 2.' },
  once: { name: 'Thinks the loop body runs once', fix: 'The body runs once for every value range(3) produces, three times here.' },
}
const CODE = [
  ['total = 0', 'for i in range(3):', '    total = i', 'print(total)'],
  ['count = 0', 'for n in range(4):', '    count = n', 'print(count)'],
]
const OPTS = [
  [['2', null], ['3', 'ambig'], ['0', 'once']],
  [['3', null], ['6', 'assign'], ['4', 'range']],
]
const WHY = [['The value keeps adding up: 0 + 1 + 2', 'assign'], ['i goes 1, 2, 3, so the last value is 3', 'range']]

/* ---------- components ---------- */
const Btn = ({ href = '#', variant = '', children, ...p }) => <a href={href} className={`btn ${variant}`} {...p}>{children}</a>

function Reveal({ as: T = 'div', d = 0, className = '', style, children }) {
  const ref = useRef(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }, { threshold: 0.15 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])
  return <T ref={ref} className={`reveal ${on ? 'in' : ''} ${className}`} style={{ ...style, '--d': `${d}s` }}>{children}</T>
}

function CountUp({ to }) {
  const ref = useRef(null)
  const [v, setV] = useState(0)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const tick = (t) => { const p = Math.min((t - t0) / 1200, 1); setV(Math.round(to * (1 - (1 - p) ** 3))); if (p < 1) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [to])
  return <span ref={ref}>{v}</span>
}

const Title = ({ words, hl, tag: T = 'h2' }) => (
  <T className="title">
    {words.map((w) => <span key={w}>{w}</span>)}
    <span className="hl">{hl}<img className="d1" src={IMG.spark} alt="" /><img className="d2" src={IMG.underline} alt="" /></span>
  </T>
)

function Accordion({ q, a, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className={`acc ${open ? 'open' : ''}`}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>{q}<span className="pm">{open ? '–' : '+'}</span></button>
      <div className="body"><div><p>{a}</p></div></div>
    </div>
  )
}

const Code = ({ lines, hot, title = 'loop.py' }) => (
  <div className="code">
    <div className="bar"><i /><i /><i /><span style={{ marginLeft: 8 }}>{title}</span></div>
    <pre>{lines.map((l, i) => <span key={i} className={`ln ${i === hot ? 'hot' : ''}`}>{l}</span>)}</pre>
  </div>
)

function Nav() {
  const [open, setOpen] = useState(false)
  return (
    <nav className="nav"><div className="container row">
      <a href="#top" className="logo">Re<b>:</b>Learn</a>
      <div className={`links ${open ? 'open' : ''}`}>
        {NAV.map(([l, h]) => <a key={l} href={h} className="text-md" onClick={() => setOpen(false)}>{l}</a>)}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Btn variant="sm white" href="#/login">Live demo</Btn>
      </div>
      <button className="menu-btn" aria-label="Menu" onClick={() => setOpen(!open)}>{open ? '✕' : '☰'}</button>
    </div></nav>
  )
}

/* diagnose → (ask for working if ambiguous) → intervene → reassess */
function Demo() {
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState('answer') // answer | why | intervene | result
  const [history, setHistory] = useState([])
  const [m, setM] = useState(null)
  const [ans, setAns] = useState('')

  const diagnose = (text, key) => { setHistory((h) => [...h, { text, m: key }]); setM(key) }
  const pick = ([text, key]) => {
    setAns(text)
    if (key === 'ambig') return setPhase('why')
    diagnose(text, key)
    setPhase(key && round === 0 ? 'intervene' : 'result')
  }
  const why = (key) => { diagnose(ans, key); setPhase('intervene') }
  const reset = () => { setRound(0); setPhase('answer'); setHistory([]); setM(null) }
  const last = history[history.length - 1]
  const resolved = phase === 'result' && last && last.m === null
  const step = phase === 'intervene' ? 1 : phase === 'result' ? 2 : round === 0 ? 0 : 1

  return (
    <section id="demo" className="section demo"><div className="container">
      <div className="center"><span className="pretitle">Interactive preview</span><div style={{ height: 14 }} />
        <Title words={['See a']} hl="diagnosis" /></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <div className="prog">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
          {phase === 'answer' && <>
            <Code lines={CODE[round]} />
            <h5 style={{ margin: '18px 0 0' }}>What does this print?</h5>
            {OPTS[round].map((o) => <button key={o[0]} className="opt" onClick={() => pick(o)}>{o[0]}</button>)}
          </>}
          {phase === 'why' && <>
            <span className="tag">Ambiguous answer: {ans}</span>
            <h5>Several beliefs give {ans}. How did you work it out?</h5>
            {WHY.map(([t, k]) => <button key={k} className="opt" style={{ fontFamily: 'var(--font-body)' }} onClick={() => why(k)}>{t}</button>)}
          </>}
          {phase === 'intervene' && <>
            <span className="tag bad">Diagnosed</span>
            <h5>{M_(m)}</h5>
            <p style={{ margin: '10px 0' }}>{M[m].fix}</p>
            <table className="trace"><thead><tr><th>pass</th><th>i</th><th>total after</th></tr></thead>
              <tbody>{[0, 1, 2].map((i) => <tr key={i}><td>{i + 1}</td><td>{i}</td><td>{i}</td></tr>)}</tbody></table>
            <button className="btn primary" onClick={() => { setRound(1); setPhase('answer'); setM(null) }}>Reassess me</button>
          </>}
          {phase === 'result' && <>
            <span className={`tag ${resolved ? 'ok' : 'bad'}`}>{resolved ? 'Resolved' : 'Still active'}</span>
            <h5 style={{ margin: '8px 0 12px' }}>{resolved ? (round === 0 ? 'Correct first time.' : 'Confirmed on a fresh question.') : `Still showing: ${M[last.m].name}`}</h5>
            <p>{resolved ? 'The learner model records the misconception as resolved.' : 'It reappeared after the fix, so it stays open and a different intervention is queued.'}</p>
            <div style={{ height: 20 }} /><button className="btn" onClick={reset}>Try again</button>
          </>}
        </div>
        <div className="panel">
          <h5>Learner model</h5><p style={{ margin: '8px 0 20px' }}>Attempts and the misconception behind each.</p>
          {history.length === 0 && <p className="text-italic">Answer a question to start.</p>}
          {history.map((h, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <span className={`tag ${h.m ? 'bad' : 'ok'}`}>prints {h.text}</span>
              <span>{h.m ? M[h.m].name : 'No misconception'}</span>
            </div>
          ))}
        </div>
      </div>
    </div></section>
  )
}
const M_ = (k) => M[k].name

/* ---------- page ---------- */
function Landing() {
  return (
    <div id="top">
      <Nav />
      <header className="hero">
        <div className="container hero-grid">
          <div>
            <span className="pretitle">Introductory programming</span>
            <Title tag="h1" words={['Fix', 'the', 'misunderstanding,', 'not', 'just', 'the']} hl="output" />
            <p className="lead">Re:Learn finds the belief behind a learner’s wrong answer, teaches against it, then checks it is truly gone.</p>
            <div className="btns">
              <Btn variant="white" href="#/login">Live demo</Btn>
              <Btn variant="white" href="#how">How it works</Btn>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <Code lines={CODE[0]} hot={2} />
            <div className="ftag">Diagnosed: = overwrites, it doesn’t add</div>
          </div>
        </div>
        <div className="ticker" aria-hidden="true"><div className="track">{[0, 1].map((k) => <span key={k}>{TICKER}</span>)}</div></div>
      </header>

      <section className="section"><div className="container center">
        <h3 style={{ maxWidth: 760 }}>A wrong output points to a specific misunderstanding. Showing the right code rarely fixes it.</h3>
        <div className="grid g2 split" style={{ width: '100%' }}>
          <Reveal className="stats">
            {STATS.map(([n, t]) => <div className="stat" key={t}><span className="h-lg"><CountUp to={Number(n)} /></span><span>{t}</span></div>)}
          </Reveal>
          <Reveal d={0.15} className="photo-tilt"><img src={IMG.counter} alt="" /></Reveal>
        </div>
      </div></section>

      <section id="how" className="section" style={{ paddingTop: 0 }}><div className="container">
        <div className="grid g2" style={{ gap: 80, alignItems: 'center' }}>
          <div><Title words={['How', 'it']} hl="works" />
            <p>Three steps, from the first answer to proof that the misconception is gone.</p><img className="rounded" src={IMG.steps} alt="" /></div>
          <div className="stack">
            {STEPS.map(([n, t, s, d, bg, sh], i) => (
              <Reveal key={n} d={i * 0.12} className="card step" style={{ '--bg': bg, '--shadow': sh }}>
                <div className="num">{n}</div>
                <div><h4>{t} <span className="text-italic" style={{ fontSize: 16 }}>{s}</span></h4><p style={{ marginTop: 6 }}>{d}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
        <div className="benefits grid g4">
          {BENEFITS.map(([t, d]) => <div key={t}><h6>{t}</h6><p style={{ marginTop: 6 }}>{d}</p></div>)}
        </div>
      </div></section>

      <Demo />

      <section id="faq" className="section"><div className="container center">
        <Title words={['Good', 'questions,']} hl="straight answers" />
        <div className="stack" style={{ width: '100%', alignItems: 'center' }}>
          {FAQ.map(([q, a], i) => <Accordion key={q} q={q} a={a} defaultOpen={i === 0} />)}
        </div>
      </div></section>

      <section className="section cta"><div className="container center">
        <span className="pretitle">Learn the why</span><div style={{ height: 14 }} />
        <Title words={['Turn', 'bugs', 'into']} hl="understanding" />
        <p style={{ maxWidth: 600 }}>See the diagnosis, then watch the system confirm the misconception is really gone.</p>
        <div className="cta-card">
          <h4>See how Re:Learn diagnoses programming misconceptions</h4>
          <Btn variant="primary" href="#/login">Try the live demo</Btn>
        </div>
      </div></section>

      <footer><div className="container">
        <div className="top">
          <div><div className="logo">Re<b>:</b>Learn</div><p style={{ marginTop: 16 }}>Adaptive learning for introductory programming.</p></div>
          <div><h5>Pages</h5><ul>{NAV.map(([l, h]) => <li key={l}><a href={h}>{l}</a></li>)}</ul></div>
        </div>
        <div className="bottom"><span>Re:Learn · Bit N Build, Web / App Dev</span><span>Frontend prototype</span></div>
      </div></footer>
    </div>
  )
}

/* tiny hash router: auth is required before entering the live-demo page */
export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const route = hash.slice(1).split('?')[0]
  const live = route === '/live'
  const login = route === '/login'
  const signup = route === '/signup'
  const mcq = route === '/mcq' || route === '/quiz'
  const profile = route === '/profile'
  const admin = route === '/admin'
  let session = null
  try {
    session = JSON.parse(localStorage.getItem('relearn-session') || 'null')
  } catch {
    localStorage.removeItem('relearn-session')
  }

  useEffect(() => {
    if ((live || mcq || profile || admin) && !session?.token) window.location.hash = '#/login'
  }, [live, mcq, profile, admin, session?.token])

  useEffect(() => {
    if (live || login || signup || mcq || profile || admin) { window.scrollTo(0, 0); return }
    if (hash.length > 1 && !hash.startsWith('#/')) {          // landing section anchors after coming back
      setTimeout(() => document.querySelector(hash)?.scrollIntoView(), 0)
    } else window.scrollTo(0, 0)
  }, [live, login, signup, mcq, hash])

  const goHome = () => { window.location.hash = '#top' }
  const goLive = () => { window.location.hash = '#/live' }
  if (mcq) {
    if (!session?.token) return <Login onSwitch={() => { window.location.hash = '#/signup' }} onSuccess={() => { window.location.hash = '#/mcq' }} onBack={goHome} />
    return <McqPage />
  }
  if (profile) {
    if (!session?.token) return <Login onSwitch={() => { window.location.hash = '#/signup' }} onSuccess={() => { window.location.hash = '#/profile' }} onBack={goHome} />
    return <ProfilePage />
  }
  if (admin) {
    if (!session?.token) return <Login onSwitch={() => { window.location.hash = '#/signup' }} onSuccess={() => { window.location.hash = '#/admin' }} onBack={goHome} />
    return <AdminPage />
  }
  if (login) return <Login onSwitch={() => { window.location.hash = '#/signup' }} onSuccess={goLive} onBack={goHome} />
  if (signup) return <Signup onSwitch={() => { window.location.hash = '#/login' }} onSuccess={goLive} onBack={goHome} />
  return live && session?.token ? <LivePage /> : <Landing />
}