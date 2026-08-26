import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Script the SDK so each messages.create pops the next canned response and
// records the request it was given.
const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: createMock };
  },
}));

const { AnthropicProvider } = await import('../src/adapters/llm/anthropic.js');

const Verdict = z.object({
  verdict: z.enum(['approve', 'request_changes']),
  score: z.number().int().min(0).max(100),
});

function toolUseResponse(id: string, input: unknown) {
  return {
    content: [{ type: 'tool_use', id, name: 'Verdict', input }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('AnthropicProvider.completeStructured reprompt', () => {
  beforeEach(() => createMock.mockReset());

  it('answers a failed tool_use with a tool_result block, not plain text', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('toolu_bad', { verdict: 'nonsense', score: 90 }))
      .mockResolvedValueOnce(toolUseResponse('toolu_ok', { verdict: 'approve', score: 90 }));

    const provider = new AnthropicProvider('test-key');
    const result = await provider.completeStructured({
      model: 'claude-haiku-4-5-20251001',
      schema: Verdict,
      schemaName: 'Verdict',
      messages: [{ role: 'user', content: 'review this' }],
    });

    expect(result.data).toEqual({ verdict: 'approve', score: 90 });
    expect(result.attempts).toBe(2);
    expect(createMock).toHaveBeenCalledTimes(2);

    // Strict tool use is on, and numeric bounds (which strict mode rejects)
    // are stripped from the schema actually sent to the API.
    const toolDef = createMock.mock.calls[0]![0].tools[0];
    expect(toolDef.strict).toBe(true);
    expect(JSON.stringify(toolDef.input_schema)).not.toContain('"minimum"');

    // The retry request must close the tool_use → tool_result pair the API
    // enforces; a plain-text user turn here is a guaranteed 400.
    const retryMessages = createMock.mock.calls[1]![0].messages;
    const lastUser = retryMessages[retryMessages.length - 1];
    expect(lastUser.role).toBe('user');
    expect(Array.isArray(lastUser.content)).toBe(true);
    expect(lastUser.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_bad',
      is_error: true,
    });
  });

  it('falls back to a plain text reprompt when no tool_use block came back', async () => {
    createMock
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'I refuse to use the tool' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce(toolUseResponse('toolu_ok', { verdict: 'approve', score: 90 }));

    const provider = new AnthropicProvider('test-key');
    const result = await provider.completeStructured({
      model: 'claude-haiku-4-5-20251001',
      schema: Verdict,
      schemaName: 'Verdict',
      messages: [{ role: 'user', content: 'review this' }],
    });

    expect(result.data).toEqual({ verdict: 'approve', score: 90 });
    const retryMessages = createMock.mock.calls[1]![0].messages;
    const lastUser = retryMessages[retryMessages.length - 1];
    expect(typeof lastUser.content).toBe('string');
  });
});
