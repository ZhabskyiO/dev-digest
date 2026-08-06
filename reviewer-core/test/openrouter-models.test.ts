/**
 * OpenRouterProvider.listModels — structured-output capability.
 *
 * Every review is a completeStructured call, so a model without
 * `structured_outputs` is a run that dies at the API. These pin the three-valued
 * mapping the pickers depend on: true / false / null-for-unknown.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

function mockModels(data: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data }) }) as unknown as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

const byId = (models: { id: string }[], id: string) => models.find((m) => m.id === id);

describe('OpenRouterProvider.listModels — supportsStructuredOutput', () => {
  it('is true when the model advertises structured_outputs', async () => {
    mockModels([
      { id: 'deepseek/deepseek-v4-flash', supported_parameters: ['tools', 'structured_outputs'] },
    ]);
    const models = await new OpenRouterProvider('k').listModels();
    expect(byId(models, 'deepseek/deepseek-v4-flash')?.supportsStructuredOutput).toBe(true);
  });

  it('is false when the model reports parameters but not structured_outputs', async () => {
    mockModels([{ id: 'anthropic/claude-3-haiku', supported_parameters: ['tools', 'temperature'] }]);
    const models = await new OpenRouterProvider('k').listModels();
    expect(byId(models, 'anthropic/claude-3-haiku')?.supportsStructuredOutput).toBe(false);
  });

  it('is null — not false — when the field is absent entirely', async () => {
    // Guards the whole-catalogue-disappears failure: if OpenRouter ever drops
    // the field, "unknown" must keep models visible rather than hide them all.
    mockModels([{ id: 'some/model' }]);
    const models = await new OpenRouterProvider('k').listModels();
    expect(byId(models, 'some/model')?.supportsStructuredOutput).toBeNull();
  });

  it('still parses pricing and context alongside the capability', async () => {
    mockModels([
      {
        id: 'z-ai/glm-4.7-flash',
        name: 'GLM 4.7 Flash',
        context_length: 128000,
        pricing: { prompt: '0.0000001', completion: '0.0000004' },
        supported_parameters: ['structured_outputs'],
      },
    ]);
    const [model] = await new OpenRouterProvider('k').listModels();
    expect(model).toMatchObject({
      id: 'z-ai/glm-4.7-flash',
      label: 'GLM 4.7 Flash',
      contextLength: 128000,
      supportsStructuredOutput: true,
    });
    expect(model?.pricing?.completionPerM).toBeCloseTo(0.4);
  });
});
