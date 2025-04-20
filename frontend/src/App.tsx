import { useState } from 'react'
import './App.css'
import Broadcaster from './pages/Broadcaster'
import Listener from './pages/Listener'

function App() {
  const [activePage, setActivePage] = useState<'broadcaster' | 'listener'>('broadcaster')

  return (
    <div className="megaphone-app">
      <header>
        <h1>MEGAPhone</h1>
        <p>On-Chain Voice Broadcasting powered by MegaETH</p>
        
        <nav>
          <button 
            className={activePage === 'broadcaster' ? 'active' : ''}
            onClick={() => setActivePage('broadcaster')}
          >
            Broadcaster
          </button>
          <button 
            className={activePage === 'listener' ? 'active' : ''}
            onClick={() => setActivePage('listener')}
          >
            Listener
          </button>
        </nav>
      </header>

      <main>
        {activePage === 'broadcaster' ? <Broadcaster /> : <Listener />}
      </main>

      <footer>
        <p>MEGAPhone v0 - Fully On-Chain Voice Broadcasting Demo</p>
      </footer>
    </div>
  )
}

export default App
