import { useEffect, useMemo, useState } from 'react'
import { getProgress } from './api.js'
import './profile.css'

const empty = { mcqAttempts: [], codeAttempts: [] }

export default function ProfilePage() {
  const [profile, setProfile] = useState(null)
  const [progress, setProgress] = useState(empty)
  const [error, setError] = useState('')

  useEffect(() => {
    getProgress()
      .then((data) => {
        setProfile(data)
        setProgress({ mcqAttempts: data.mcqAttempts || [], codeAttempts: data.codeAttempts || [] })
      })
      .catch((err) => setError(err.message))
  }, [])

  const totals = useMemo(() => {
    const all = [...progress.mcqAttempts, ...progress.codeAttempts]
    return {
      attempts: all.length,
      correct: all.filter((attempt) => attempt.correct).length,
      mcqCorrect: progress.mcqAttempts.filter((attempt) => attempt.correct).length,
      codeCorrect: progress.codeAttempts.filter((attempt) => attempt.correct).length,
    }
  }, [progress])

  const topics = useMemo(() => {
    const grouped = {}
    for (const attempt of [
      ...progress.mcqAttempts.map((item) => ({ ...item, format: 'MCQ' })),
      ...progress.codeAttempts.map((item) => ({ ...item, format: 'Coding' })),
    ]) {
      const topic = attempt.topic || 'Unknown'
      if (!grouped[topic]) grouped[topic] = { topic, total: 0, correct: 0, mcq: 0, code: 0 }
      grouped[topic].total += 1
      grouped[topic].correct += Number(attempt.correct)
      if (attempt.format === 'MCQ') grouped[topic].mcq += 1
      else grouped[topic].code += 1
    }
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [progress])

  const activity = useMemo(() => {
    const attempts = [
      ...progress.mcqAttempts.map((item) => ({ ...item, format: 'MCQ', label: item.questionId })),
      ...progress.codeAttempts.map((item) => ({ ...item, format: 'Coding', label: `Problem ${item.problemId}` })),
    ]
    const byDay = {}
    attempts.forEach((item) => {
      const day = item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : 'unknown'
      if (day !== 'unknown') byDay[day] = (byDay[day] || 0) + 1
    })
    return {
      attempts,
      byDay,
      recent: attempts
        .filter((item) => item.createdAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 6),
    }
  }, [progress])

  const activityDays = useMemo(() => {
    const days = []
    for (let index = 69; index >= 0; index -= 1) {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - index)
      const key = date.toISOString().slice(0, 10)
      days.push({ key, count: activity.byDay[key] || 0 })
    }
    return days
  }, [activity])

  if (error) return <main className="profile-page"><p className="profile-error">{error}</p></main>
  if (!profile) return <main className="profile-page"><p>Loading your learning profile…</p></main>

  const accuracy = totals.attempts ? Math.round((totals.correct / totals.attempts) * 100) : 0
  const incorrect = totals.attempts - totals.correct
  return (
    <main className="profile-page">
      <header className="profile-header">
        <a className="profile-back" href="#top">← Back to home</a>
        <div className="profile-brand">Re<b>:</b>Learn</div>
      </header>
      <section className="profile-layout">
        <aside className="profile-sidebar">
          <div className="profile-heading">
            <div className="profile-avatar">{profile.username.slice(0, 1).toUpperCase()}</div>
            <div>
              <span className="pretitle">Learner profile</span>
              <h1>{profile.username}</h1>
            </div>
          </div>
          <p className="profile-sidebar-copy">Adaptive learning for introductory programming.</p>
          <div className="profile-sidebar-divider" />
          <div className="profile-sidebar-stat"><span>Questions attempted</span><strong>{totals.attempts}</strong></div>
          <div className="profile-sidebar-stat"><span>Topics practiced</span><strong>{topics.length}</strong></div>
          <div className="profile-sidebar-stat"><span>Accuracy</span><strong>{accuracy}%</strong></div>
          <a className="profile-sidebar-link" href="#/mcq">Practice MCQs <span>→</span></a>
          <a className="profile-sidebar-link" href="#/live">Open code editor <span>→</span></a>
        </aside>
        <div className="profile-main">
          <section className="profile-card profile-summary-grid">
            <div className="profile-card-title"><span>Problem solving</span><small>All time</small></div>
            <div className="profile-solved"><div className="profile-ring" style={{ '--accuracy': `${accuracy * 3.6}deg` }}><div><strong>{totals.correct}</strong><span>Solved</span></div></div><div><strong>{totals.attempts}</strong><span>Attempted</span></div></div>
            <div className="profile-difficulty"><div><b className="easy">MCQ</b><strong>{totals.mcqCorrect}/{progress.mcqAttempts.length}</strong></div><div><b className="medium">Coding</b><strong>{totals.codeCorrect}/{progress.codeAttempts.length}</strong></div><div><b className="hard">Revisit</b><strong>{incorrect}</strong></div></div>
          </section>
          <section className="profile-card profile-activity">
            <div className="profile-card-title"><span>{activity.attempts.length} submissions</span><small>Last 70 days</small></div>
            <div className="heatmap">{activityDays.map((day) => <i key={day.key} className={`heat-${Math.min(day.count, 4)}`} title={`${day.key}: ${day.count} attempt${day.count === 1 ? '' : 's'}`} />)}</div>
            <div className="heatmap-legend"><span>Less</span><i className="heat-0" /><i className="heat-1" /><i className="heat-2" /><i className="heat-3" /><i className="heat-4" /><span>More</span></div>
          </section>
          <section className="profile-card">
            <div className="profile-card-title"><span>Topic performance</span><small>Correct answers by concept</small></div>
            {topics.length === 0 && <p className="profile-muted">Complete an MCQ or submit code to start your profile.</p>}
            {topics.map((item) => {
              const pct = Math.round((item.correct / item.total) * 100)
              return (
                <article className="trend-row" key={item.topic}>
                  <div className="trend-label"><strong>{item.topic}</strong><span>{item.correct}/{item.total} correct · {item.mcq} MCQ · {item.code} coding</span></div>
                  <div className="trend-bar"><i style={{ width: `${pct}%` }} /></div>
                  <b>{pct}%</b>
                </article>
              )
            })}
          </section>
          <section className="profile-card profile-recent">
            <div className="profile-card-title"><span>Recent activity</span><small>Latest attempts</small></div>
            {activity.recent.length === 0 && <p className="profile-muted">Your recent attempts will appear here.</p>}
            {activity.recent.map((item, index) => <div className="recent-row" key={`${item.format}-${item.label}-${index}`}><span className={`recent-icon ${item.correct ? 'recent-ok' : 'recent-wrong'}`}>{item.correct ? '✓' : '×'}</span><div><strong>{item.label}</strong><span>{item.format} · {item.topic}</span></div><small>{new Date(item.createdAt).toLocaleDateString()}</small></div>)}
          </section>
        </div>
      </section>
    </main>
  )
}
