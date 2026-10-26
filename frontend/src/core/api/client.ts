import { z } from 'zod';

/** Ответ сервера с ошибкой: `{ error: "<код>", message: "<текст для человека>" }`. */
const errorEnvelopeSchema = z.object({
  error: z.string(),
  message: z.string(),
});

/** Сессия истекла или пользователя отключили — AuthProvider сбрасывает сессию. */
export const AUTH_UNAUTHORIZED_EVENT = 'app:unauthorized';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Ошибка сети (нет связи), а не ответ сервера. */
export function isNetworkError(error: unknown) {
  return !(error instanceof ApiError);
}

const API_PREFIX = '/api/v1';

export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // ответ без JSON — останется общее сообщение
  }
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (parsed.success) {
    return new ApiError(response.status, parsed.data.error, parsed.data.message);
  }
  const message = response.status === 413 ? 'Файл слишком большой' : `Ошибка сервера (${response.status})`;
  return new ApiError(response.status, 'HTTP_ERROR', message);
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'include',
    ...init,
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    throw await toApiError(response);
  }
  return response;
}

/** Разбирает ответ схемой: расхождение с сервером видно сразу, а не где-то в разметке. */
export function parseResponse<T>(schema: z.ZodType<T>, data: unknown, path: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`Неожиданный ответ ${path}`, parsed.error.issues);
    throw new ApiError(0, 'BAD_RESPONSE', 'Сервер вернул неожиданные данные — обновите страницу');
  }
  return parsed.data;
}

async function json<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  const data: unknown = response.status === 204 ? null : await response.json();
  return parseResponse(schema, data, path);
}

const jsonBody = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export function apiGet<T>(path: string, schema: z.ZodType<T>) {
  return json(path, schema);
}

export function apiPost<T>(path: string, body: unknown, schema: z.ZodType<T>) {
  return json(path, schema, { method: 'POST', ...jsonBody(body) });
}

export function apiPut<T>(path: string, body: unknown, schema: z.ZodType<T>) {
  return json(path, schema, { method: 'PUT', ...jsonBody(body) });
}

/** POST без ответа (204). */
export async function apiPostEmpty(path: string, body?: unknown) {
  await send(path, { method: 'POST', ...jsonBody(body) });
}

/** Файл телом запроса (импорт, вложения поставки). */
export function apiUpload<T>(path: string, file: Blob, schema: z.ZodType<T>) {
  return json(path, schema, { method: 'POST', body: file });
}

/** Строка запроса без пустых параметров. */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** Ссылка на файл, который отдаёт сервер (выгрузки, вложения). */
export const apiUrl = (path: string) => `${API_PREFIX}${path}`;

export const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
