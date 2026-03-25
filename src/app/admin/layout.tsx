import Sidebar from '@/components/Sidebar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen bg-[#080C12]">

      {/* Subtle dot grid background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.15] z-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(100,120,200,0.35) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Ambient top-left glow */}
      <div className="fixed top-0 left-0 w-[500px] h-[400px] bg-blue-600/[0.04] rounded-full blur-[140px] pointer-events-none z-0" />
      {/* Ambient bottom-right glow */}
      <div className="fixed bottom-0 right-0 w-[400px] h-[300px] bg-violet-600/[0.04] rounded-full blur-[120px] pointer-events-none z-0" />

      <Sidebar />
      <main className="relative flex-1 ml-56 p-10 overflow-auto z-10">
        {children}
      </main>
    </div>
  )
}
