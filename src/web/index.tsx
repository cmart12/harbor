import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentListAllItem, AgentPersona } from '../shared/ipc-contract';
import type { Space } from '../shared/types';
import { WebRemoteClient } from './lib/client';
import type { WebRemoteEvent } from '../main/web/event-hub';

const TOKEN_KEY = 'whim.webRemoteToken';

type Tab = 'capture' | 'spaces' | 'workers' | 'chat' | 'deploy';

function App() {
  const urlToken = new URLSearchParams(window.location.search).get('token');
  const [token, setToken] = useState(() => urlToken || localStorage.getItem(TOKEN_KEY) || '');

  useEffect(() => {
    if (urlToken) {
      localStorage.setItem(TOKEN_KEY, urlToken);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [urlToken]);

  if (!token) {
    return <Login onLogin={(next) => {
      localStorage.setItem(TOKEN_KEY, next);
      setToken(next);
    }} />;
  }

  return <RemoteApp token={token} onLogout={() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
  }} />;
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <main className="login">
      <div className="brand">whim</div>
      <h1>Remote web access</h1>
      <p>Enter the token from the desktop app settings, or scan the QR code from your phone.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onLogin(value.trim());
      }}>
        <input value={value} onChange={event => setValue(event.target.value)} placeholder="Token" autoFocus />
        <button type="submit">Connect</button>
      </form>
    </main>
  );
}

function RemoteApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  const client = useMemo(() => new WebRemoteClient(token), [token]);
  const [tab, setTab] = useState<Tab>('capture');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [agents, setAgents] = useState<AgentListAllItem[]>([]);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = agents.find(agent => agent.agentId === selectedAgentId) ?? agents[0] ?? null;

  async function refreshSpaces() {
    setSpaces(await client.invoke('space:list'));
  }

  async function refreshAgents() {
    const next = await client.invoke('agent:list-all');
    setAgents(next);
    if (!selectedAgentId && next[0]) setSelectedAgentId(next[0].agentId);
  }

  async function refreshStaticData() {
    const [nextPersonas, nextModels] = await Promise.all([
      client.invoke('personas:list'),
      client.invoke('models:list'),
    ]);
    setPersonas(nextPersonas);
    setModels(nextModels);
  }

  async function refreshAll() {
    try {
      setError(null);
      await Promise.all([refreshSpaces(), refreshAgents(), refreshStaticData()]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load remote data');
    }
  }

  useEffect(() => {
    void refreshAll();
    return client.connect((event) => {
      handleRemoteEvent(event, selectedAgentId, setHistory);
      if (event.channel.startsWith('agent:')) void refreshAgents();
      if (event.channel.startsWith('space:')) void refreshSpaces();
    }, setStatus);
  }, [client, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgent) return;
    client.invoke('agent:get-history', selectedAgent.agentId)
      .then((result: any) => setHistory(Array.isArray(result.events) ? result.events : []))
      .catch((err: any) => setError(err?.message || 'Failed to load chat history'));
  }, [client, selectedAgent?.agentId]);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand">whim</div>
          <div className="connection">{status}</div>
        </div>
        <button className="ghost" onClick={onLogout}>Log out</button>
      </header>

      {error && <div className="banner">{error}</div>}

      <nav className="tabs" aria-label="Remote sections">
        {(['capture', 'spaces', 'workers', 'chat', 'deploy'] as Tab[]).map(name => (
          <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      <section className="panel">
        {tab === 'capture' && <Capture client={client} onCreated={refreshSpaces} />}
        {tab === 'spaces' && <Spaces client={client} spaces={spaces} onRefresh={refreshSpaces} />}
        {tab === 'workers' && (
          <Workers
            client={client}
            agents={agents}
            selectedAgentId={selectedAgent?.agentId ?? null}
            onSelect={(agentId) => { setSelectedAgentId(agentId); setTab('chat'); }}
            onRefresh={refreshAgents}
          />
        )}
        {tab === 'chat' && selectedAgent && (
          <Chat
            client={client}
            agent={selectedAgent}
            history={history}
            onRefresh={async () => {
              await refreshAgents();
              const result = await client.invoke('agent:get-history', selectedAgent.agentId) as any;
              setHistory(Array.isArray(result.events) ? result.events : []);
            }}
          />
        )}
        {tab === 'chat' && !selectedAgent && <Empty title="No workers yet" detail="Deploy an agent or open a worker to chat." />}
        {tab === 'deploy' && <Deploy client={client} personas={personas} models={models} onDeploy={refreshAgents} />}
      </section>
    </div>
  );
}

function Capture({ client, onCreated }: { client: WebRemoteClient; onCreated: () => Promise<void> }) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <form className="stack" onSubmit={async (event) => {
      event.preventDefault();
      const text = body.trim();
      if (!text) return;
      setSaving(true);
      try {
        await client.invoke('space:create', { body: text });
        setBody('');
        await onCreated();
      } finally {
        setSaving(false);
      }
    }}>
      <h1>Capture</h1>
      <textarea value={body} onChange={event => setBody(event.target.value)} placeholder="What needs to get done?" rows={7} />
      <button disabled={saving || !body.trim()}>{saving ? 'Capturing…' : 'Capture intent'}</button>
    </form>
  );
}

