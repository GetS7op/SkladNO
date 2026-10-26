import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, isNetworkError, parseResponse, toApiError, withQuery } from './client';

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('toApiError', () => {
  it('keeps the server error code and message', async () => {
    const error = await toApiError(response(409, { error: 'conflict', message: 'Полка заполнена' }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'conflict', message: 'Полка заполнена' });
  });

  it('uses a stable fallback for malformed errors', async () => {
    const error = await toApiError(response(502));
    expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR', message: 'Ошибка сервера (502)' });
  });

  it('explains too large uploads', async () => {
    expect((await toApiError(response(413))).message).toBe('Файл слишком большой');
  });
});

describe('parseResponse', () => {
  const schema = z.object({ id: z.string() });

  it('returns typed data that matches the schema', () => {
    expect(parseResponse(schema, { id: 'a' }, '/x')).toEqual({ id: 'a' });
  });

  it('rejects unexpected server data', () => {
    expect(() => parseResponse(schema, { id: 1 }, '/x')).toThrowError(ApiError);
  });
});

describe('withQuery', () => {
  it('drops empty parameters', () => {
    expect(withQuery('/devices', { q: '', archived: false, page: undefined })).toBe('/devices');
    expect(withQuery('/devices', { q: 'S21+', archived: true })).toBe('/devices?q=S21%2B&archived=true');
  });
});

describe('isNetworkError', () => {
  it('distinguishes lost connection from server answers', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new ApiError(422, 'validation', 'bad'))).toBe(false);
  });
});
