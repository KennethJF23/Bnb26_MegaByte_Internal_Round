import { useEffect, useRef, useState } from 'react'
import { getProblems, submitCode } from './api.js'
import './live.css'

const pct = (x) => `${Math.round(x * 100)}%`
// strip markdown noise from the dataset descriptions
const tidy = (s) => s.replace(/^#+\s*/gm, '').replace(/```[a-z]*\n?/g, '').replace(/\*\*/g, '').trim()

export default function LivePage() {
  const [problems, setProblems] = useState([])
  const [pid, setPid] = useState(null)
  const [code, setCode] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('problem') // problem | result
  const taRef = useRef(null)

  useEffect(() => {
    getProblems()
      .then((ps) => { setProblems(ps); if (ps.length) { setPid(ps[0].id); setCode(ps[0].starter) } })
      .catch((e) => setErr(e.message))
  }, [])

  const problem = problems.find((p) => p.id === pid)

  const choose = (id) => {
    const p = problems.find((x) => x.id === id)
    setPid(id); setCode(p.starter); setRes(null); setErr(''); setTab('problem')
  }

  const submit = async () => {
    setBusy(true); setErr(''); setRes(null); setTab('result')
    try { setRes(await submitCode(pid, code)) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const onKey = (e) => {
    if (e.key === 'Tab') {           // Tab inserts 4 spaces instead of leaving the box
      e.preventDefault()
      const t = e.target, s = t.selectionStart
      const next = code.slice(0, s) + '    ' + code.slice(t.selectionEnd)
      setCode(next)
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4 })
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); if (!busy) submit()
    }
  }

  const d = res?.diagnosis
  const top = d?.candidates?.[0]
  const noKnown = d && !d.uncertain && d.diagnosis?.misconception_id === 0

  return (
    <div className="live">
      <nav className="nav"><div className="container row">
        <a href="#top" className="logo">Re<b>:</b>Learn</a>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="#/mcq" className="btn sm" style={{ background: 'var(--brand)', color: 'var(--white)', border: 'none' }}>MCQ Bank (100 Qs)</a>
          <a href="#top" className="btn sm white back">← Back home</a>
        </div>
      </div></nav>

      <div className="container">
        <div className="head">
          <span className="pretitle">Live demo</span>
          <h4>Submit code. Find out if it’s right, and if not, why.</h4>
        </div>

        {err && !problems.length && <span className="tag bad">{err}</span>}

        <div className="cols">
          {/* LEFT: problem / result tabs */}
          <div className="panel pane">
            <div className="tabs">
              <button className={tab === 'problem' ? 'on' : ''} onClick={() => setTab('problem')}>Problem</button>
              <button className={tab === 'result' ? 'on' : ''} onClick={() => setTab('result')}>
                Result{res && <i className={`dot ${res.correct ? 'ok' : 'bad'}`} />}
              </button>
              <a href="#/mcq" style={{ all: 'unset', cursor: 'pointer', padding: '10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Diagnostic MCQs (100) ↗
              </a>
            </div>

            <div className="scroll" data-lenis-prevent>
              {tab === 'problem' && <>
                <select value={pid ?? ''} onChange={(e) => choose(Number(e.target.value))}>
                  {problems.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                {problem && <>
                  <p className="desc">{tidy(problem.description)}</p>
                  <div className="ex">{problem.examples.join('\n')}</div>
                  <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
                    Your code is checked against {problem.n_tests} tests (examples above are the first {problem.examples.length}).
                  </p>
                </>}
              </>}

              {tab === 'result' && <>
                {busy && <p className="text-italic">Running your code…</p>}
                {!busy && !res && !err && <p className="text-italic">Submit your code to see the result here.</p>}
                {err && <span className="tag bad">{err}</span>}

                {res && <>
                  <div className={`verdict ${res.correct ? 'ok' : 'bad'}`}>
                    <span>{res.correct ? '✓ Correct' : '✗ Wrong'}</span>
                    <small>{res.passed} of {res.total} tests passed</small>
                  </div>

                  {res.error && <div className="fail"><b>Error</b>{'\n'}{res.error}</div>}
                  {res.failures.map((f, i) => (
                    <div className="fail" key={i}>
                      <b>Failed:</b> {f.test}
                      {f.got !== undefined && <>{'\n'}<b>Got:</b> {f.got}   <b>Expected:</b> {f.expected}</>}
                      {f.exception && <>{'\n'}<b>Raised:</b> {f.exception}</>}
                    </div>
                  ))}

                  {res.correct && <p>All tests pass, so there is no misconception to diagnose.</p>}
                  {res.syntax && <p>Fix the syntax error first. The model diagnoses logic, not typos.</p>}

                  {d && (
                    <div className="diag">
                      <span className="pretitle">Model diagnosis</span>
                      {d.uncertain ? (
                        <h5 style={{ margin: '12px 0 4px' }}>Not confident enough to name a misconception.</h5>
                      ) : noKnown ? (
                        <h5 style={{ margin: '12px 0 4px' }}>No known misconception matches. This is probably a different kind of bug.</h5>
                      ) : (
                        <h5 style={{ margin: '12px 0 4px' }}>{d.diagnosis.description}</h5>
                      )}
                      {top && !noKnown && !d.uncertain && <p>Confidence {pct(top.confidence)}</p>}
                      <p className="text-md" style={{ marginTop: 14 }}>{d.uncertain ? 'Closest matches' : 'Other candidates'}</p>
                      {d.candidates.map((c) => (
                        <div className="bar-row" key={c.misconception_id}>
                          <div className="bar"><i style={{ width: pct(c.confidence) }} /></div>
                          <span>{pct(c.confidence)}</span>
                          <span>{c.misconception_id === 0 ? 'Correct / no misconception' : c.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>}
              </>}
            </div>
          </div>

          {/* RIGHT: editor */}
          <div className="panel pane">
            <h5>Your solution (Python)</h5>
            <textarea ref={taRef} data-lenis-prevent className="editor" value={code} spellCheck={false}
              onChange={(e) => setCode(e.target.value)} onKeyDown={onKey} />
            <div className="actions">
              <button className="btn primary" onClick={submit} disabled={busy || !problem || !code.trim()}>
                {busy ? 'Running…' : 'Submit'}
              </button>
              <small>Ctrl + Enter to submit</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}