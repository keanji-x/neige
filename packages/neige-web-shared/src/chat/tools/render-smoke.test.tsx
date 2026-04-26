// Render-smoke test for every tool card. Catches runtime errors that parser
// unit tests miss (e.g. JSX typos, dangling refs, Radix prop mismatches).
//
// Uses react-dom/server's renderToString so we don't depend on
// @testing-library/react. If renderToString trips on a Radix internal that
// expects a real DOM, the assertion still catches the throw — we don't
// inspect the markup beyond "did not crash and produced something."

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Theme } from '@radix-ui/themes';
import { TodoWriteToolCard } from './TodoWriteToolCard';
import { BashToolCard } from './BashToolCard';
import { EditToolCard } from './EditToolCard';
import { WriteToolCard } from './WriteToolCard';
import { ReadToolCard } from './ReadToolCard';
import { GrepToolCard } from './GrepToolCard';
import { GlobToolCard } from './GlobToolCard';
import { TaskToolCard } from './TaskToolCard';
import type { ToolRendererProps } from './registry';

function render(node: React.ReactElement): string {
  return renderToString(<Theme>{node}</Theme>);
}

const baseProps: Omit<ToolRendererProps, 'input' | 'name'> = {
  isStreaming: false,
  result: undefined,
  respond: () => {},
};

describe('tool card render smoke', () => {
  it('TodoWriteToolCard renders mixed-status list', () => {
    const out = render(
      <TodoWriteToolCard
        {...baseProps}
        name="TodoWrite"
        input={{
          todos: [
            { content: 'task A', status: 'pending' },
            { content: 'task B', activeForm: 'doing B', status: 'in_progress' },
            { content: 'task C', status: 'completed' },
          ],
        }}
      />,
    );
    expect(out).toContain('task A');
    expect(out).toContain('doing B');
    expect(out).toContain('task C');
  });

  it('BashToolCard renders command + output', () => {
    const out = render(
      <BashToolCard
        {...baseProps}
        name="Bash"
        input={{ command: 'echo hi', description: 'greet' }}
        result={{ content: 'hi\n', isError: false }}
      />,
    );
    expect(out).toContain('echo hi');
    expect(out).toContain('hi');
  });

  it('EditToolCard renders before/after blocks', () => {
    const out = render(
      <EditToolCard
        {...baseProps}
        name="Edit"
        input={{
          file_path: '/tmp/a.ts',
          old_string: 'old line',
          new_string: 'new line',
        }}
      />,
    );
    expect(out).toContain('old line');
    expect(out).toContain('new line');
    expect(out).toContain('a.ts');
  });

  it('WriteToolCard renders content preview', () => {
    const out = render(
      <WriteToolCard
        {...baseProps}
        name="Write"
        input={{ file_path: '/tmp/b.ts', content: 'hello\nworld\n' }}
      />,
    );
    expect(out).toContain('b.ts');
    expect(out).toContain('hello');
  });

  it('ReadToolCard renders file path + range', () => {
    const out = render(
      <ReadToolCard
        {...baseProps}
        name="Read"
        input={{ file_path: '/tmp/c.ts', offset: 10, limit: 20 }}
        result={{ content: '    10\thello\n    11\tworld', isError: false }}
      />,
    );
    expect(out).toContain('c.ts');
    expect(out).toContain('hello');
  });

  it('GrepToolCard renders pattern + matches', () => {
    const out = render(
      <GrepToolCard
        {...baseProps}
        name="Grep"
        input={{ pattern: 'foo', path: '/src', '-i': true }}
        result={{ content: '/src/a.ts:1:foo\n/src/b.ts:5:foo', isError: false }}
      />,
    );
    expect(out).toContain('foo');
    expect(out).toContain('/src');
  });

  it('GlobToolCard renders pattern + path list', () => {
    const out = render(
      <GlobToolCard
        {...baseProps}
        name="Glob"
        input={{ pattern: '**/*.ts', path: '/src' }}
        result={{ content: '/src/a.ts\n/src/b.ts\n/src/c.ts', isError: false }}
      />,
    );
    expect(out).toContain('**/*.ts');
    expect(out).toContain('a.ts');
  });

  it('TaskToolCard renders agent type chip + description', () => {
    const out = render(
      <TaskToolCard
        {...baseProps}
        name="Task"
        input={{
          description: 'survey deps',
          prompt: 'enumerate every direct dep',
          subagent_type: 'general-purpose',
        }}
      />,
    );
    expect(out).toContain('survey deps');
    expect(out).toContain('general-purpose');
  });
});
