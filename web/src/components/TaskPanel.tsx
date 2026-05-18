import { useState } from 'react';
import type { ConvInfo } from '../types';
import type { Task } from '../hooks/useConfig';

export type { Task };

interface TaskPanelProps {
  tasks: Task[];
  conversations: ConvInfo[];
  onUpdate: (tasks: Task[]) => void;
  onJump: (convId: string) => void;
}

function newId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function TaskPanel({ tasks, conversations, onUpdate, onJump }: TaskPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [bindingTaskId, setBindingTaskId] = useState<string | null>(null);

  const addTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    const task: Task = {
      id: newId(),
      title,
      created_at: new Date().toISOString(),
    };
    onUpdate([task, ...tasks]);
    setNewTitle('');
  };

  const removeTask = (id: string) => {
    onUpdate(tasks.filter((t) => t.id !== id));
  };

  const bindTask = (taskId: string, convId: string | undefined) => {
    onUpdate(
      tasks.map((t) =>
        t.id === taskId ? { ...t, bound_conv_id: convId || undefined } : t,
      ),
    );
    setBindingTaskId(null);
  };

  const handleTaskClick = (task: Task) => {
    if (task.bound_conv_id && conversations.some((c) => c.id === task.bound_conv_id)) {
      onJump(task.bound_conv_id);
    } else {
      // No binding (or stale) — open the binding picker
      setBindingTaskId(bindingTaskId === task.id ? null : task.id);
    }
  };

  return (
    <div className="sidebar-footer">
      <button
        className="sidebar-footer-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="sidebar-footer-label">Tasks ({tasks.length})</span>
        <span className="sidebar-footer-arrow">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="task-panel">
          <div className="task-add">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New task..."
              className="port-forward-input"
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
            />
            <button className="port-add-btn" onClick={addTask} title="Add task">+</button>
          </div>

          <div className="task-list">
            {tasks.map((t) => {
              const bound = t.bound_conv_id
                ? conversations.find((c) => c.id === t.bound_conv_id)
                : null;
              const stale = t.bound_conv_id && !bound;
              const isBinding = bindingTaskId === t.id;
              return (
                <div key={t.id} className="task-row-wrapper">
                  <div
                    className={`task-row ${bound ? 'has-binding' : ''} ${stale ? 'stale' : ''}`}
                    onClick={() => handleTaskClick(t)}
                    title={
                      bound
                        ? `Jump to: ${bound.title}`
                        : stale
                          ? 'Bound terminal was removed — click to rebind'
                          : 'Click to bind a terminal'
                    }
                  >
                    <span className="task-dot" />
                    <span className="task-title">{t.title}</span>
                    {bound && (
                      <span className="task-binding-label">↪ {bound.title}</span>
                    )}
                    {stale && <span className="task-binding-label stale">unbound</span>}
                    {!bound && !stale && (
                      <span className="task-binding-label muted">— bind</span>
                    )}
                    <button
                      className="task-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTask(t.id);
                      }}
                      title="Remove task"
                    >
                      ×
                    </button>
                  </div>
                  {isBinding && (
                    <div className="task-binding-picker">
                      <select
                        autoFocus
                        className="port-forward-input"
                        value={t.bound_conv_id || ''}
                        onChange={(e) => bindTask(t.id, e.target.value)}
                        onBlur={() => setBindingTaskId(null)}
                      >
                        <option value="">— Select terminal —</option>
                        {conversations.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
            {tasks.length === 0 && (
              <div className="task-empty">No tasks. Add one above.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