function Spaces({ client, spaces, onRefresh }: { client: WebRemoteClient; spaces: Space[]; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Space[] | null>(null);
  const list = results ?? spaces;

  async function search(next: string) {
    setQuery(next);
    if (!next.trim()) {
      setResults(null);
      return;
    }
    setResults(await client.invoke('space:search', next.trim()));
  }

  return (
    <div className="stack">
      <div className="section-title">
        <h1>Spaces</h1>
        <button className="ghost" onClick={() => void onRefresh()}>Refresh</button>
      </div>
      <input value={query} onChange={event => void search(event.target.value)} placeholder="Search spaces" />
      {list.length === 0 && <Empty title="No spaces" detail="Capture an intent to get started." />}
      {list.map(space => (
        <article className="card" key={space.id}>
          <div className="card-title">{space.description || space.body || 'Untitled'}</div>
          <div className="meta">
            <span>{space.status}</span>
            {space.client && <span>{space.client}</span>}
            {space.due_at && <span>{space.due_at}</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

function Workers(props: {
  client: WebRemoteClient;
  agents: AgentListAllItem[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { client, agents, selectedAgentId, onSelect, onRefresh } = props;
  return (
    <div className="stack">
      <div className="section-title">
        <h1>Workers</h1>
        <button className="ghost" onClick={() => void onRefresh()}>Refresh</button>
      </div>
      {agents.length === 0 && <Empty title="No workers" detail="Deploy an agent from the Deploy tab." />}
      {agents.map(agent => (
        <article className={`card worker ${selectedAgentId === agent.agentId ? 'selected' : ''}`} key={agent.agentId}>
          <button className="card-main" onClick={() => onSelect(agent.agentId)}>
            <span className={`status-dot ${agent.status}`}></span>
            <span>
              <span className="card-title">{agent.summary || agent.selectedText || agent.agentId}</span>
              <span className="meta">
                <span>{agent.status}</span>
                {agent.personaHandle && <span>@{agent.personaHandle}</span>}
                <span>{agent.source}</span>
              </span>
            </span>
          </button>
          {agent.pendingApprovalId && (
            <div className="actions">
              <span>{agent.pendingPermissionKind || 'Approval needed'}</span>
              <button onClick={() => approve(client, agent, true, onRefresh)}>Approve</button>
              <button className="danger" onClick={() => approve(client, agent, false, onRefresh)}>Deny</button>
            </div>
          )}
          <div className="actions">
            <button className="ghost" onClick={() => void client.invoke('agent:abort', agent.agentId).then(onRefresh)}>Abort</button>
            <button className="ghost danger" onClick={() => void client.invoke('agent:delete-session', agent.agentId).then(onRefresh)}>Delete</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Chat(props: {
  client: WebRemoteClient;
  agent: AgentListAllItem;
  history: unknown[];
  onRefresh: () => Promise<void>;
}) {
  const { client, agent, history, onRefresh } = props;
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  return (
    <div className="chat">
      <div className="section-title">
        <h1>Chat</h1>
        <button className="ghost" onClick={() => void onRefresh()}>Refresh</button>
      </div>
      <div className="chat-agent">
        <strong>{agent.summary || agent.selectedText || agent.agentId}</strong>
        <span>{agent.status}</span>
      </div>
      {agent.pendingApprovalId && (
        <div className="approval">
          <div>{agent.pendingIntention || agent.pendingPermissionKind || 'Approval needed'}</div>
          {agent.pendingPath && <code>{agent.pendingPath}</code>}
          <div className="actions">
            <button onClick={() => approve(client, agent, true, onRefresh)}>Approve</button>
            <button className="danger" onClick={() => approve(client, agent, false, onRefresh)}>Deny</button>
          </div>
        </div>
      )}
      <div className="messages">
        {history.length === 0 && <Empty title="No chat history" detail="Send a message to continue the session." />}
        {history.map((event, index) => <Message key={index} event={event} />)}
      </div>
      <form className="composer" onSubmit={async (event) => {
        event.preventDefault();
        if (!message.trim()) return;
        setSending(true);
        try {
          await client.invoke('chat:send-message', agent.agentId, message.trim());
          setMessage('');
          await onRefresh();
        } finally {
          setSending(false);
        }
      }}>
        <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Message this agent" rows={3} />
        <button disabled={sending || !message.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
    </div>
  );
}

function Deploy({ client, personas, models, onDeploy }: {
  client: WebRemoteClient;
  personas: AgentPersona[];
  models: Array<{ id: string; name: string }>;
  onDeploy: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState('');
  const [persona, setPersona] = useState('');
  const [launching, setLaunching] = useState(false);

  return (
    <form className="stack" onSubmit={async (event) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      setLaunching(true);
      try {
        await client.invoke('agent:quick-launch', prompt.trim(), persona || undefined);
        setPrompt('');
        await onDeploy();
      } finally {
        setLaunching(false);
      }
    }}>
      <h1>Deploy agent</h1>
      <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="What should the agent do?" rows={7} />
      <select value={persona} onChange={event => setPersona(event.target.value)}>
        <option value="">Default agent</option>
        {personas.map(p => (
          <option key={p.id} value={p.handle}>@{p.handle} ({p.runLocation})</option>
        ))}
      </select>
      {models.length > 0 && <div className="meta">{models.length} models available from desktop settings.</div>}
      <button disabled={launching || !prompt.trim()}>{launching ? 'Deploying…' : 'Deploy'}</button>
    </form>
  );
}

function Message({ event }: { event: unknown }) {
  const item = event as any;
  const type = item?.type || item?.event_type || 'event';
  const content = item?.content || item?.message || item?.delta || item?.summary || item?.payload || item;
  return (
    <div className="message">
      <div className="message-type">{String(type)}</div>
      <pre>{typeof content === 'string' ? content : JSON.stringify(content, null, 2)}</pre>
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function handleRemoteEvent(
  event: WebRemoteEvent,
  selectedAgentId: string | null,
  setHistory: React.Dispatch<React.SetStateAction<unknown[]>>,
): void {
  if (event.channel === 'chat:event') {
    const payload = event.payload as { agentId?: string };
    if (!selectedAgentId || payload.agentId === selectedAgentId) {
      setHistory(history => [...history, event.payload]);
    }
  }
}

async function approve(
  client: WebRemoteClient,
  agent: AgentListAllItem,
  approved: boolean,
  onRefresh: () => Promise<void>,
): Promise<void> {
  if (!agent.pendingApprovalId) return;
  await client.invoke('agent:approve', agent.agentId, agent.pendingApprovalId, approved);
  await onRefresh();
}

createRoot(document.getElementById('root')!).render(<App />);
