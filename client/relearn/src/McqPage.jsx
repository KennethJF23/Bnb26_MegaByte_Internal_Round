import { useState, useEffect, useMemo, useRef } from 'react'
import { MCQ_BANK } from './data/mcqQuestions.js'
import { recordAnalyticsEvent, markInterventionDelivered } from './api.js'
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

const CATEGORY_INSIGHTS = {
  'Loops & Iteration': {
    analogy: "Think of range(n) not as counting to n, but as a factory conveyor belt with n predetermined numbered slots: 0, 1, ..., n-1. When you loop, the loop variable is handed the next item from the belt. Mutating that variable inside the loop body never changes the conveyor belt's predetermined schedule.",
    goldenRule: "range(start, stop, step) includes start but stops strictly before stop. Total iterations = (stop - start) / step.",
    trap: "Assuming range(n) ends at n inclusive or that mutating the loop index rewinds iteration.",
  },
  'Lists & Memory References': {
    analogy: "In Python, a variable holding a list is just a sticky note with a house address. Writing list2 = list1 does NOT build a second house—it just writes the exact same address on a second sticky note! Any remodeling done through list2 permanently changes list1's house.",
    goldenRule: "Always make an explicit copy: list2 = list1.copy() or list2 = list1[:] (or copy.deepcopy() for nested lists).",
    trap: "Expecting assignment '=' to duplicate list contents in independent memory.",
  },
  'Functions & Recursion': {
    analogy: "Every recursive call is an independent clone working in its own isolated room (stack frame). When a clone finishes, it calls 'return' to hand its result back to the clone above it. If you forget to return the recursive call, the answer drops on the floor and Python hands back None.",
    goldenRule: "Every single branch in a recursive function MUST explicitly return a value, including the base case.",
    trap: "Forgetting to return the recursive call: 'helper(n-1)' instead of 'return helper(n-1)'.",
  },
  'Conditionals & Logic': {
    analogy: "Python evaluates 'and' and 'or' with short-circuit evaluation from left to right. In 'A or B', if A is truthy, Python immediately returns A without ever checking B. Non-zero numbers and non-empty collections are always truthy!",
    goldenRule: "Write out comparisons explicitly: write 'x == 1 or x == 2', NEVER 'x == 1 or 2' (which evaluates as (x == 1) or True).",
    trap: "Believing 'or' groups values grammatically instead of evaluating Boolean expressions.",
  },
  'Strings & Immutability': {
    analogy: "Strings in Python are carved into stone. They can never be mutated in-place. Methods like .replace(), .strip(), and .upper() don't chisel the existing stone—they sculpt a brand new stone and return it to you.",
    goldenRule: "Always reassign the return value of string operations: s = s.replace('a', 'b').",
    trap: "Calling string methods without reassigning: s.replace('a', 'b') leaves s unchanged!",
  },
  'OOP & Data Structures': {
    analogy: "Default function and method arguments like def __init__(self, items=[]): are evaluated ONCE when the code is first loaded into memory by Python, NOT every time a new class instance is created. All objects end up sharing the exact same list!",
    goldenRule: "Never use mutable defaults. Always use def __init__(self, items=None): followed by self.items = items if items is not None else [].",
    trap: "Using [] or {} as default parameters in functions or constructors.",
  },
  'Variables & Operators': {
    analogy: "Single '=' is an action (bind variable to object), while '==' is a question (are these values equal?). Division '/' always produces a floating point number (4 / 2 -> 2.0), while '//' floors to an integer.",
    goldenRule: "Use '//' for integer index calculations and '=' solely for assignment.",
    trap: "Confusing '=' with '==' or expecting integer division from '/'.",
  },
}

function generateStepTrace(q, chosenOptIdx) {
  const isCorrect = chosenOptIdx === q.correct
  const chosenText = chosenOptIdx !== undefined && q.options[chosenOptIdx] ? q.options[chosenOptIdx] : 'None'
  const correctText = q.options[q.correct]
  const distractorReason = q.distractors?.[chosenOptIdx] || q.explanation

  return [
    {
      step: 'Step 1: Initialization',
      action: 'Python allocates memory and prepares variables',
      trap: 'Often assumes 1-based indexing or pass-by-value duplication',
      reality: 'Variables initialized according to exact Python object model',
    },
    {
      step: 'Step 2: Runtime Evaluation',
      action: 'Expressions evaluated left-to-right following operator precedence',
      trap: `Misconception Trap: ${q.misconception}`,
      reality: q.explanation.length > 130 ? q.explanation.slice(0, 130) + '...' : q.explanation,
    },
    {
      step: 'Step 3: State Mutation',
      action: 'Memory state after loops/conditionals complete',
      trap: isCorrect ? 'None (Student correctly anticipated runtime)' : `Led to distractor Option: "${chosenText}"`,
      reality: `Evaluated correctly to Option: "${correctText}"`,
    },
    {
      step: 'Step 4: Output Emission',
      action: 'Result printed to console or returned to caller',
      trap: isCorrect ? 'None' : distractorReason,
      reality: `Final result: ${correctText}`,
    },
  ]
}

