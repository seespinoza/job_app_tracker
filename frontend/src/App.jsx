import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home            from './pages/Home'
import InProgress      from './pages/InProgress'
import NewApplication  from './pages/NewApplication'
import TodoApplications from './pages/TodoApplications'
import Analyze         from './pages/Analyze'
import ScraperLog      from './pages/ScraperLog'
import Notebook        from './pages/Notebook'
import Resumes         from './pages/Resumes'
import JobDiscovery    from './pages/JobDiscovery'

const ROUTES = [
  { path: '/',            component: Home },
  { path: '/in-progress', component: InProgress },
  { path: '/new',         component: NewApplication },
  { path: '/todo',        component: TodoApplications },
  { path: '/discovery',   component: JobDiscovery },
  { path: '/analyze',     component: Analyze },
  { path: '/scraper-log', component: ScraperLog },
  { path: '/notebook',    component: Notebook },
  { path: '/resumes',     component: Resumes },
]

export default function App() {
  return (
    <Layout>
      <Routes>
        {ROUTES.map(({ path, component: C }) => <Route key={path} path={path} element={<C />} />)}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
