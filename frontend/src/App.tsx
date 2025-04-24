import { useState } from 'react'
import './App.css'
import Broadcaster from './pages/Broadcaster'
import Listener from './pages/Listener'

function App() {
  const [activePage, setActivePage] = useState<'broadcaster' | 'listener'>('broadcaster')

  return (
    <div className="megaphone-app">
      <div className="mode-toggle">
        <button 
          className={activePage === 'broadcaster' ? 'active' : ''}
          onClick={() => setActivePage('broadcaster')}
        >
          Broadcast
        </button>
        <button 
          className={activePage === 'listener' ? 'active' : ''}
          onClick={() => setActivePage('listener')}
        >
          Listen
        </button>
      </div>

      <main>
        {activePage === 'broadcaster' ? <Broadcaster /> : <Listener />}
      </main>
    </div>
  )
}

export default App