function getSocraticHint(q, wrongChoiceIdx) {
  const chosenText = q.options[wrongChoiceIdx] || ''
  const cat = q.category
  if (cat === 'Loops & Iteration') {
    return `You predicted "${chosenText}". Check the bounds: in Python, does the loop include or exclude the endpoint? Trace the counter values on a piece of paper starting from index 0.`
  }
  if (cat === 'Functions & Recursion') {
    return `You predicted "${chosenText}". Check whether the function has an explicit 'return' statement or if it only calls print(). Remember: in Python, printing to stdout does NOT assign a value to a variable; functions without an explicit return statement evaluate to None.`
  }
  if (cat === 'Lists & Memory References') {
    return `You predicted "${chosenText}". Ask yourself: did the assignment operator create an entirely new list in memory, or did both variables point to the exact same list address in the heap?`
  }
  if (cat === 'Strings & Immutability') {
    return `You predicted "${chosenText}". In Python, strings cannot be mutated in-place. If a string method like .replace() is called, does it modify the original string or return a brand new one?`
  }
  if (cat === 'Conditionals & Logic') {
    return `You predicted "${chosenText}". Notice how Python evaluates 'and' and 'or'. Non-zero numbers and non-empty collections are considered truthy in conditional checks.`
  }
  if (cat === 'OOP & Data Structures') {
    return `You predicted "${chosenText}". Check where default parameter values are initialized in Python. Are default lists created once when Python reads the function, or fresh on every call?`
  }
  return `You predicted "${chosenText}". Trace how Python loads and mutates these variables step-by-step.`
}

