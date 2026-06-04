import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import NewApplication from './pages/NewApplication'
import InProgress from './pages/InProgress'
import TodoApplications from './pages/TodoApplications'
import Analyze from './pages/Analyze'
import ScraperLog from './pages/ScraperLog'
import Notebook from './pages/Notebook'
import Resumes from './pages/Resumes'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewApplication />} />
        <Route path="/in-progress" element={<InProgress />} />
        <Route path="/todo" element={<TodoApplications />} />
        <Route path="/analyze" element={<Analyze />} />
        <Route path="/scraper-log" element={<ScraperLog />} />
        <Route path="/notebook" element={<Notebook />} />
        <Route path="/resumes" element={<Resumes />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
