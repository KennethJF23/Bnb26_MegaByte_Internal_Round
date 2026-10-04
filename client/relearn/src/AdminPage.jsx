import { useEffect, useState } from 'react'
import { getAdminDashboard } from './api.js'
import './admin.css'

export default function AdminPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { getAdminDashboard().then(setData).catch((err) => setError(err.message)) }, [])
  if (error) return <main className="admin-page"><p className="profile-error">{error}</p></main>
  if (!data) return <main className="admin-page"><p>Loading admin dashboard…</p></main>
  const metrics = data.evaluation?.standard_metrics?.overall_metrics || {}
  const matrix = Object.entries(data.evaluation?.standard_metrics?.by_misconception || {})
  return (
    <main className="admin-page">
      <header className="admin-header"><a href="#top">← Back to home</a><span>Re<b>:</b>Learn Admin</span></header>
      <div className="admin-title"><span className="pretitle">Model operations</span><h1>Admin dashboard</h1><p>Monitor learner growth and misconception model quality.</p></div>
      <section className="admin-cards">
        <div><strong>{data.users}</strong><span>Registered users</span></div>
        <div><strong>{metrics.total_bags || 0}</strong><span>Evaluation samples</span></div>
        <div><strong>{Math.round((metrics.overall_accuracy || 0) * 100)}%</strong><span>Overall accuracy</span></div>
        <div><strong>{Math.round((metrics.misconception_accuracy || 0) * 100)}%</strong><span>Misconception accuracy</span></div>
      </section>
      <section className="admin-panel"><div className="admin-panel-heading"><h2>Evaluation matrix</h2><span>By misconception</span></div><div className="admin-table"><div className="admin-row admin-head"><b>ID</b><b>Accuracy</b><b>Correct groups</b><b>Total groups</b></div>{matrix.map(([id, item]) => <div className="admin-row" key={id}><span>#{id}</span><span>{Math.round((item.accuracy || 0) * 100)}%</span><span>{item.correct_groups}</span><span>{item.total_groups}</span></div>)}</div></section>
    </main>
  )
}