function generateEscalatedClue(q, wrongAttempts) {
  const letters = ['A', 'B', 'C', 'D']
  if (!wrongAttempts || wrongAttempts.length === 0) return ''
  const firstIdx = wrongAttempts[0]
  const secondIdx = wrongAttempts[1]
  const opt1 = q.options[firstIdx]
  const opt2 = secondIdx !== undefined ? q.options[secondIdx] : null

  let text = `In Attempt 1, you selected Option ${letters[firstIdx]} ("${opt1}"). `
  if (opt2) {
    text += `In Attempt 2, you switched to Option ${letters[secondIdx]} ("${opt2}"). `
  }
  text += `Both attempts triggered common misconceptions. `

  if (q.category === 'Functions & Recursion') {
    text += `Notice the difference between side-effects and return values: print() only outputs characters to stdout; it returns nothing. In Python, an unreturned function call always produces the singleton object 'None'.`
  } else if (q.category === 'Loops & Iteration') {
    text += `Notice that range(n) stops BEFORE n (from 0 to n-1). If range(n-1) is used, it stops before n-1.`
  } else if (q.category === 'Lists & Memory References') {
    text += `In Python, assigning 'list2 = list1' does NOT make a duplicate copy. Both variables share the exact same reference in the heap.`
  } else if (q.category === 'Strings & Immutability') {
    text += `Python strings are immutable. Any string operation produces a new string and leaves the original variable untouched unless explicitly reassigned.`
  } else if (q.category === 'Conditionals & Logic') {
    text += `Python's 'and'/'or' operators short-circuit based on truthiness rather than returning simple boolean True/False.`
  } else {
    text += `Inspect the execution step table below to see the exact memory and variable transitions.`
  }
  return text
}

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

  // Computerized Adaptive Testing (CAT / DDA) State
  const [adaptiveMode, setAdaptiveMode] = useState(true)
  const [currentLevel, setCurrentLevel] = useState('Intermediate') // 'Beginner' | 'Intermediate' | 'Advanced'
  const [streak, setStreak] = useState(0)
  const [adaptiveAlert, setAdaptiveAlert] = useState(null)

  // Progressive Multi-Tier Explanation State
  const [explanationTier, setExplanationTier] = useState('pivot') // 'pivot' | 'trace' | 'analogy' | 'distractors'
  const [attemptHistory, setAttemptHistory] = useState({})
  const [escalatedQuestions, setEscalatedQuestions] = useState({})
  const [wrongAttempts, setWrongAttempts] = useState({}) // { [qId]: [opt0, opt2] }
  const [revealedAnswers, setRevealedAnswers] = useState({}) // { [qId]: boolean }

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

  // Support deep-linking from Performance Trends & recommendations: #/mcq?q=mcq-5 or ?misconceptionId=8
  useEffect(() => {
    const handleUrlTarget = () => {
      const hash = window.location.hash || ''
      const queryPart = hash.includes('?') ? hash.split('?')[1] : ''
      if (!queryPart) return
      const params = new URLSearchParams(queryPart)
      const targetQId = params.get('q')
      const targetMiscId = params.get('misconceptionId')

      if (targetQId || targetMiscId) {
        const foundIdx = MCQ_BANK.findIndex((q) => {
          if (targetQId && q.id === targetQId) return true
          if (targetMiscId && q.misconception_id === Number(targetMiscId)) return true
          return false
        })
        if (foundIdx !== -1) {
          setSelectedCategory('All Topics')
          setSelectedDifficulty('All Difficulties')
          setOnlyMistakes(false)
          setSearchQuery('')
          setCurrentIndex(foundIdx)
        }
      }
    }
    handleUrlTarget()
    window.addEventListener('hashchange', handleUrlTarget)
    return () => window.removeEventListener('hashchange', handleUrlTarget)
  }, [])

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

  // Handle Option Selection with Multi-Attempt Adaptive Escalation
  const handleSelectOption = (optIdx) => {
    if (!activeQuestion) return
    const qId = activeQuestion.id
    const isCorrect = optIdx === activeQuestion.correct
    const prevWrongs = wrongAttempts[qId] || []

    // If this wrong option was already tried and failed, don't re-penalize
    if (prevWrongs.includes(optIdx) && !revealedAnswers[qId] && answers[qId] !== activeQuestion.correct) return

    // If already revealed or already solved correctly, let user view options freely
    if (revealedAnswers[qId] || answers[qId] === activeQuestion.correct) {
      setAnswers((prev) => ({ ...prev, [qId]: optIdx }))
      return
    }

    if (isCorrect) {
      // Correct answer!
      setAnswers((prev) => ({ ...prev, [qId]: optIdx }))
      setRevealedAnswers((prev) => ({ ...prev, [qId]: true }))
      setExplanationTier('pivot')

      if (adaptiveMode && mode === 'practice') {
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
      }

      recordAnalyticsEvent({
        eventType: 'mcq_assessment',
        problemId: String(activeQuestion.id),
        title: activeQuestion.title,
        category: activeQuestion.category,
        difficulty: activeQuestion.difficulty,
        correct: true,
        testsPassed: 1,
        testsTotal: 1,
        targetsMisconceptionId: activeQuestion.misconception_id,
        misconceptionId: activeQuestion.misconception_id ? String(activeQuestion.misconception_id) : null,
        misconceptionName: activeQuestion.misconception || null,
        misconceptionConfidence: 0.95,
        studentConfidence: 'high',
      }).catch(() => {})

      return
    }

    // WRONG ANSWER: Register attempt and escalate explanation
    const updatedWrongs = [...prevWrongs, optIdx]
    setWrongAttempts((prev) => ({ ...prev, [qId]: updatedWrongs }))
    setAnswers((prev) => ({ ...prev, [qId]: optIdx }))

    const attemptCount = updatedWrongs.length

    // If 1st mistake -> Level 1 Guiding Socratic Hint (hide correct answer so student can try again!)
    // If 2nd mistake -> Level 2 Deep Memory Step Trace
    // If 3rd mistake -> Level 3 Reveal Solution & Full Conceptual Model
    if (attemptCount === 1) {
      setExplanationTier('pivot')
    } else if (attemptCount === 2) {
      setExplanationTier('trace')
      setEscalatedQuestions((prev) => ({ ...prev, [qId]: 2 }))
    } else {
      setRevealedAnswers((prev) => ({ ...prev, [qId]: true }))
      setExplanationTier('analogy')
    }

    // Adaptive DDA down on mistake
    if (adaptiveMode && mode === 'practice') {
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
      }
    }

    // Notify backend learner model that an intervention was presented
    if (activeQuestion.misconception_id) {
      markInterventionDelivered(
        activeQuestion.misconception_id,
        `mcq_${activeQuestion.id}_tier_${attemptCount}`
      ).catch(() => {})
    }

    recordAnalyticsEvent({
      eventType: 'mcq_assessment',
      problemId: String(activeQuestion.id),
      title: activeQuestion.title,
      category: activeQuestion.category,
      difficulty: activeQuestion.difficulty,
      correct: false,
      testsPassed: 0,
      testsTotal: 1,
      targetsMisconceptionId: activeQuestion.misconception_id,
      misconceptionId: activeQuestion.misconception_id ? String(activeQuestion.misconception_id) : null,
      misconceptionName: activeQuestion.misconception,
      misconceptionConfidence: 0.9,
      studentConfidence: 'medium',
    }).catch(() => {})
  }

  // Adaptive Next Question Transition
  const handleNextQuestion = () => {
    setAdaptiveAlert(null)
    if (adaptiveMode && mode === 'practice') {
      // Find next unanswered question matching currentLevel
      let candidateIdx = -1
      for (let i = 0; i < filteredQuestions.length; i++) {
        const q = filteredQuestions[i]
        if (q.difficulty === currentLevel && answers[q.id] === undefined && i !== currentIndex) {
          candidateIdx = i
          break
        }
      }
      if (candidateIdx === -1) {
        for (let i = 0; i < filteredQuestions.length; i++) {
          const q = filteredQuestions[i]
          if (answers[q.id] === undefined && i !== currentIndex) {
            candidateIdx = i
            break
          }
        }
      }
      if (candidateIdx !== -1) {
        setCurrentIndex(candidateIdx)
        setExplanationTier('pivot')
        return
      }
    }
    setCurrentIndex((i) => Math.min(activeQuestionList.length - 1, i + 1))
    setExplanationTier('pivot')
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
      localStorage.removeItem('relearn_mcq_answers')
      localStorage.removeItem('relearn_mcq_flagged')
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
        if (currentIndex < activeQuestionList.length - 1) {
          setCurrentIndex((i) => i + 1)
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'p') {
        if (currentIndex > 0) {
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
  }, [currentIndex, activeQuestionList.length, activeQuestion])

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

  const selectedAnswer = activeQuestion ? answers[activeQuestion.id] : undefined
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
            <a href="#/analytics" className="btn sm" style={{ background: '#5B4BF5', color: '#fff', border: 'none' }}>
              📈 Trends & Mastery
            </a>
            <a href="#/live" className="btn sm white">
              ← Live Code Editor
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
              {/* Computerized Adaptive Testing (CAT) HUD */}
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
                      const qWrongs = wrongAttempts[activeQuestion.id] || []
                      const isRevealed = revealedAnswers[activeQuestion.id] || false
                      const isAnswerCorrect = selectedAnswer === activeQuestion.correct
                      const shouldShowGreen = isAnswerCorrect || isRevealed
                      const wasWrong = qWrongs.includes(optIdx)
                      const isSelected = selectedAnswer === optIdx
                      let stateClass = ''

                      if (isSelected) {
                        stateClass = 'selected'
                      }

                      if (mode === 'practice' && hasAnswered) {
                        if (shouldShowGreen && optIdx === activeQuestion.correct) {
                          stateClass = 'is-correct'
                        } else if (wasWrong) {
                          stateClass = 'is-wrong'
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          className={`mcq-option-btn ${stateClass}`}
                          disabled={mode === 'practice' && wasWrong && !shouldShowGreen}
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
                    (() => {
                      const qWrongs = wrongAttempts[activeQuestion.id] || []
                      const isAnswerCorrect = selectedAnswer === activeQuestion.correct
                      const isRevealed = revealedAnswers[activeQuestion.id] || false
                      const attemptCount = qWrongs.length
                      const lastWrongIdx = qWrongs[qWrongs.length - 1]

                      // CASE 1: Answered Correctly OR Solution Revealed
                      if (isAnswerCorrect || isRevealed) {
                        return (
                          <div className={`mcq-diag-panel ${isAnswerCorrect ? 'diag-success' : 'diag-misconception'}`}>
                            <div className="mcq-diag-header">
                              <div className="mcq-diag-icon">{isAnswerCorrect ? '✓' : '💡'}</div>
                              <div>
                                <div className="mcq-diag-title">
                                  {isAnswerCorrect
                                    ? (attemptCount === 0
                                        ? 'Correct! Sound Python Mental Model'
                                        : `Correct! Misconception Resolved on Attempt #${attemptCount + 1}`)
                                    : 'Full Solution & Architectural Model Revealed'}
                                </div>
                                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                                  {isAnswerCorrect
                                    ? 'Your execution trace matches Python runtime semantics.'
                                    : `Underlying Misconception: ${activeQuestion.misconception}`}
                                </div>
                              </div>
                            </div>

                            {/* Multi-Tier Tabs */}
                            <div className="mcq-tier-tabs">
                              <button
                                className={`mcq-tier-btn ${explanationTier === 'pivot' ? 'active' : ''}`}
                                onClick={() => setExplanationTier('pivot')}
                              >
                                💡 Concept Pivot
                              </button>
                              <button
                                className={`mcq-tier-btn ${explanationTier === 'trace' ? 'active' : ''}`}
                                onClick={() => setExplanationTier('trace')}
                              >
                                🔍 Step Trace
                              </button>
                              <button
                                className={`mcq-tier-btn ${explanationTier === 'analogy' ? 'active' : ''}`}
                                onClick={() => setExplanationTier('analogy')}
                              >
                                🧠 Deep Analogy & Rule
                              </button>
                              {activeQuestion.distractors && (
                                <button
                                  className={`mcq-tier-btn ${explanationTier === 'distractors' ? 'active' : ''}`}
                                  onClick={() => setExplanationTier('distractors')}
                                >
                                  🎯 Why Each Option?
                                </button>
                              )}
                            </div>

                            {explanationTier === 'pivot' && (
                              <div className="mcq-diag-body">
                                <p style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 12px' }}>{activeQuestion.explanation}</p>
                                
                                {activeQuestion.code.includes('print') && !activeQuestion.code.includes('return') && (
                                  <div className="mcq-code-comparison">
                                    <div className="mcq-code-col trap">
                                      <span className="col-label">⚠️ Trap: Printing vs Returning</span>
                                      <code>print(...) writes to stdout (console display). It produces NO return value for caller assignment.</code>
                                    </div>
                                    <div className="mcq-code-col fix">
                                      <span className="col-label">🛡️ Fix: Explicit Return Value</span>
                                      <code>Use explicit {`'return <value>'`} to pass data back to caller variables. Otherwise Python returns None.</code>
                                    </div>
                                  </div>
                                )}
                                {activeQuestion.category === 'Loops & Iteration' && (
                                  <div className="mcq-code-comparison">
                                    <div className="mcq-code-col trap">
                                      <span className="col-label">⚠️ Common Range Trap</span>
                                      <code>Expecting range(n) to include n, or expecting range(n) to start from 1.</code>
                                    </div>
                                    <div className="mcq-code-col fix">
                                      <span className="col-label">🛡️ Python Reality</span>
                                      <code>range(n) starts at 0 and stops at n - 1 (generating exactly n elements: 0, 1, ..., n-1).</code>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {explanationTier === 'trace' && (
                              <div className="mcq-trace-table-wrap">
                                <table className="mcq-trace-table">
                                  <thead>
                                    <tr>
                                      <th>Execution Phase</th>
                                      <th>Runtime Action</th>
                                      <th>Intuition Trap</th>
                                      <th>Python Reality</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {generateStepTrace(activeQuestion, lastWrongIdx).map((row, idx) => (
                                      <tr key={idx}>
                                        <td className="mono">{row.step}</td>
                                        <td>{row.action}</td>
                                        <td><span className="trap">{row.trap}</span></td>
                                        <td><span className="reality">{row.reality}</span></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {explanationTier === 'analogy' && (
                              <div className="mcq-analogy-card">
                                <div className="mcq-analogy-header">
                                  <span>🧠 Mental Model Analogy ({activeQuestion.category})</span>
                                </div>
                                <p className="mcq-analogy-text">
                                  {CATEGORY_INSIGHTS[activeQuestion.category]?.analogy ||
                                    "Python executes strictly by formal language semantics, independent of conversational English grammar."}
                                </p>
                                <div className="mcq-golden-rule">
                                  <span>🛡️</span>
                                  <div>
                                    <b>Defensive Rule:</b> {CATEGORY_INSIGHTS[activeQuestion.category]?.goldenRule || activeQuestion.takeaway}
                                  </div>
                                </div>
                              </div>
                            )}

                            {explanationTier === 'distractors' && activeQuestion.distractors && (
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

                            <div className="mcq-takeaway-box">
                              <span>💡</span>
                              <span>
                                <strong>Core Rule:</strong> {activeQuestion.takeaway}
                              </span>
                            </div>
                          </div>
                        )
                      }

                      // CASE 2: FIRST WRONG ATTEMPT -> Level 1 Guiding Socratic Hint (Green answer is hidden so they can try again!)
                      if (attemptCount === 1) {
                        const wrongLetter = ['A', 'B', 'C', 'D'][lastWrongIdx]
                        const wrongReason = activeQuestion.distractors?.[lastWrongIdx]
                        return (
                          <div className="mcq-diag-panel diag-misconception">
                            <div className="mcq-diag-header">
                              <div className="mcq-diag-icon">💡</div>
                              <div>
                                <div className="mcq-diag-title">
                                  Level 1 Hint — Cognitive Divergence Caught
                                </div>
                                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                                  Not quite! Here is a targeted guiding hint to help you work it out:
                                </div>
                              </div>
                            </div>

                            <div className="mcq-hint-card">
                              <span className="mcq-hint-badge">Attempt 1 / 3 • Guiding Nudge</span>
                              <p className="mcq-hint-body">
                                <strong>Why Option {wrongLetter} was a trap:</strong>{' '}
                                {wrongReason || `Triggered belief: ${activeQuestion.misconception}`}
                              </p>
                              <div className="mcq-hint-nudge">
                                <strong>🔍 Socratic Clue:</strong> {getSocraticHint(activeQuestion, lastWrongIdx)}
                              </div>
                              <div className="mcq-hint-action">
                                <span className="mcq-retry-prompt">
                                  <span>👉</span> Pick another option above to test your revised hypothesis!
                                </span>
                                <button
                                  className="mcq-reveal-btn"
                                  onClick={() => setRevealedAnswers((prev) => ({ ...prev, [activeQuestion.id]: true }))}
                                >
                                  I'm Stuck, Reveal Solution
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      }

                      // CASE 3: SECOND WRONG ATTEMPT -> Level 2 Step-by-Step Runtime Memory Trace
                      return (
                        <div className="mcq-diag-panel diag-misconception">
                          <div className="mcq-diag-header">
                            <div className="mcq-diag-icon">🔍</div>
                            <div>
                              <div className="mcq-diag-title">
                                Level 2 Escalation — Deeper Runtime Memory Trace (Attempt 2 / 3)
                              </div>
                              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                                You missed twice. Here is a deeper breakdown of Python memory & execution:
                              </div>
                            </div>
                          </div>

                          <div className="mcq-escalated-banner">
                            <span className="mcq-hint-badge" style={{ background: '#FFE6DF', color: '#B32D15' }}>
                              Attempt 2 / 3 • Scaffolding Breakdown
                            </span>
                            <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#3A1F18' }}>
                              {generateEscalatedClue(activeQuestion, qWrongs)}
                            </p>
                          </div>

                          <div className="mcq-trace-table-wrap">
                            <table className="mcq-trace-table">
                              <thead>
                                <tr>
                                  <th>Execution Phase</th>
                                  <th>Runtime Action</th>
                                  <th>Intuition Trap</th>
                                  <th>Python Reality</th>
                                </tr>
                              </thead>
                              <tbody>
                                {generateStepTrace(activeQuestion, lastWrongIdx).map((row, idx) => (
                                  <tr key={idx}>
                                    <td className="mono">{row.step}</td>
                                    <td>{row.action}</td>
                                    <td><span className="trap">{row.trap}</span></td>
                                    <td><span className="reality">{row.reality}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="mcq-hint-action" style={{ marginTop: 12 }}>
                            <span className="mcq-retry-prompt" style={{ color: 'var(--brand)' }}>
                              <span>👉</span> Inspect the table and select your final option above!
                            </span>
                            <button
                              className="mcq-reveal-btn"
                              onClick={() => setRevealedAnswers((prev) => ({ ...prev, [activeQuestion.id]: true }))}
                            >
                              Reveal Full Solution & Analogy
                            </button>
                          </div>
                        </div>
                      )
                    })()
                  )}

                  {/* Card Navigation Footer */}
                  <div className="mcq-card-footer">
                    <div className="mcq-nav-buttons">
                      <button
                        className="mcq-btn secondary"
                        disabled={currentIndex === 0}
                        onClick={() => {
                          setAdaptiveAlert(null)
                          setCurrentIndex((i) => i - 1)
                          setExplanationTier('pivot')
                        }}
                      >
                        ← Previous
                      </button>
                      <button
                        className="mcq-btn primary"
                        disabled={currentIndex === activeQuestionList.length - 1}
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
                        onClick={() => setCurrentIndex(idx)}
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
