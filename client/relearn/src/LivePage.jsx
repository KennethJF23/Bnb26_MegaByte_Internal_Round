import { useEffect, useRef, useState } from 'react'
import {
  getProblems,
  submitCode,
  diagnoseSnippet,
  resolveProbe,
  markInterventionDelivered,
  recordAnalyticsEvent,
} from './api.js'
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
  const [resolvingProbe, setResolvingProbe] = useState(false)
  const [isFreeform, setIsFreeform] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('problem') // problem | result
  const taRef = useRef(null)

  useEffect(() => {
    getProblems()
      .then((ps) => {
        setProblems(ps)
        if (ps.length) {
          setPid(ps[0].id)
          setCode(ps[0].starter)
        }
      })
      .catch((e) => setErr(e.message))
  }, [])

  const problem = problems.find((p) => p.id === pid)

  const choose = (id) => {
    const p = problems.find((x) => x.id === id)
    setPid(id)
    setCode(p ? p.starter : '')
    setRes(null)
    setErr('')
    setTab('problem')
  }

  const toggleFreeform = (freeform) => {
    setIsFreeform(freeform)
    setRes(null)
    setErr('')
    if (freeform) {
      if (!code.trim()) {
        setCode('# Freeform Python diagnostic — paste any code\ndef modify_text(s):\n    s.replace("a", "b")\n    return s\n')
      }
    } else if (problem) {
      setCode(problem.starter)
    }
  }

  const submit = async () => {
    setBusy(true)
    setErr('')
    setRes(null)
    setTab('result')
    try {
      let result
      if (isFreeform) {
        const diagRes = await diagnoseSnippet(code)
        result = {
          correct: !diagRes.diagnosis?.misconception_id,
          passed: diagRes.diagnosis?.misconception_id ? 0 : 1,
          total: 1,
          failures: [],
          diagnosis: diagRes.diagnosis,
          intervention: diagRes.intervention,
          isFreeform: true,
        }
      } else {
        result = await submitCode(pid, code)
      }
      setRes(result)

      const diagObj = result?.diagnosis
      const miscId = diagObj?.misconception_id || diagObj?.diagnosis?.misconception_id || null
      const diagDesc = diagObj?.description || diagObj?.diagnosis?.description || null
      const topCand = diagObj?.candidates?.[0]

      recordAnalyticsEvent({
        eventType: 'code_submission',
        problemId: isFreeform ? 'freeform_code' : String(pid),
        title: isFreeform ? 'Custom Python Snippet' : (problem?.title || `Problem ${pid}`),
        category: isFreeform ? (diagObj?.category || 'General Python') : (problem?.category || 'Algorithms & Logic'),
        difficulty: 'Intermediate',
        correct: !!result?.correct,
        testsPassed: result?.passed || (result?.correct ? 5 : 0),
        testsTotal: result?.total || 5,
        targetsMisconceptionId: miscId,
        misconceptionId: miscId ? String(miscId) : null,
        misconceptionName: result?.correct ? null : (diagDesc || 'Identified Execution Bug'),
        misconceptionConfidence: topCand?.confidence || 0.85,
        studentConfidence: 'medium',
      }).catch(() => {})
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleResolveProbe = async (probe, chosenId) => {
    try {
      setResolvingProbe(true)
      const resolved = await resolveProbe(probe, chosenId)
      if (resolved) {
        setRes((prev) => ({
          ...prev,
          diagnosis: resolved.diagnosis,
          intervention: resolved.intervention,
        }))
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setResolvingProbe(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const t = e.target, s = t.selectionStart
      const next = code.slice(0, s) + '    ' + code.slice(t.selectionEnd)
      setCode(next)
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4 })
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (!busy) submit()
    }
  }

  const d = res?.diagnosis
  const top = d?.candidates?.[0]
  const miscId = d?.misconception_id ?? d?.diagnosis?.misconception_id ?? null
  const miscDesc = d?.description ?? d?.diagnosis?.description ?? null
  const noKnown = d && !d.uncertain && miscId === 0

  return (
    <div className="live">
      <nav className="nav">
        <div className="container row">
          <a href="#top" className="logo">Re<b>:</b>Learn</a>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="#/analytics" className="btn sm" style={{ background: '#5B4BF5', color: '#fff', border: 'none' }}>
              📈 Trends & Mastery
            </a>
            <a href="#/mcq" className="btn sm" style={{ background: 'var(--brand)', color: 'var(--white)', border: 'none' }}>
              MCQ Bank (100 Qs)
            </a>
            <a href="#top" className="btn sm white back">← Back home</a>
          </div>
        </div>
      </nav>

      <div className="container">
        <div className="head" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className="pretitle">Live Code Diagnosis</span>
            <h4>Submit code. Find out if it’s right, and if not, why.</h4>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className={`btn sm ${!isFreeform ? 'primary' : 'white'}`}
              onClick={() => toggleFreeform(false)}
            >
              Curated Challenge
            </button>
            <button
              className={`btn sm ${isFreeform ? 'primary' : 'white'}`}
              onClick={() => toggleFreeform(true)}
            >
              Freeform Snippet
            </button>
          </div>
        </div>

        {err && !problems.length && !isFreeform && <span className="tag bad">{err}</span>}

        <div className="cols">
          {/* LEFT: problem / result tabs */}
          <div className="panel pane">
            <div className="tabs">
              <button className={tab === 'problem' ? 'on' : ''} onClick={() => setTab('problem')}>
                {isFreeform ? 'Mode Info' : 'Problem'}
              </button>
              <button className={tab === 'result' ? 'on' : ''} onClick={() => setTab('result')}>
                Result{res && <i className={`dot ${res.correct ? 'ok' : 'bad'}`} />}
              </button>
              <a href="#/analytics" style={{ all: 'unset', cursor: 'pointer', padding: '10px 16px', fontSize: 13, fontWeight: 600, color: '#5B4BF5', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                📈 Trends
              </a>
              <a href="#/mcq" style={{ all: 'unset', cursor: 'pointer', padding: '10px 16px', fontSize: 13, fontWeight: 600, color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Diagnostic MCQs (100) ↗
              </a>
            </div>

            <div className="scroll" data-lenis-prevent>
              {tab === 'problem' && (
                <>
                  {!isFreeform ? (
                    <>
                      <select value={pid ?? ''} onChange={(e) => choose(Number(e.target.value))}>
                        {problems.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </select>
                      {problem && (
                        <>
                          <p className="desc">{tidy(problem.description)}</p>
                          <div className="ex">{problem.examples.join('\n')}</div>
                          <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
                            Your code is checked against {problem.n_tests} tests (examples above are the first {problem.examples.length}).
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{ padding: '10px 0' }}>
                      <h5>Freeform Python Diagnosis</h5>
                      <p className="desc" style={{ marginTop: 10 }}>
                        Paste any Python function or snippet into the editor. Re:Learn’s ML classifier and deterministic AST rules will analyze the code against all 67 empirical misconception classes without needing predefined unit tests.
                      </p>
                      <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--panel)', color: 'var(--page)', borderRadius: 14, fontSize: 13, lineHeight: 1.6 }}>
                        💡 Try writing code with subtle Python traps, such as:
                        <br />• Mutable default arguments: <code>def add(x, lst=[])</code>
                        <br />• In-place string mutation: <code>s.replace("a", "b")</code> without reassignment
                        <br />• Off-by-one indexing: <code>range(len(arr) + 1)</code>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === 'result' && (
                <>
                  {busy && <p className="text-italic">Running analysis…</p>}
                  {!busy && !res && !err && <p className="text-italic">Submit your code to see the result here.</p>}
                  {err && <span className="tag bad">{err}</span>}

                  {res && (
                    <>
                      <div className={`verdict ${res.correct ? 'ok' : 'bad'}`}>
                        <span>{res.correct ? '✓ Correct / Clean' : '✗ Bug / Misconception Detected'}</span>
                        <small>{res.isFreeform ? 'Static Cognitive Analysis' : `${res.passed} of ${res.total} tests passed`}</small>
                      </div>

                      {res.error && <div className="fail"><b>Error</b>{'\n'}{res.error}</div>}
                      {res.failures && res.failures.map((f, i) => (
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
                          <span className="pretitle">Model Diagnosis · {d.engine || 'hybrid'}</span>
                          {d.uncertain ? (
                            <h5 style={{ margin: '12px 0 4px' }}>Not confident enough to name a misconception.</h5>
                          ) : noKnown ? (
                            <h5 style={{ margin: '12px 0 4px' }}>No known misconception matches. This is probably a different kind of bug.</h5>
                          ) : (
                            <h5 style={{ margin: '12px 0 4px' }}>{miscDesc}</h5>
                          )}
                          {top && !noKnown && !d.uncertain && (
                            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                              Diagnosis Confidence: <b>{pct(top.confidence || d.confidence || 0.8)}</b>
                            </p>
                          )}

                          {/* Sibling Disambiguation Probe */}
                          {d.ambiguous && d.probe && (
                            <div style={{ background: 'rgba(255, 107, 87, 0.1)', border: '1px solid rgba(255, 107, 87, 0.35)', borderRadius: 12, padding: 14, margin: '14px 0' }}>
                              <span className="tag bad" style={{ marginBottom: 6 }}>Ambiguous Reasoning Detected</span>
                              <h6 style={{ margin: '6px 0 8px', color: 'var(--ink)' }}>{d.probe.question}</h6>
                              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                                Multiple distinct mental models can generate this error. Tell us what you intended:
                              </p>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {d.probe.options.map((opt) => (
                                  <button
                                    key={opt.misconception_id}
                                    className="btn sm"
                                    style={{ textAlign: 'left', background: 'var(--page)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '8px 12px', fontSize: 13, borderRadius: 8 }}
                                    onClick={() => handleResolveProbe(d.probe, opt.misconception_id)}
                                    disabled={resolvingProbe}
                                  >
                                    {opt.text}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Deterministic AST Evidence */}
                          {d.evidence && (
                            <div style={{ background: 'rgba(115, 210, 222, 0.1)', border: '1px solid rgba(115, 210, 222, 0.3)', borderRadius: 10, padding: '10px 14px', margin: '12px 0', fontSize: 13 }}>
                              <strong style={{ color: '#00838F' }}>Deterministic Evidence:</strong>
                              <p style={{ marginTop: 4, color: 'var(--ink)' }}>{d.evidence}</p>
                            </div>
                          )}

                          {/* Prescribed Intervention & Direct Verification Link */}
                          {res.intervention && (
                            <div style={{ background: 'rgba(91, 75, 245, 0.08)', border: '1px solid rgba(91, 75, 245, 0.3)', borderRadius: 12, padding: 14, margin: '14px 0' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                <span className="tag" style={{ background: '#5B4BF5', color: '#fff' }}>
                                  {res.intervention.tierName || `Tier ${res.intervention.tier}`}
                                </span>
                                {res.intervention.estimatedMin && <small style={{ color: 'var(--muted)' }}>~{res.intervention.estimatedMin}m fix</small>}
                              </div>
                              <h5 style={{ margin: '6px 0', color: 'var(--ink)' }}>{res.intervention.goal || 'Targeted Conceptual Fix'}</h5>
                              {res.intervention.hints && (
                                <ul style={{ paddingLeft: 18, margin: '8px 0', fontSize: 13, lineHeight: 1.5 }}>
                                  {res.intervention.hints.map((h, i) => <li key={i}>{h}</li>)}
                                </ul>
                              )}
                              {res.intervention.item && (
                                <a
                                  href={`#/mcq?q=${res.intervention.item.id}`}
                                  className="btn sm primary"
                                  style={{ marginTop: 10, display: 'inline-block' }}
                                  onClick={() => {
                                    if (miscId) {
                                      markInterventionDelivered(miscId, res.intervention.interventionId).catch(() => {})
                                    }
                                  }}
                                >
                                  Verify on Diagnostic Item {res.intervention.item.id} ➔
                                </a>
                              )}
                            </div>
                          )}

                          {/* Candidate Distribution Bars */}
                          {d.candidates && d.candidates.length > 0 && (
                            <>
                              <p className="text-md" style={{ marginTop: 14 }}>
                                {d.uncertain ? 'Closest matches' : 'Diagnostic Candidates'}
                              </p>
                              {d.candidates.map((c) => (
                                <div className="bar-row" key={c.misconception_id}>
                                  <div className="bar"><i style={{ width: pct(c.confidence) }} /></div>
                                  <span>{pct(c.confidence)}</span>
                                  <span>{c.misconception_id === 0 ? 'Correct / no misconception' : c.description}</span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: editor */}
          <div className="panel pane">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h5>Your solution (Python)</h5>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {isFreeform ? 'Freeform Mode (Any Code)' : 'Challenge Mode'}
              </span>
            </div>
            <textarea
              ref={taRef}
              data-lenis-prevent
              className="editor"
              value={code}
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="actions">
              <button
                className="btn primary"
                onClick={submit}
                disabled={busy || (!isFreeform && !problem) || !code.trim()}
              >
                {busy ? 'Analyzing…' : isFreeform ? 'Diagnose Code' : 'Submit & Check'}
              </button>
              <small>Ctrl + Enter to submit</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}