'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Suspense } from 'react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      const from = searchParams.get('from') || '/admin/campaigns'
      router.push(from)
    } else {
      setError('Invalid password. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#080C12] flex items-center justify-center p-4">
      {/* Ambient glows */}
      <div className="fixed top-0 left-0 w-[500px] h-[400px] bg-blue-600/[0.04] rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-[400px] h-[300px] bg-violet-600/[0.04] rounded-full blur-[120px] pointer-events-none" />

      {/* Dot grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(100,120,200,0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative w-full max-w-sm"
      >
        {/* Card */}
        <div className="relative rounded-2xl border border-white/[0.08] bg-gray-950/80 backdrop-blur-xl p-8">
          {/* Brand */}
          <div className="flex items-center gap-3 mb-8">
            <div className="relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600" />
              <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-blue-500/40 to-violet-600/40 blur-sm" />
              <svg className="relative w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-tight">XtraMiles</p>
              <p className="text-gray-500 text-xs">Email Campaigns</p>
            </div>
          </div>

          <h1 className="text-white text-xl font-semibold mb-1">Sign in</h1>
          <p className="text-gray-500 text-sm mb-6">Enter your admin password to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3
                           text-white placeholder-gray-600 text-sm
                           focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.06]
                           transition-all duration-150"
              />
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-xs"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white
                         bg-gradient-to-r from-blue-600 to-violet-600
                         hover:from-blue-500 hover:to-violet-500
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all duration-150 shadow-lg shadow-blue-600/20"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
