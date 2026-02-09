import { Route } from '@solidjs/router';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Community from './pages/Community';
import Settings from './pages/Settings';
import SharedFile from './pages/SharedFile';
import ApiKeys from './pages/ApiKeys';

export default function App() {
  return (
    <>
      <Route path="/" component={Login} />
      <Route path="/setup" component={Setup} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/files" component={Files} />
      <Route path="/community" component={Community} />
      <Route path="/settings" component={Settings} />
      <Route path="/api" component={ApiKeys} />
      <Route path="/s/:share_id" component={SharedFile} />
    </>
  );
}
