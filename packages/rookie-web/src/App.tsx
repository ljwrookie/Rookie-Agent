import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Conversations } from "./pages/Conversations";
import { Memory } from "./pages/Memory";
import { Skills } from "./pages/Skills";
import { Models } from "./pages/Models";
import { Gateway } from "./pages/Gateway";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/models" element={<Models />} />
        <Route path="/gateway" element={<Gateway />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

export default App;
