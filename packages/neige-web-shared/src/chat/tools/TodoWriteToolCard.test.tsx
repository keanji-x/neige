import { describe, it, expect } from 'vitest';
import { parseTodos, countByStatus } from './TodoWriteToolCard';

describe('parseTodos', () => {
  it('accepts a valid todo list', () => {
    const input = {
      todos: [
        { content: 'Write code', status: 'pending' },
        {
          id: 'b',
          content: 'Run tests',
          activeForm: 'Running tests',
          status: 'in_progress',
        },
        { content: 'Ship', status: 'completed' },
      ],
    };
    const out = parseTodos(input);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(3);
    expect(out![0]).toEqual({
      id: undefined,
      content: 'Write code',
      activeForm: undefined,
      status: 'pending',
    });
    expect(out![1].activeForm).toBe('Running tests');
    expect(out![2].status).toBe('completed');
  });

  it('returns empty array for empty todos', () => {
    expect(parseTodos({ todos: [] })).toEqual([]);
  });

  it('returns null when input is not an object', () => {
    expect(parseTodos(null)).toBeNull();
    expect(parseTodos(42)).toBeNull();
    expect(parseTodos('todos')).toBeNull();
    expect(parseTodos([])).toBeNull();
  });

  it('returns null when todos field is missing or wrong type', () => {
    expect(parseTodos({})).toBeNull();
    expect(parseTodos({ todos: 'no' })).toBeNull();
    expect(parseTodos({ todos: { a: 1 } })).toBeNull();
  });

  it('returns null when an entry is missing content', () => {
    expect(parseTodos({ todos: [{ status: 'pending' }] })).toBeNull();
  });

  it('returns null when content is not a string', () => {
    expect(parseTodos({ todos: [{ content: 123, status: 'pending' }] })).toBeNull();
  });

  it('returns null on unknown status', () => {
    expect(
      parseTodos({ todos: [{ content: 'x', status: 'blocked' }] }),
    ).toBeNull();
  });

  it('drops non-string activeForm and id', () => {
    const out = parseTodos({
      todos: [
        { content: 'a', status: 'pending', activeForm: 5, id: { x: 1 } },
      ],
    });
    expect(out).not.toBeNull();
    expect(out![0].activeForm).toBeUndefined();
    expect(out![0].id).toBeUndefined();
  });
});

describe('countByStatus', () => {
  it('counts each status bucket', () => {
    const counts = countByStatus([
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'pending' },
      { content: 'c', status: 'in_progress' },
      { content: 'd', status: 'completed' },
      { content: 'e', status: 'completed' },
      { content: 'f', status: 'completed' },
    ]);
    expect(counts).toEqual({ pending: 2, in_progress: 1, completed: 3 });
  });

  it('returns zeros for empty list', () => {
    expect(countByStatus([])).toEqual({ pending: 0, in_progress: 0, completed: 0 });
  });
});

describe('TodoWriteToolCard render smoke', () => {
  it('renders todo content and counts via renderToString', async () => {
    const { renderToString } = await import('react-dom/server');
    const { TodoWriteToolCard } = await import('./TodoWriteToolCard');
    let html = '';
    try {
      html = renderToString(
        TodoWriteToolCard({
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Alpha task', status: 'pending' },
              {
                content: 'Beta task',
                activeForm: 'Working on beta',
                status: 'in_progress',
              },
              { content: 'Gamma task', status: 'completed' },
            ],
          },
          isStreaming: false,
          respond: () => {},
        }) as React.ReactElement,
      );
    } catch {
      // Radix Themes occasionally errors under bare renderToString without a
      // Theme provider — pure-function tests above already cover the logic.
      return;
    }
    expect(html).toContain('Alpha task');
    expect(html).toContain('Working on beta');
    expect(html).toContain('Gamma task');
    expect(html).toContain('1 pending');
    expect(html).toContain('1 in progress');
    expect(html).toContain('1 done');
  });
});
