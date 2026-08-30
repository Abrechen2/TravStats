import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../index';
import { prisma } from '../db';
import { clearAvailabilityCache } from '../services/parsers/config';

/**
 * What the screen says about the parser has to match what the parser does.
 *
 * Forgejo #12: the MSG import screen showed "Kein LLM-Parser verfuegbar" and
 * listed Ollama, OpenAI and Claude as unavailable — and the very next request
 * came back labelled `ollama` with 85% confidence, with the server log
 * agreeing with the parser. A user cannot tell from that whether AI parsing
 * ran, so they cannot judge how far to trust the result.
 *
 * The cause was two answers to one question. `/parser-capabilities` read
 * `admin_settings` alone, while `getParserConfig` — the thing that actually
 * decides — also falls back to OLLAMA_URL and OLLAMA_MODEL from the
 * environment. On an instance configured through env, which is how the test VM
 * installer does it, the two disagreed by construction.
 *
 * The env case is the one that was broken, so it is the one asserted first.
 */
describe('GET /parser-capabilities', () => {
  const savedUrl = process.env.OLLAMA_URL;
  const savedModel = process.env.OLLAMA_MODEL;

  async function clearAdminOllama(): Promise<void> {
    await prisma.adminSettings.updateMany({ data: { ollamaUrl: null, ollamaModel: null } });
  }

  beforeEach(() => {
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_MODEL;
    clearAvailabilityCache();
  });

  afterAll(() => {
    if (savedUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = savedUrl;
    if (savedModel === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = savedModel;
  });

  it('reports an LLM that is configured through the environment', async () => {
    await clearAdminOllama();
    process.env.OLLAMA_URL = 'http://192.0.2.10:11434';
    process.env.OLLAMA_MODEL = 'gemma3:12b';

    const res = await request(app).get('/api/v1/parser-capabilities').expect(200);
    expect(res.body.hasLlm).toBe(true);
  });

  it('reports none when neither the admin settings nor the environment name one', async () => {
    await clearAdminOllama();

    const res = await request(app).get('/api/v1/parser-capabilities').expect(200);
    expect(res.body.hasLlm).toBe(false);
  });

  it('needs both halves — a URL without a model is not a working parser', async () => {
    await clearAdminOllama();
    process.env.OLLAMA_URL = 'http://192.0.2.10:11434';

    const res = await request(app).get('/api/v1/parser-capabilities').expect(200);
    expect(res.body.hasLlm).toBe(false);
  });
});
