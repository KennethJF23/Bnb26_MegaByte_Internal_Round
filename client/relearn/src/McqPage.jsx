import { useState, useEffect, useMemo, useRef } from 'react'
import { MCQ_BANK } from './data/mcqQuestions.js'
import { getIntervention, recordMcqAttempt } from './api.js'
import './mcq.css'

const CATEGORIES = [
  'All Topics',
  'Loops & Iteration',
  'Conditionals & Logic',
  'Lists & Memory References',
  'Functions & Recursion',
  'Strings & Immutability',
  'OOP & Data Structures',
  'Variables & Operators',
]

const DIFFICULTIES = ['All Difficulties', 'Beginner', 'Intermediate', 'Advanced']

export default function McqPage() {
  // Navigation & Mode
  const [mode, setMode] = useState('practice') // 'practice' | 'assessment' | 'catalog'
  
  // Storage & Answer State
  const [answers, setAnswers] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('relearn_mcq_answers') || '{}')
    } catch {
      return {}
    }
  })

  const [attemptHistory, setAttemptHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('relearn_mcq_attempt_history') || '{}')
    } catch {
      return {}
    }
  })

  const [flagged, setFlagged] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('relearn_mcq_flagged') || '{}')
    } catch {
      return {}
    }
  })

  // Filtering
  const [selectedCategory, setSelectedCategory] = useState('All Topics')
  const [selectedDifficulty, setSelectedDifficulty] = useState('All Difficulties')
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyMistakes, setOnlyMistakes] = useState(false)
  
  // Active Question Tracking
  const [currentIndex, setCurrentIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [feedbackVisible, setFeedbackVisible] = useState(false)
  const [interventionLevels, setInterventionLevels] = useState({})

  // Computerized Adaptive Testing (CAT / DDA) State
  const [adaptiveMode, setAdaptiveMode] = useState(true)
  const [currentLevel, setCurrentLevel] = useState('Intermediate') // 'Beginner' | 'Intermediate' | 'Advanced'
  const [streak, setStreak] = useState(0)
  const [adaptiveAlert, setAdaptiveAlert] = useState(null)

  // Assessment / Timed Exam Mode State
  const [examStarted, setExamStarted] = useState(false)
  const [examQuestions, setExamQuestions] = useState([])
  const [examTimer, setExamTimer] = useState(900) // 15 mins default
  const [examSubmitted, setExamSubmitted] = useState(false)
  const [showScoreModal, setShowScoreModal] = useState(false)

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('relearn_mcq_answers', JSON.stringify(answers))
  }, [answers])

  useEffect(() => {
    localStorage.setItem('relearn_mcq_flagged', JSON.stringify(flagged))
  }, [flagged])

  useEffect(() => {
    localStorage.setItem('relearn_mcq_attempt_history', JSON.stringify(attemptHistory))
  }, [attemptHistory])

  // Filtered Questions list for Practice Mode
  const filteredQuestions = useMemo(() => {
    return MCQ_BANK.filter((q) => {
      // Category match
      if (selectedCategory !== 'All Topics' && q.category !== selectedCategory) {
        return false
      }
      // Difficulty match
      if (selectedDifficulty !== 'All Difficulties' && q.difficulty !== selectedDifficulty) {
        return false
      }
      // Mistakes only filter
      if (onlyMistakes) {
        const userAns = answers[q.id]
        if (userAns === undefined || userAns === q.correct) {
          return false
        }
      }
      // Search query
      if (searchQuery.trim()) {
        const q_str = (
          q.title +
          ' ' +
          q.question +
          ' ' +
          q.code +
          ' ' +
          q.misconception +
          ' ' +
          (q.tags || []).join(' ')
        ).toLowerCase()
        if (!q_str.includes(searchQuery.toLowerCase())) {
          return false
        }
      }
      return true
    })
  }, [selectedCategory, selectedDifficulty, onlyMistakes, searchQuery, answers])

  // Ensure currentIndex stays within bounds when filters change
  useEffect(() => {
    if (currentIndex >= filteredQuestions.length) {
      setCurrentIndex(Math.max(0, filteredQuestions.length - 1))
    }
  }, [filteredQuestions.length, currentIndex])

  // Current active question set based on mode
  const activeQuestionList = mode === 'assessment' ? examQuestions : filteredQuestions
  const activeQuestion = activeQuestionList[currentIndex] || null

  // Global Statistics
  const stats = useMemo(() => {
    const totalAnswered = Object.keys(answers).length
    let correctCount = 0
    let mistakesCount = 0

    MCQ_BANK.forEach((q) => {
      if (answers[q.id] !== undefined) {
        if (answers[q.id] === q.correct) {
          correctCount++
        } else {
          mistakesCount++
        }
      }
    })

    const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0
    return { totalAnswered, correctCount, mistakesCount, accuracy }
  }, [answers])

  // Category breakdown for mastery sidebar
  const categoryMastery = useMemo(() => {
    return CATEGORIES.filter((c) => c !== 'All Topics').map((cat) => {
      const catQuestions = MCQ_BANK.filter((q) => q.category === cat)
      const answeredInCat = catQuestions.filter((q) => answers[q.id] !== undefined)
      const correctInCat = catQuestions.filter((q) => answers[q.id] === q.correct)
      return {
        name: cat,
        total: catQuestions.length,
        answered: answeredInCat.length,
        correct: correctInCat.length,
        pct: catQuestions.length ? Math.round((correctInCat.length / catQuestions.length) * 100) : 0,
      }
    })
  }, [answers])

  // Handle Option Selection
  const handleSelectOption = (optIdx) => {
    if (!activeQuestion) return
    const isCurrentChoiceCorrect = optIdx === activeQuestion.correct
    setFeedbackVisible(true)
    const previousAnswer = answers[activeQuestion.id]

    // If user already answered correctly, don't re-penalize or re-adjust
    if (previousAnswer !== undefined && previousAnswer === activeQuestion.correct) {
      return
    }

    setAnswers((prev) => ({
      ...prev,
      [activeQuestion.id]: optIdx,
    }))

    if (previousAnswer !== optIdx) {
      // Dynamic Difficulty Adjustment (DDA)
      if (adaptiveMode && mode === 'practice') {
        if (isCurrentChoiceCorrect) {
          const nextStreak = streak + 1
          setStreak(nextStreak)
          if (currentLevel === 'Beginner') {
            setCurrentLevel('Intermediate')
            setAdaptiveAlert({
              type: 'up',
              msg: '🚀 Promoted! Difficulty increased to Intermediate — testing real-world code structures.',
            })
          } else if (currentLevel === 'Intermediate' && nextStreak >= 1) {
            setCurrentLevel('Advanced')
            setAdaptiveAlert({
              type: 'up',
              msg: '🔥 Mastery Level Up! Promoted to Advanced — testing complex edge cases.',
            })
          } else {
            setAdaptiveAlert({
              type: 'up',
              msg: `⚡ Excellent! Streak: ${nextStreak} in Advanced tier!`,
            })
          }
        } else {
          setStreak(0)
          if (currentLevel === 'Advanced') {
            setCurrentLevel('Intermediate')
            setAdaptiveAlert({
              type: 'down',
              msg: '🎯 Scaffolding Activated: Difficulty adjusted to Intermediate to solidify core mental model.',
            })
          } else if (currentLevel === 'Intermediate') {
            setCurrentLevel('Beginner')
            setAdaptiveAlert({
              type: 'down',
              msg: '🎯 Foundational Support: Difficulty adjusted to Beginner to rebuild fundamental mental model.',
            })
          } else {
            setAdaptiveAlert({
              type: 'down',
              msg: '🎯 Foundational Support: Solidifying Beginner fundamentals.',
            })
          }
        }
      }

      const wrongStreak = isCurrentChoiceCorrect
        ? 0
        : (attemptHistory[activeQuestion.id] || []).reduceRight(
          (streak, attempt) => (attempt.correct ? 0 : streak + 1), 0,
        ) + 1
      getIntervention({
        current_difficulty: activeQuestion.difficulty,
        correct: isCurrentChoiceCorrect,
        wrong_streak: wrongStreak,
        confidence: isCurrentChoiceCorrect ? 1 : 0,
      }).then((data) => setInterventionLevels((prev) => ({
        ...prev, [activeQuestion.id]: data.explanation_level,
      }))).catch((error) => console.error('Could not load intervention:', error))
      recordMcqAttempt({
        questionId: activeQuestion.id,
        topic: activeQuestion.category,
        difficulty: activeQuestion.difficulty,
        correct: isCurrentChoiceCorrect,
        misconceptionId: isCurrentChoiceCorrect ? null : activeQuestion.misconception_id,
        misconceptionDescription: isCurrentChoiceCorrect ? '' : activeQuestion.misconception,
      }).catch((error) => console.error('Could not sync MCQ attempt:', error))
      setAttemptHistory((prev) => ({
        ...prev,
        [activeQuestion.id]: [
          ...(prev[activeQuestion.id] || []),
          {
            answer: optIdx,
            correct: isCurrentChoiceCorrect,
          },
        ],
      }))
    }
  }

  const getNextAdaptiveIndex = async () => {
    if (!activeQuestion || activeQuestionList.length < 2) return currentIndex

    const latestCorrect = answers[activeQuestion.id] === activeQuestion.correct
    let targetDifficulty = activeQuestion.difficulty
    try {
      const intervention = await getIntervention({
        current_difficulty: activeQuestion.difficulty,
        correct: latestCorrect,
        wrong_streak: 0,
        confidence: latestCorrect ? 1 : 0,
      })
      targetDifficulty = intervention.target_difficulty
    } catch (error) {
      console.error('Could not load adaptive intervention:', error)
    }
    const listLength = activeQuestionList.length
    const allCandidates = activeQuestionList
      .map((question, index) => ({ question, index }))
      .filter(({ index }) => index !== currentIndex)
    const forwardCandidates = allCandidates.filter(({ index }) => index > currentIndex)
    const candidates = (forwardCandidates.length ? forwardCandidates : allCandidates)
      .sort((a, b) => {
        const aAnswered = answers[a.question.id] !== undefined
        const bAnswered = answers[b.question.id] !== undefined
        const aForwardDistance = (a.index - currentIndex + listLength) % listLength
        const bForwardDistance = (b.index - currentIndex + listLength) % listLength
        return Number(aAnswered) - Number(bAnswered) ||
          Number(a.question.difficulty !== targetDifficulty) -
          Number(b.question.difficulty !== targetDifficulty) ||
          aForwardDistance - bForwardDistance
      })

    return candidates[0]?.index ?? currentIndex
  }

  // Adaptive Next Question Transition
  const handleNextQuestion = () => {
    setAdaptiveAlert(null)
    setFeedbackVisible(true)
    if (adaptiveMode && mode === 'practice') {
      const len = filteredQuestions.length
      // 1. Find next unanswered question matching currentLevel (forward first, then wrap)
      for (let step = 1; step < len; step++) {
        const idx = (currentIndex + step) % len
        const q = filteredQuestions[idx]
        if (q.difficulty === currentLevel && answers[q.id] === undefined) {
          setCurrentIndex(idx)
          return
        }
      }
      // 2. Fallback: find any next unanswered question (forward first, then wrap)
      for (let step = 1; step < len; step++) {
        const idx = (currentIndex + step) % len
        const q = filteredQuestions[idx]
        if (answers[q.id] === undefined) {
          setCurrentIndex(idx)
          return
        }
      }
    }
    setCurrentIndex((i) => Math.min(activeQuestionList.length - 1, i + 1))
  }

  const getExplanation = (question) => {
    const attempts = attemptHistory[question.id] || []
    const wrongStreak = attempts.reduceRight(
      (streak, attempt) => (attempt.correct ? 0 : streak + 1),
      0,
    )
    const level = interventionLevels[question.id]
    if (level === 'very_simple' && question.misconception) {
      return `Let's make it very simple: ${question.misconception} The correct rule is: ${question.takeaway}`
    }
    if (level === 'simple' && question.misconception) {
      return `Let's simplify it: ${question.misconception} Remember: ${question.takeaway}`
    }
    return question.explanation
  }

  // Toggle Flag
  const toggleFlag = (id) => {
    setFlagged((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  // Clear current question answer
  const clearCurrentAnswer = () => {
    if (!activeQuestion) return
    setFeedbackVisible(false)
    setAdaptiveAlert(null)
    setAnswers((prev) => {
      const copy = { ...prev }
      delete copy[activeQuestion.id]
      return copy
    })
  }

  // Reset all progress
  const resetAllProgress = () => {
    if (window.confirm('Reset all answers and progress across the 100 MCQs?')) {
      setAnswers({})
      setFlagged({})
      setAttemptHistory({})
      setStreak(0)
      setCurrentLevel('Intermediate')
      setAdaptiveAlert(null)
      localStorage.removeItem('relearn_mcq_answers')
      localStorage.removeItem('relearn_mcq_flagged')
      localStorage.removeItem('relearn_mcq_attempt_history')
    }
  }

  // Copy code snippet to clipboard
  const handleCopyCode = () => {
    if (!activeQuestion) return
    navigator.clipboard.writeText(activeQuestion.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  // Keyboard navigation & Shortcuts (1-4, ArrowLeft, ArrowRight, F)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return

      if (e.key === 'ArrowRight' || e.key === 'n') {
        if (
          mode === 'practice' ||
          currentIndex < activeQuestionList.length - 1
        ) {
          handleNextQuestion()
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'p') {
        if (currentIndex > 0) {
          setAdaptiveAlert(null)
          setCurrentIndex((i) => i - 1)
        }
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        const opt = parseInt(e.key, 10) - 1
        if (activeQuestion && opt < activeQuestion.options.length) {
          handleSelectOption(opt)
        }
      } else if (e.key.toLowerCase() === 'f' && activeQuestion) {
        toggleFlag(activeQuestion.id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, activeQuestionList.length, activeQuestion, mode])

  // Exam Mode timer
  useEffect(() => {
    let interval = null
    if (mode === 'assessment' && examStarted && !examSubmitted && examTimer > 0) {
      interval = setInterval(() => {
        setExamTimer((t) => {
          if (t <= 1) {
            clearInterval(interval)
            submitExam()
            return 0
          }
          return t - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [mode, examStarted, examSubmitted, examTimer])

  // Start Assessment Exam
  const startExam = (questionCount = 20) => {
    // Pick randomly from MCQ_BANK
    const shuffled = [...MCQ_BANK].sort(() => 0.5 - Math.random())
    const selected = shuffled.slice(0, Math.min(questionCount, MCQ_BANK.length))
    setExamQuestions(selected)
    setCurrentIndex(0)
    setExamTimer(questionCount * 60) // 1 minute per question
    setExamStarted(true)
    setExamSubmitted(false)
    setShowScoreModal(false)
    setMode('assessment')
  }

  // Submit Exam
  const submitExam = () => {
    setExamSubmitted(true)
    setShowScoreModal(true)
  }

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  const selectedAnswer =
    (mode === 'assessment' || feedbackVisible) && activeQuestion
      ? answers[activeQuestion.id]
      : undefined
  const hasAnswered = selectedAnswer !== undefined
  const isCorrect = hasAnswered && selectedAnswer === activeQuestion?.correct

  return (
    <div className="mcq-page">
      {/* --- Sticky Top Header Bar --- */}
      <header className="mcq-nav">
        <div className="container row">
          <div className="mcq-nav-left">
            <a href="#top" className="logo">
              Re<b>:</b>Learn
            </a>
            <span className="mcq-nav-badge">
              <span className="pulse-dot" />
              100 Diagnostic MCQs
            </span>
          </div>

          <div className="mcq-nav-actions">
            <a href="#/live" className="btn sm white">
              ← Live Code Editor
            </a>
            <a href="#/profile" className="btn sm white">
              My Profile
            </a>
            <a href="#top" className="btn sm">
              Home
            </a>
          </div>
        </div>
      </header>

      <main className="mcq-container">
        {/* --- Top View / Mode Selector & Quick Stats --- */}
        <div className="mcq-modes-bar">
          <div className="mcq-mode-tabs">
            <button
              className={`mcq-mode-tab ${mode === 'practice' ? 'active' : ''}`}
              onClick={() => setMode('practice')}
            >
              <span>Practice & Learn</span>
              <span className="tab-count">{MCQ_BANK.length}</span>
            </button>
            <button
              className={`mcq-mode-tab ${mode === 'assessment' ? 'active' : ''}`}
              onClick={() => {
                if (!examStarted) startExam(20)
                else setMode('assessment')
              }}
            >
              <span>Timed Assessment</span>
              <span className="tab-count">20 Qs</span>
            </button>
            <button
              className={`mcq-mode-tab ${mode === 'catalog' ? 'active' : ''}`}
              onClick={() => setMode('catalog')}
            >
              <span>Misconception Bank</span>
              <span className="tab-count">67</span>
            </button>
          </div>

          <div className="mcq-stats-pills">
            <div className="mcq-stat-pill">
              Answered: <strong>{stats.totalAnswered} / 100</strong>
            </div>
            <div className="mcq-stat-pill ok">
              Accuracy: <strong>{stats.accuracy}%</strong>
            </div>
            {stats.mistakesCount > 0 && (
              <div className="mcq-stat-pill warn">
                Misconceptions: <strong>{stats.mistakesCount}</strong>
              </div>
            )}
            <button
              className="btn sm white"
              style={{ padding: '6px 14px', fontSize: 13 }}
              onClick={resetAllProgress}
              title="Clear all stored answers and reset"
            >
              Reset All
            </button>
          </div>
        </div>

        {/* --- Mode: Misconception Catalog View --- */}
        {mode === 'catalog' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="panel" style={{ padding: '24px 30px' }}>
              <span className="pretitle">Empirical Research Dataset</span>
              <h3 style={{ margin: '8px 0' }}>The 67 Programming Misconceptions</h3>
              <p style={{ color: 'var(--muted)', maxWidth: 840 }}>
                Derived directly from empirical studies of introductory programmers. Each misconception is an active,
                coherent mental model that leads to recurring wrong answers. Click any card to test questions targeting that misconception.
              </p>
            </div>

            <div className="mcq-catalog-grid">
              {MCQ_BANK.slice(0, 67).map((item) => (
                <div key={item.id} className="mcq-catalog-card">
                  <div className="mcq-catalog-card-header">
                    <span className="mcq-catalog-id">Misconception #{item.misconception_id}</span>
                    <span className={`mcq-badge diff-${item.difficulty.toLowerCase()}`}>
                      {item.difficulty}
                    </span>
                  </div>
                  <h5 className="mcq-catalog-desc">{item.misconception}</h5>
                  <div className="mcq-code-container" style={{ maxHeight: 160 }}>
                    <pre className="mcq-code-body" style={{ fontSize: 12.5, padding: '10px 14px' }}>
                      {item.code}
                    </pre>
                  </div>
                  <div className="mcq-catalog-tags">
                    {(item.tags || []).slice(0, 3).map((t) => (
                      <span key={t} className="mcq-tag-chip">
                        #{t}
                      </span>
                    ))}
                  </div>
                  <button
                    className="mcq-btn primary"
                    style={{ width: '100%', marginTop: 6 }}
                    onClick={() => {
                      setSelectedCategory('All Topics')
                      setSelectedDifficulty('All Difficulties')
                      setSearchQuery(item.title)
                      setMode('practice')
                      setCurrentIndex(0)
                    }}
                  >
                    Practice This Concept →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- Mode: Timed Assessment Exam Banner --- */}
        {mode === 'assessment' && (
          <div className="mcq-exam-header">
            <div>
              <span className="pretitle" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
                Diagnostic Exam Mode
              </span>
              <h4 style={{ margin: '6px 0' }}>20-Question Misconception Diagnostic Assessment</h4>
              <p style={{ opacity: 0.8, fontSize: 14 }}>
                Instant feedback is muted during the test. Your diagnostic scorecard will be revealed upon submission.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div className={`mcq-exam-timer ${examTimer < 180 ? 'urgent' : ''}`}>
                ⏱ {formatTimer(examTimer)}
              </div>
              <button
                className="mcq-btn primary"
                style={{ background: 'var(--accent)', borderColor: 'var(--accent-d)', padding: '10px 24px' }}
                onClick={submitExam}
              >
                Submit Exam
              </button>
            </div>
          </div>
        )}

        {/* --- Toolbar / Filters (Visible in Practice Mode) --- */}
        {mode === 'practice' && (
          <div className="mcq-toolbar">
            <div className="mcq-filter-row">
              <div className="mcq-search-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search questions by concept, code keyword, or misconception..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="mcq-search-clear" onClick={() => setSearchQuery('')}>
                    ✕
                  </button>
                )}
              </div>

              <div className="mcq-dropdown-filters">
                <select
                  className="mcq-select"
                  value={selectedDifficulty}
                  onChange={(e) => setSelectedDifficulty(e.target.value)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <button
                  className={`mcq-toggle-btn ${onlyMistakes ? 'on' : ''}`}
                  onClick={() => setOnlyMistakes(!onlyMistakes)}
                  title="Filter to questions where you triggered a misconception"
                >
                  <span>⚠ Review Mistakes ({stats.mistakesCount})</span>
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="mcq-category-pills">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`mcq-cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- Main Interactive Assessment Layout (Practice / Exam) --- */}
        {mode !== 'catalog' && (
          <div className="mcq-grid">
            {/* LEFT COLUMN: Question Card */}
            <div>
              {/* Computerized Adaptive Testing (CAT / DDA) HUD */}
              {mode === 'practice' && (
                <div className="mcq-adaptive-hud">
                  <div className="mcq-adaptive-left">
                    <span className="mcq-adaptive-label">
                      🧠 Adaptive Intelligence:
                    </span>
                    <span className={`mcq-level-pill ${currentLevel.toLowerCase()}`}>
                      Current Tier: {currentLevel}
                    </span>
                    {streak > 0 && (
                      <span className="mcq-streak-pill">
                        🔥 Streak: {streak}
                      </span>
                    )}
                  </div>
                  <button
                    className={`mcq-adaptive-toggle ${adaptiveMode ? 'on' : ''}`}
                    onClick={() => {
                      setAdaptiveMode(!adaptiveMode)
                      setAdaptiveAlert(null)
                    }}
                    title="Toggle Dynamic Difficulty Adjustment"
                  >
                    <span>{adaptiveMode ? '✓ Adaptive DDA: ON' : '○ Adaptive DDA: OFF'}</span>
                  </button>
                </div>
              )}

              {/* Dynamic Notification on Level Change */}
              {adaptiveAlert && (
                <div className={`mcq-adaptive-alert ${adaptiveAlert.type}`}>
                  <span>{adaptiveAlert.msg}</span>
                </div>
              )}

              {activeQuestion ? (
                <div className="mcq-card">
                  {/* Card Header Meta */}
                  <div className="mcq-card-header">
                    <div className="mcq-badge-row">
                      <span className="mcq-badge category">{activeQuestion.category}</span>
                      <span className={`mcq-badge diff-${activeQuestion.difficulty.toLowerCase()}`}>
                        {activeQuestion.difficulty}
                      </span>
                      {activeQuestion.misconception_id > 0 && (
                        <span className="mcq-badge misc-id">
                          Misconception #{activeQuestion.misconception_id}
                        </span>
                      )}
                      <span className="mcq-badge" style={{ background: 'var(--page-2)', color: 'var(--muted)' }}>
                        {activeQuestion.type}
                      </span>
                    </div>

                    <div className="mcq-card-actions">
                      <button
                        className={`mcq-icon-btn ${flagged[activeQuestion.id] ? 'flagged' : ''}`}
                        onClick={() => toggleFlag(activeQuestion.id)}
                        title="Flag for later review (Hotkey: F)"
                      >
                        ★
                      </button>
                    </div>
                  </div>

                  {/* Question Prompt */}
                  <div className="mcq-question-block">
                    <span className="mcq-q-num">
                      Question {currentIndex + 1} of {activeQuestionList.length}
                    </span>
                    <h3 className="mcq-q-title">{activeQuestion.title}</h3>
                    <p className="mcq-q-prompt">{activeQuestion.question}</p>
                  </div>

                  {/* Syntax-Highlighted Code Snippet */}
                  <div className="mcq-code-container">
                    <div className="mcq-code-header">
                      <div className="mcq-code-dots">
                        <i />
                        <i />
                        <i />
                        <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
                          snippet.py
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="mcq-code-lang">python</span>
                        <button className="mcq-code-copy" onClick={handleCopyCode}>
                          {copied ? '✓ Copied!' : 'Copy Code'}
                        </button>
                      </div>
                    </div>
                    <pre className="mcq-code-body">{activeQuestion.code}</pre>
                  </div>

                  {/* Interactive Options List (A, B, C, D) */}
                  <div className="mcq-options-list">
                    {activeQuestion.options.map((optText, optIdx) => {
                      const letter = ['A', 'B', 'C', 'D'][optIdx]
                      const isSelected = selectedAnswer === optIdx
                      let stateClass = ''

                      if (isSelected) {
                        stateClass = 'selected'
                      }

                      // In Practice Mode, immediately highlight correctness once answered
                      if (mode === 'practice' && hasAnswered) {
                        if (optIdx === activeQuestion.correct) {
                          stateClass = 'is-correct'
                        } else if (isSelected && !isCorrect) {
                          stateClass = 'is-wrong'
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          className={`mcq-option-btn ${stateClass}`}
                          onClick={() => handleSelectOption(optIdx)}
                        >
                          <span className="mcq-opt-letter">{letter}</span>
                          <span className="mcq-opt-content">{optText}</span>
                          <span className="mcq-opt-shortcut">[{optIdx + 1}]</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Practice Mode Diagnostic Intelligence Feedback */}
                  {mode === 'practice' && hasAnswered && (
                    <div className={`mcq-diag-panel ${isCorrect ? 'diag-success' : 'diag-misconception'}`}>
                      <div className="mcq-diag-header">
                        <div className="mcq-diag-icon">{isCorrect ? '✓' : '⚠'}</div>
                        <div>
                          <div className="mcq-diag-title">
                            {isCorrect
                              ? 'Correct! Sound Python Mental Model'
                              : 'Misconception Diagnosed'}
                          </div>
                          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                            {isCorrect
                              ? 'Your execution trace matches Python semantics.'
                              : `Triggered belief: ${activeQuestion.misconception}`}
                          </div>
                        </div>
                      </div>

                      {/* Explanation of the runtime behavior */}
                      <div className="mcq-diag-body">
                        <p>{getExplanation(activeQuestion)}</p>
                      </div>

                      {/* Distractor Rationale for Every Option */}
                      {activeQuestion.distractors && (
                        <div className="mcq-distractors-card">
                          <strong style={{ fontSize: 13, color: 'var(--ink)' }}>
                            Why each option was designed:
                          </strong>
                          {activeQuestion.options.map((_, i) => {
                            const l = ['A', 'B', 'C', 'D'][i]
                            const isC = i === activeQuestion.correct
                            const reason = activeQuestion.distractors[i] || ''
                            return (
                              <div key={i} className="mcq-distractor-item">
                                <span className={`opt-tag ${isC ? 'c' : 'w'}`}>Option {l}</span>
                                <span>{reason}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Targeted Takeaway */}
                      <div className="mcq-takeaway-box">
                        <span>💡</span>
                        <span>
                          <strong>Core Rule:</strong> {activeQuestion.takeaway}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Card Navigation Footer */}
                  <div className="mcq-card-footer">
                    <div className="mcq-nav-buttons">
                      <button
                        className="mcq-btn secondary"
                        disabled={currentIndex === 0}
                        onClick={() => {
                          setAdaptiveAlert(null)
                          setFeedbackVisible(true)
                          setCurrentIndex((i) => i - 1)
                        }}
                      >
                        ← Previous
                      </button>
                      <button
                        className="mcq-btn primary"
                        disabled={
                          mode === 'assessment'
                            ? currentIndex === activeQuestionList.length - 1
                            : activeQuestionList.length < 2
                        }
                        onClick={handleNextQuestion}
                      >
                        Next Question →
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {hasAnswered && (
                        <button
                          className="mcq-btn secondary"
                          style={{ padding: '8px 16px', fontSize: 13 }}
                          onClick={clearCurrentAnswer}
                        >
                          Clear Selection
                        </button>
                      )}
                      <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                        Use [1-4] to select, [←/→] to browse
                      </small>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panel center" style={{ padding: 60 }}>
                  <h4>No questions match your current filters</h4>
                  <p style={{ color: 'var(--muted)', margin: '10px 0 20px' }}>
                    Try clearing your search query or selecting "All Topics" to see all 100 questions.
                  </p>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setSelectedCategory('All Topics')
                      setSelectedDifficulty('All Difficulties')
                      setSearchQuery('')
                      setOnlyMistakes(false)
                    }}
                  >
                    Reset Filters
                  </button>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Question Navigator Matrix & Mastery Widgets */}
            <aside className="mcq-sidebar">
              {/* Question Navigator Matrix */}
              <div className="mcq-sidebar-card">
                <div className="mcq-sidebar-title">
                  <span>Question Navigator</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {activeQuestionList.length} Questions
                  </span>
                </div>

                {/* Progress Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>Completion</span>
                    <span>
                      {Math.round(
                        (activeQuestionList.filter((q) => answers[q.id] !== undefined).length /
                          (activeQuestionList.length || 1)) *
                          100
                      )}
                      %
                    </span>
                  </div>
                  <div className="mcq-progress-bar-bg">
                    <div
                      className="mcq-progress-bar-fill"
                      style={{
                        width: `${Math.round(
                          (activeQuestionList.filter((q) => answers[q.id] !== undefined).length /
                            (activeQuestionList.length || 1)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Palette Grid Buttons (1 to N) */}
                <div className="mcq-palette-grid">
                  {activeQuestionList.map((q, idx) => {
                    const ans = answers[q.id]
                    const isAns = ans !== undefined
                    const isRight = isAns && ans === q.correct
                    const isCurr = idx === currentIndex
                    const isFlag = !!flagged[q.id]

                    let btnClass = ''
                    if (isCurr) btnClass += ' current'
                    if (isAns) {
                      if (mode === 'practice') {
                        btnClass += isRight ? ' answered-correct' : ' answered-wrong'
                      } else {
                        btnClass += ' answered-correct' // In exam mode, neutral answered
                      }
                    }
                    if (isFlag) btnClass += ' flagged'

                    return (
                      <button
                        key={q.id}
                        className={`mcq-pal-btn ${btnClass}`}
                        onClick={() => {
                          setAdaptiveAlert(null)
                          setFeedbackVisible(true)
                          setCurrentIndex(idx)
                        }}
                        title={`Q${idx + 1}: ${q.title}`}
                      >
                        {idx + 1}
                      </button>
                    )
                  })}
                </div>

                {/* Legend */}
                <div className="mcq-palette-legend">
                  <div className="mcq-legend-item">
                    <span className="mcq-legend-dot c-correct" />
                    <span>Correct</span>
                  </div>
                  <div className="mcq-legend-item">
                    <span className="mcq-legend-dot c-wrong" />
                    <span>Misconception</span>
                  </div>
                  <div className="mcq-legend-item">
                    <span className="mcq-legend-dot c-flag" />
                    <span>Flagged</span>
                  </div>
                  <div className="mcq-legend-item">
                    <span className="mcq-legend-dot c-unanswered" />
                    <span>Unanswered</span>
                  </div>
                </div>
              </div>

              {/* Topic Proficiency Breakdown */}
              <div className="mcq-sidebar-card">
                <div className="mcq-sidebar-title">
                  <span>Topic Mastery</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Accuracy</span>
                </div>

                <div className="mcq-mastery-list">
                  {categoryMastery.map((cat) => (
                    <div key={cat.name} className="mcq-mastery-row">
                      <div className="mcq-mastery-labels">
                        <span style={{ color: 'var(--ink)' }}>{cat.name}</span>
                        <span style={{ color: cat.pct > 70 ? '#176B4D' : cat.pct > 0 ? '#C03523' : 'var(--muted)' }}>
                          {cat.correct} / {cat.total} ({cat.pct}%)
                        </span>
                      </div>
                      <div className="mcq-mastery-track">
                        <div
                          className="mcq-mastery-fill"
                          style={{
                            width: `${cat.pct}%`,
                            background: cat.pct > 70 ? 'var(--mint-d)' : cat.pct > 0 ? 'var(--accent)' : 'var(--line)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* --- Scorecard Modal (Upon Assessment Submission) --- */}
      {showScoreModal && (
        <div className="mcq-modal-overlay">
          <div className="mcq-modal-card">
            <div className="mcq-score-hero">
              <span className="pretitle">Assessment Complete</span>
              <div className="mcq-score-circle">
                {Math.round(
                  (examQuestions.filter((q) => answers[q.id] === q.correct).length /
                    (examQuestions.length || 1)) *
                    100
                )}
                %
              </div>
              <h3>Diagnostic Scorecard</h3>
              <p style={{ color: 'var(--muted)' }}>
                You answered{' '}
                <strong>
                  {examQuestions.filter((q) => answers[q.id] === q.correct).length} of {examQuestions.length}
                </strong>{' '}
                questions correctly.
              </p>
            </div>

            {/* List of misconceptions detected during the test */}
            <div>
              <h5 style={{ marginBottom: 12 }}>Diagnosed Conceptual Weaknesses:</h5>
              <div className="mcq-mistakes-list">
                {examQuestions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== q.correct).length ===
                0 ? (
                  <p className="tag ok">No misconceptions detected! Outstanding work.</p>
                ) : (
                  examQuestions
                    .filter((q) => answers[q.id] !== undefined && answers[q.id] !== q.correct)
                    .map((q) => (
                      <div key={q.id} className="mcq-mistake-row">
                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>⚠</span>
                        <div>
                          <strong>{q.title}</strong>
                          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                            {q.misconception}
                          </p>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                className="mcq-btn secondary"
                onClick={() => {
                  setShowScoreModal(false)
                  setMode('practice')
                  setOnlyMistakes(true)
                }}
              >
                Review Diagnoses in Practice Mode
              </button>
              <button
                className="mcq-btn primary"
                onClick={() => {
                  setShowScoreModal(false)
                  startExam(20)
                }}
              >
                Retake Fresh Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
