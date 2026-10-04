import { useEffect, useMemo, useRef, useState } from 'react'
import { getIntervention, getProblems, submitCode } from './api.js'
import './live.css'

const pct = (x) => `${Math.round(x * 100)}%`
// strip markdown noise from the dataset descriptions
const tidy = (s) => s.replace(/^#+\s*/gm, '').replace(/```[a-z]*\n?/g, '').replace(/\*\*/g, '').trim()
const CATEGORIES = ['All Topics', 'Arrays & Lists', 'Strings', 'Math & Number Theory', 'Searching & Sorting', 'Recursion & Backtracking', 'Data Structures', 'Logic & Control Flow']
const DIFFICULTIES = ['All Difficulties', 'Beginner', 'Intermediate', 'Advanced']
const difficulty = (problem) => problem.n_tests >= 8 ? 'Advanced' : problem.n_tests >= 4 ? 'Intermediate' : 'Beginner'

export default function LivePage() {
  const [problems, setProblems] = useState([])
  const [pid, setPid] = useState(null)
  const [code, setCode] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('problem') // problem | result
  const [selectedCategory, setSelectedCategory] = useState('All Topics')
  const [selectedDifficulty, setSelectedDifficulty] = useState('All Difficulties')
  const [searchQuery, setSearchQuery] = useState('')
  const [attemptHistory, setAttemptHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('relearn_code_attempt_history') || '{}')
    } catch {
      return {}
    }
  })
  const [explanationLevel, setExplanationLevel] = useState('standard')
  const [adaptiveBusy, setAdaptiveBusy] = useState(false)
  const taRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('relearn_code_attempt_history', JSON.stringify(attemptHistory))
  }, [attemptHistory])

  useEffect(() => {
    getProblems()
      .then((ps) => { setProblems(ps); if (ps.length) { setPid(ps[0].id); setCode(ps[0].starter) } })
      .catch((e) => setErr(e.message))
  }, [])

  const filteredProblems = useMemo(() => problems.filter((p) => {
    if (selectedCategory !== 'All Topics' && p.category !== selectedCategory) return false
    if (selectedDifficulty !== 'All Difficulties' && difficulty(p) !== selectedDifficulty) return false
    if (searchQuery.trim() && !`${p.title} ${p.description}`.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  }), [problems, selectedCategory, selectedDifficulty, searchQuery])
  const currentIndex = Math.max(0, filteredProblems.findIndex((p) => p.id === pid))
  const problem = problems.find((p) => p.id === pid)
  const categoryCounts = useMemo(() => CATEGORIES.slice(1).map((category) => ({
    category, total: problems.filter((p) => p.category === category).length,
  })), [problems])

  const choose = (id) => {
    const p = problems.find((x) => x.id === id)
    setPid(id); setCode(p.starter); setRes(null); setErr(''); setTab('problem')
  }

  useEffect(() => {
    if (filteredProblems.length && !filteredProblems.some((p) => p.id === pid)) choose(filteredProblems[0].id)
  }, [filteredProblems, pid])

  const move = (offset) => {
    const next = filteredProblems[currentIndex + offset]
    if (next) choose(next.id)
  }

  const getNextAdaptiveProblem = async (wasCorrect) => {
    if (!problem || filteredProblems.length < 2) return null
    let targetDifficulty = difficulty(problem)
    try {
      const intervention = await getIntervention({
        current_difficulty: difficulty(problem),
        correct: wasCorrect,
        wrong_streak: wasCorrect ? 0 : (attemptHistory[pid] || []).reduceRight(
          (streak, attempt) => (attempt.correct ? 0 : streak + 1), 0,
        ),
        confidence: res?.diagnosis?.diagnosis?.confidence || 0,
      })
      targetDifficulty = intervention.target_difficulty
    } catch (error) {
      console.error('Could not load adaptive intervention:', error)
    }
    const candidates = filteredProblems
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => index !== currentIndex)
      .sort((a, b) => {
        const aAnswered = (attemptHistory[a.item.id] || []).length > 0
        const bAnswered = (attemptHistory[b.item.id] || []).length > 0
        return Number(aAnswered) - Number(bAnswered) ||
          Number(difficulty(a.item) !== targetDifficulty) -
          Number(difficulty(b.item) !== targetDifficulty) ||
          a.index - b.index
      })
    return candidates[0]?.item || null
  }

  const goToNextProblem = async () => {
    if (filteredProblems.length < 2 || adaptiveBusy) return
    if (!res) {
      const next = filteredProblems[currentIndex + 1]
      if (next) choose(next.id)
      return
    }
    setAdaptiveBusy(true)
    try {
      const next = await getNextAdaptiveProblem(res.correct)
      if (next && next.id !== pid) choose(next.id)
    } finally {
      setAdaptiveBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true); setErr(''); setRes(null); setTab('result')
    try {
      const result = await submitCode(pid, code)
      setRes(result)
      const wrongStreak = result.correct ? 0 : (attemptHistory[pid] || []).reduceRight(
        (streak, attempt) => (attempt.correct ? 0 : streak + 1), 0,
      ) + 1
      getIntervention({
        current_difficulty: difficulty(problem),
        correct: result.correct,
        wrong_streak: wrongStreak,
        confidence: result.diagnosis?.diagnosis?.confidence || 0,
      }).then((data) => setExplanationLevel(data.explanation_level))
        .catch((error) => console.error('Could not load explanation intervention:', error))
      setAttemptHistory((prev) => ({
        ...prev,
        [pid]: [...(prev[pid] || []), { correct: result.correct }],
      }))
    }
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
  const misconceptionText = d?.diagnosis?.description || top?.description
  const simplifiedMisconception = explanationLevel === 'very_simple'
    ? `Let's make it very simple: ${misconceptionText} The core rule is to make every test case pass.`
    : explanationLevel === 'simple'
      ? `Let's simplify it: ${misconceptionText} Check the expected value for each failing test and adjust the logic.`
      : misconceptionText

  return (
    <div className="live">
      <nav className="nav"><div className="container row">
        <a href="#top" className="logo">Re<b>:</b>Learn</a>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="#/mcq" className="btn sm" style={{ background: 'var(--brand)', color: 'var(--white)', border: 'none' }}>MCQ Bank (100 Qs)</a>
          <a href="#/profile" className="btn sm white">My Profile</a>
          <a href="#top" className="btn sm white back">← Back home</a>
        </div>
      </div></nav>

      <div className="container">
        <div className="head">
          <span className="pretitle">Live demo</span>
          <h4>Submit code. Find out if it’s right, and if not, why.</h4>
        </div>

        {err && !problems.length && <span className="tag bad">{err}</span>}

        <div className="live-toolbar">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search problems by topic or concept..."
          />
          <select value={selectedDifficulty} onChange={(e) => setSelectedDifficulty(e.target.value)}>
            {DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="live-category-pills">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              className={selectedCategory === category ? 'active' : ''}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="cols">
          <main className="live-main">
            <section className="panel live-question">
              {problem && filteredProblems.length > 0 && <>
                <div className="live-problem-header">
                  <span className="live-badge">{problem.category}</span>
                  <span className="live-badge">{difficulty(problem)}</span>
                  <span className="live-position">Problem {currentIndex + 1} of {filteredProblems.length}</span>
                </div>
                <h3>{problem.title}</h3>
                <p className="desc">{tidy(problem.description)}</p>
                <div className="ex">{problem.examples.join('\n')}</div>
                <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
                  Your code is checked against {problem.n_tests} tests (examples above are the first {problem.examples.length}).
                </p>
                <div className="live-card-nav">
                  <button className="btn white" disabled={currentIndex === 0} onClick={() => move(-1)}>← Previous</button>
                  <button
                    className="btn white"
                    disabled={filteredProblems.length < 2 || adaptiveBusy}
                    onClick={goToNextProblem}
                  >
                    {adaptiveBusy ? 'Choosing…' : res ? 'Next Adaptive Problem →' : 'Next →'}
                  </button>
                </div>
              </>}
              {!filteredProblems.length && <div className="live-empty"><h5>No problems match these filters</h5><button className="btn primary" onClick={() => { setSelectedCategory('All Topics'); setSelectedDifficulty('All Difficulties'); setSearchQuery('') }}>Reset Filters</button></div>}
            </section>

            <section className="panel live-editor">
              <h5>Your solution (Python)</h5>
              <textarea ref={taRef} data-lenis-prevent className="editor" value={code} spellCheck={false}
                onChange={(e) => setCode(e.target.value)} onKeyDown={onKey} />
              <div className="actions">
                <button className="btn primary" onClick={submit} disabled={busy || !problem || !code.trim()}>
                  {busy ? 'Running…' : 'Submit'}
                </button>
                <small>Ctrl + Enter to submit</small>
              </div>
            </section>

            <section className="panel live-result">
              <div className="live-result-heading">
                <h5>Result</h5>
                {res && <i className={`dot ${res.correct ? 'ok' : 'bad'}`} />}
              </div>
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
                    <div className={`live-diagnosis ${noKnown || d.uncertain ? 'diagnosis-neutral' : 'diagnosis-warning'}`}>
                      <div className="live-diagnosis-header">
                        <div className="live-diagnosis-icon">{noKnown || d.uncertain ? '✓' : '⚠'}</div>
                        <div>
                          <h4>{noKnown ? 'Correct! Sound Python Mental Model' : d.uncertain ? 'No Confirmed Misconception' : 'Misconception Diagnosed'}</h4>
                          <p>{noKnown ? 'Your execution trace matches the expected Python behavior.' : d.uncertain ? 'The submitted code does not match a known misconception confidently enough.' : simplifiedMisconception}</p>
                        </div>
                      </div>
                      <div className="live-diagnosis-body">
                        <p>{res.correct ? 'All tests passed, so the implementation follows the expected behavior.' : `The solution failed ${res.total - res.passed} of ${res.total} tests. The model compared the code with known misconception patterns.`}</p>
                        {top && !noKnown && <p className="live-confidence">Confidence {pct(top.confidence)}</p>}
                      </div>
                      <div className="live-candidates">
                        <strong>Why this result was identified:</strong>
                        {d.candidates.map((c) => (
                          <div className="live-candidate" key={c.misconception_id}>
                            <span className={c.misconception_id === d.diagnosis?.misconception_id ? 'candidate-tag active' : 'candidate-tag'}>
                              {c.misconception_id === 0 ? 'Correct' : `Candidate #${c.misconception_id}`}
                            </span>
                            <span>{c.description}</span>
                            <small>{pct(c.confidence)}</small>
                          </div>
                        ))}
                      </div>
                      <div className="live-takeaway">
                        <span>💡</span>
                        <span><strong>Core Rule:</strong> Read the test failures and update the function so it returns the required value for every example case.</span>
                      </div>
                    </div>
                  )}
                </>}
            </section>
          </main>
          <aside className="live-sidebar">
            <div className="live-sidebar-card">
              <div className="live-sidebar-title"><span>Problem Navigator</span><span>{filteredProblems.length}</span></div>
              <div className="live-progress"><i style={{ width: `${filteredProblems.length ? ((currentIndex + 1) / filteredProblems.length) * 100 : 0}%` }} /></div>
              <div className="live-palette">
                {filteredProblems.map((item, index) => (
                  <button key={item.id} className={item.id === pid ? 'current' : ''} onClick={() => choose(item.id)} title={item.title}>{index + 1}</button>
                ))}
              </div>
            </div>
            <div className="live-sidebar-card">
              <div className="live-sidebar-title"><span>Topic Coverage</span><span>Problems</span></div>
              {categoryCounts.map(({ category, total }) => (
                <button key={category} className="live-topic-row" onClick={() => setSelectedCategory(category)}>
                  <span>{category}</span><strong>{total}</strong>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}